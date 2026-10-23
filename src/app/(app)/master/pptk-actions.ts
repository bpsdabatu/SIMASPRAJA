"use server";

import { revalidatePath } from "next/cache";
import { requireModule } from "@/lib/auth/guard";
import { adminClient } from "@/lib/supabase/admin";
import { createAccount, envProblem, tempPassword } from "@/lib/account-admin";
import { SERVICE_KEY_VAR } from "@/lib/env";
import { readTable, normHeader } from "@/lib/spreadsheet";
import { USERNAME_RE } from "@/lib/auth/login-core";

export interface PptkImportState {
  error?: string;
  created?: { username: string; name: string; password: string }[];
  failed?: string[];
}

const COLS = { username: ["username", "nama_pengguna", "user"], name: ["nama_lengkap", "nama", "name"], nip: ["nip"], position: ["jabatan", "position", "jabatan_pptk"] };

/**
 * Impor PPTK dari Excel/CSV: membuat akun berperan PPTK dengan kata sandi sementara acak
 * (wajib diganti saat masuk pertama). Seluruh baris divalidasi lebih dulu; bila ada masalah tidak ada akun dibuat.
 */
export async function importPptkAction(_prev: PptkImportState, fd: FormData): Promise<PptkImportState> {
  const { user } = await requireModule("users.manage");
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Pilih berkas Excel (.xlsx) atau CSV." };
  const read = await readTable(file);
  if (!read.ok) return { error: read.error };
  const table = read.rows;
  const header = (table[0] ?? []).map(normHeader);
  const idx = (aliases: string[]) => header.findIndex((h) => aliases.includes(h));
  const iU = idx(COLS.username), iN = idx(COLS.name), iNip = idx(COLS.nip), iPos = idx(COLS.position);
  if (iU === -1 || iN === -1) return { error: "Kolom wajib: username dan nama_lengkap (opsional: nip, jabatan)." };
  const data = table.slice(1);
  if (data.length === 0) return { error: "Berkas tidak berisi baris data." };
  if (data.length > 200) return { error: "Maksimal 200 PPTK per impor." };

  let admin;
  try { admin = adminClient(); } catch (e) { return { error: envProblem(e) ?? "Klien server tidak dapat dibuat." }; }
  const { data: existing } = await admin.from("profiles").select("username").limit(20000);
  const taken = new Set((existing ?? []).map((p) => String(p.username)));
  const problems: string[] = [];
  const seen = new Set<string>();
  const rows = data.map((r, i) => {
    const line = i + 2;
    const username = (r[iU] ?? "").trim().toLowerCase();
    const fullName = (r[iN] ?? "").trim();
    if (!USERNAME_RE.test(username)) problems.push(`Baris ${line}: username "${username}" tidak valid (3–32 karakter: huruf kecil, angka, titik, garis bawah, strip)`);
    else if (taken.has(username)) problems.push(`Baris ${line}: username "${username}" sudah dipakai`);
    else if (seen.has(username)) problems.push(`Baris ${line}: username "${username}" ganda dalam berkas`);
    if (!fullName) problems.push(`Baris ${line}: nama lengkap kosong`);
    seen.add(username);
    return { line, username, fullName: fullName.slice(0, 150), nip: iNip >= 0 ? (r[iNip] ?? "").trim().slice(0, 30) || null : null, position: iPos >= 0 ? (r[iPos] ?? "").trim().slice(0, 150) || null : null };
  });
  if (problems.length) return { error: `Impor dibatalkan, tidak ada akun dibuat. ${problems.length} masalah: ${problems.slice(0, 5).join("; ")}${problems.length > 5 ? " ..." : ""}` };

  const created: NonNullable<PptkImportState["created"]> = [];
  const failed: string[] = [];
  for (const r of rows) {
    const password = tempPassword();
    const res = await createAccount({ id: user.id, organizationId: user.organizationId }, { username: r.username, fullName: r.fullName, nip: r.nip, position: r.position, roles: ["pptk"], password });
    if (res.ok) created.push({ username: r.username, name: r.fullName, password });
    else failed.push(`Baris ${r.line} (@${r.username}): ${res.error}`);
    // Kegagalan yang berlaku untuk semua baris (kunci/konfigurasi) dihentikan lebih awal agar tidak mengulang galat yang sama.
    if (!res.ok && new RegExp(`${SERVICE_KEY_VAR}|Konfigurasi server|Tabel pengguna belum ada`).test(res.error)) break;
  }
  return { created, failed: failed.length ? failed : undefined };
}

/** Tambah SATU PPTK (akun berperan PPTK; sama dengan menambah di Pengguna & Peran dengan peran PPTK). Kata sandi acak tampil sekali. */
export async function addPptkAction(_prev: PptkImportState, fd: FormData): Promise<PptkImportState> {
  const { user } = await requireModule("users.manage");
  const password = tempPassword();
  const res = await createAccount(
    { id: user.id, organizationId: user.organizationId },
    { username: String(fd.get("username") ?? ""), fullName: String(fd.get("fullName") ?? ""), nip: String(fd.get("nip") ?? "") || null, position: String(fd.get("position") ?? "") || null, roles: ["pptk"], password },
  );
  if (!res.ok) return { error: res.error };
  revalidatePath("/master");
  revalidatePath("/pengguna");
  return { created: [{ username: String(fd.get("username") ?? "").trim().toLowerCase(), name: String(fd.get("fullName") ?? "").trim(), password }] };
}
