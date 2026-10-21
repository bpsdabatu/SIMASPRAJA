import { normHeader } from "@/lib/header";

/**
 * Logika murni impor Data Master (tanpa akses database) agar mudah diuji.
 * Tiap entitas punya kolom berkode dan alias nama kolom yang diterima.
 */
export interface ImportColumn { key: "code" | "name" | "parent" | "npwp" | "address" | "year" | "extra"; label: string; aliases: string[]; required?: boolean; max: number }
export interface ImportSpec {
  columns: ImportColumn[]; sample: string[];
  /** Bila kolom induk tidak ada: kode induk = kode sendiri dikurangi N segmen terakhir (dipisah titik). */
  deriveParentDrop?: number;
  /** Bila kolom kode tidak ada/kosong (mis. master Sumber Dana asal hanya berisi nama): kode dibuat dari nama. */
  deriveCodeFromName?: boolean;
}

/** "DBH CHT" -> "DBH-CHT". Dipakai bila master tidak memiliki kolom kode. */
export const codeFromName = (name: string) => name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

const code = (extra: string[] = []): ImportColumn => ({ key: "code", label: "kode", aliases: ["kode", "code", ...extra], required: true, max: 40 });
const name = (extra: string[] = [], max = 300): ImportColumn => ({ key: "name", label: "nama", aliases: ["nama", "name", "uraian", ...extra], required: true, max });

export const IMPORT_SPECS: Record<string, ImportSpec> = {
  programs: { columns: [code(["kode_program"]), name(["nama_program", "program"])], sample: ["1.01", "Contoh Program"] },
  activities: {
    columns: [{ key: "parent", label: "kode_program", aliases: ["kode_program", "program"], max: 40 }, code(["kode_kegiatan"]), name(["nama_kegiatan", "kegiatan"])],
    sample: ["1.01", "1.01.01.2.01", "Contoh Kegiatan"], deriveParentDrop: 2,
  },
  sub_activities: {
    columns: [{ key: "parent", label: "kode_kegiatan", aliases: ["kode_kegiatan", "kegiatan"], max: 40 }, code(["kode_sub_kegiatan"]), name(["nama_sub_kegiatan", "sub_kegiatan"])],
    sample: ["1.01.01.2.01", "1.01.01.2.01.0001", "Contoh Sub Kegiatan"], deriveParentDrop: 1,
  },
  expenditure_accounts: { columns: [code(["kode_rekening", "kode_belanja"]), name(["nama_rekening", "uraian_rekening", "nama_belanja", "belanja"])], sample: ["5.1.02.01.01.0024", "Belanja Alat/Bahan untuk Kegiatan Kantor"] },
  funding_sources: { columns: [{ ...code(["kode_sumber_dana"]), required: false }, name(["nama_sumber_dana", "sumber_dana"], 200)], sample: ["PAD", "Pendapatan Asli Daerah"], deriveCodeFromName: true },
  procurement_methods: { columns: [code(["kode_metode"]), name(["nama_metode"], 200)], sample: ["PGL", "Pengadaan Langsung"] },
  suppliers: {
    columns: [
      { key: "name", label: "nama", aliases: ["nama", "name", "nama_penyedia"], required: true, max: 200 },
      { key: "address", label: "alamat", aliases: ["alamat", "address"], max: 500 },
    ],
    sample: ["CV Contoh Mandiri", "Jl. Contoh No. 1"],
  },
  rup_references: {
    columns: [
      { key: "year", label: "tahun", aliases: ["tahun", "tahun_anggaran", "year"], required: true, max: 4 },
      { key: "code", label: "kode_rup", aliases: ["kode_rup", "rup", "kode"], required: true, max: 60 },
      { key: "extra", label: "nama_paket", aliases: ["nama_paket", "paket", "nama"], max: 300 },
    ],
    sample: ["2026", "12345678", "Contoh Paket Pengadaan"],
  },
};

/**
 * Metode pengadaan baku menurut Perpres 16/2018 sebagaimana diubah Perpres 12/2021 (dan Perpres 46/2025),
 * serta Peraturan LKPP 3/2021 (tipe swakelola) dan 12/2021 (pedoman pelaksanaan melalui penyedia).
 * Nilai ambang & syarat TIDAK disimpan di sini: periksa ketentuan terbaru LKPP sebelum memutuskan metode.
 */
