"use server";

import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/auth/session";
import { userClient } from "@/lib/supabase/server";
import { readTable } from "@/lib/spreadsheet";
import { parseRupTable } from "@/lib/rup-import-core";

export interface RupImportState {
  phase?: "done" | "error"; error?: string;
  total?: number; added?: number; updated?: number; skipped?: number; duplicates?: number; withPagu?: number; ignoredColumns?: string[];
}

/**
 * Unggah RUP dari SiRUP (Excel/CSV) untuk tahun anggaran konteks aktif. Hanya MENAMBAH/MEMPERBARUI per Kode RUP (tidak ada yang dihapus).
 * Dibatasi RLS: Admin (master.manage) atau PPK (document.create_ppk). Berkas divalidasi ulang seluruhnya di server.
 */
export async function importRupAction(_prev: RupImportState, fd: FormData): Promise<RupImportState> {
  const { user, context } = await requireContext();
  if (!user.permissions.has("master.manage") && !user.permissions.has("document.create_ppk")) {
    return { phase: "error", error: "Unggah RUP hanya dapat dilakukan oleh Admin atau PPK." };
  }
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { phase: "error", error: "Pilih berkas Excel (.xlsx) atau CSV hasil unduhan SiRUP." };
  const read = await readTable(file);
  if (!read.ok) return { phase: "error", error: read.error };
  const parsed = parseRupTable((read as { rows: string[][] }).rows);
  if (!parsed.ok) return { phase: "error", error: parsed.error };

  const sb = await userClient();
  const { data: fy } = await sb.from("fiscal_years").select("id").eq("year", context.year).maybeSingle();
  if (!fy) return { phase: "error", error: `Tahun anggaran ${context.year} belum ada di Data Master. Buat melalui Input Anggaran > Tahun anggaran.` };
  const fyId = fy.id as string;

  const existing = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("rup_references").select("rup_code").eq("fiscal_year_id", fyId).order("rup_code").range(from, from + 999);
    if (error) return { phase: "error", error: "Data RUP yang ada tidak dapat dibaca." };
    for (const r of data ?? []) existing.add(String(r.rup_code));
    if (!data || data.length < 1000) break;
  }

  const now = new Date().toISOString();
  const payload = parsed.rows.map((r) => ({
    organization_id: user.organizationId, fiscal_year_id: fyId, rup_code: r.code, package_name: r.name, is_active: true,
    pagu: r.pagu, jenis_pengadaan: r.jenis || null, metode_pemilihan: r.metode || null, cara_pengadaan: r.cara || null, sumber_dana: r.sumber || null,
    lokasi: r.lokasi || null, satuan_kerja: r.satker || null, kegiatan: r.kegiatan || null, waktu_pemilihan: r.waktuPemilihan || null, waktu_pekerjaan: r.waktuPekerjaan || null,
    imported_at: now, imported_by: user.id,
  }));
  for (let i = 0; i < payload.length; i += 500) {
    const { error } = await sb.from("rup_references").upsert(payload.slice(i, i + 500), { onConflict: "organization_id,fiscal_year_id,rup_code" });
    if (error) {
      console.error("[rup] upsert", error.code, error.message);
      const missing = error.code === "PGRST204" || /column|schema cache/i.test(error.message);
      return { phase: "error", error: missing ? "Basis data belum diperbarui: jalankan migrasi 0021_rup_sirup_dan_penyusunan_bersama.sql di Supabase." : "Sebagian data tidak dapat disimpan (periksa hak akses). Tidak ada data lama yang dihapus." };
    }
  }
  revalidatePath("/dokumen");
  const added = parsed.rows.filter((r) => !existing.has(r.code)).length;
  return { phase: "done", total: parsed.rows.length, added, updated: parsed.rows.length - added, skipped: parsed.skipped, duplicates: parsed.duplicates, withPagu: parsed.rows.filter((r) => r.pagu !== null).length, ignoredColumns: parsed.ignoredColumns };
}