export const STANDARD_PROCUREMENT_METHODS: [code: string, name: string][] = [
  ["EPC", "E-Purchasing (Katalog Elektronik)"],
  ["PGL", "Pengadaan Langsung"],
  ["PNL", "Penunjukan Langsung"],
  ["TCP", "Tender Cepat"],
  ["TDR", "Tender"],
  ["SEL", "Seleksi (Jasa Konsultansi)"],
  ["SWK-1", "Swakelola Tipe I (dikerjakan sendiri oleh K/L/Perangkat Daerah penanggung jawab anggaran)"],
  ["SWK-2", "Swakelola Tipe II (oleh K/L/Perangkat Daerah lain)"],
  ["SWK-3", "Swakelola Tipe III (oleh Organisasi Kemasyarakatan)"],
  ["SWK-4", "Swakelola Tipe IV (oleh Kelompok Masyarakat)"],
];

export function importTemplateRows(entity: string): string[][] | null {
  const spec = IMPORT_SPECS[entity];
  if (!spec) return null;
  if (entity === "procurement_methods") return [spec.columns.map((c) => c.label), ...STANDARD_PROCUREMENT_METHODS];
  return [spec.columns.map((c) => c.label), spec.sample];
}

export interface ParsedRow {
  line: number;
  code?: string; name?: string; parent?: string; npwp?: string | null; address?: string | null; year?: number; extra?: string | null;
}
export interface ParseOutcome { rows: ParsedRow[]; problems: string[] }

/** Memetakan tabel mentah (baris pertama = header) ke baris terstruktur + daftar masalah. */
export function parseMasterTable(entity: string, table: string[][]): ParseOutcome {
  const spec = IMPORT_SPECS[entity];
  if (!spec) return { rows: [], problems: ["Jenis master tidak dapat diimpor."] };
  const header = (table[0] ?? []).map(normHeader);
  const idx = new Map<ImportColumn["key"], number>();
  const problems: string[] = [];
  for (const c of spec.columns) {
    const i = header.findIndex((h) => c.aliases.includes(h));
    if (i === -1) { if (c.required) problems.push(`Kolom wajib "${c.label}" tidak ditemukan pada baris pertama.`); } else idx.set(c.key, i);
  }
  if (problems.length) return { rows: [], problems };
  const data = table.slice(1);
  if (data.length === 0) return { rows: [], problems: ["Berkas tidak berisi baris data."] };
  if (data.length > 5000) return { rows: [], problems: ["Maksimal 5.000 baris per impor."] };

  const rows: ParsedRow[] = [];
  data.forEach((r, i) => {
    const line = i + 2;
    const get = (k: ImportColumn["key"]) => { const j = idx.get(k); return j === undefined ? "" : (r[j] ?? "").trim(); };
    const out: ParsedRow = { line };
    for (const c of spec.columns) {
      if (c.key === "parent" && spec.deriveParentDrop && !get("parent")) {
        const segs = get("code").split(".");
        const derived = segs.length > spec.deriveParentDrop ? segs.slice(0, segs.length - spec.deriveParentDrop).join(".") : "";
        if (derived) out.parent = derived; else problems.push(`Baris ${line}: ${c.label} kosong dan tidak dapat diturunkan dari kode "${get("code")}"`);
        continue;
      }
      let v = get(c.key);
      if (c.key === "code" && !v && spec.deriveCodeFromName) v = codeFromName(get("name"));
      if (c.required && !v) { problems.push(`Baris ${line}: ${c.label} kosong`); continue; }
      if (c.key === "code" && !v) { problems.push(`Baris ${line}: kode kosong dan tidak dapat diturunkan dari nama`); continue; }
      if (v.length > c.max) { problems.push(`Baris ${line}: ${c.label} melebihi ${c.max} karakter`); continue; }
      if (c.key === "year") {
        const y = Number(v);
        if (!Number.isInteger(y) || y < 2000 || y > 2100) problems.push(`Baris ${line}: tahun "${v}" tidak valid`); else out.year = y;
      } else if (c.key === "npwp" || c.key === "address" || c.key === "extra") out[c.key] = v || null;
      else (out as unknown as Record<string, unknown>)[c.key] = v;
    }
    rows.push(out);
  });
  return { rows, problems };
}

/** Kunci identitas baris untuk deteksi duplikat di dalam berkas dan terhadap data yang ada. */
export function rowKey(entity: string, r: ParsedRow): string {
  if (entity === "suppliers") return (r.name ?? "").toLowerCase();
  if (entity === "rup_references") return `${r.year}|${(r.code ?? "").toLowerCase()}`;
  return (r.code ?? "").toLowerCase();
}
