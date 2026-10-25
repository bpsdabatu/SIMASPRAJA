import "server-only";
import { randomInt, randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { adminClient } from "@/lib/supabase/admin";
import { SERVICE_KEY_VAR } from "@/lib/env";
import { USERNAME_RE } from "@/lib/auth/login-core";
import { passwordSchema } from "@/lib/auth/password-policy";
import { storeTempPassword } from "@/lib/auth/temp-credential";

/**
 * Pembuatan akun (Pengguna & Peran dan Data Master › PPTK memakai SATU jalur ini).
 * Tujuan utama: bila gagal, pengguna melihat PENYEBAB yang dapat ditindaklanjuti (bukan "tidak dapat dibuat" saja).
 * Pesan hanya memuat alasan yang aman ditampilkan (tanpa kunci/rahasia).
 */
export type AccountRole = "admin" | "ppk" | "pptk" | "ppbj";
export const ACCOUNT_ROLES: readonly AccountRole[] = ["admin", "ppk", "pptk", "ppbj"];

export interface NewAccount { username: string; fullName: string; nip?: string | null; position?: string | null; roles: AccountRole[]; password: string }
export type CreateResult = { ok: true; id: string } | { ok: false; error: string };
export interface Actor { id: string; organizationId: string }

/** Kata sandi sementara acak: 14 karakter, memuat huruf besar, kecil, angka, dan simbol (memenuhi kebijakan Supabase yang ketat sekalipun). */
export function tempPassword(): string {
  const U = "ABCDEFGHJKLMNPQRSTUVWXYZ", L = "abcdefghijkmnopqrstuvwxyz", D = "23456789", S = "!@#$%*?-_";
  const all = U + L + D;
  const pick = (s: string) => s[randomInt(s.length)]!;
  const chars = [pick(U), pick(U), pick(L), pick(L), pick(L), pick(D), pick(D), pick(S), pick(all), pick(all), pick(all), pick(all), pick(all), pick(all)];
  for (let i = chars.length - 1; i > 0; i--) { const j = randomInt(i + 1); [chars[i], chars[j]] = [chars[j]!, chars[i]!]; }
  return chars.join("");
}

/** Nama variabel lingkungan yang kurang/tidak valid, dari galat zod. */
export function envProblem(e: unknown): string | null {
  if (!(e instanceof ZodError)) return null;
  const names = [...new Set(e.issues.map((i) => String(i.path[0] ?? "")).filter(Boolean))];
  return `Konfigurasi server belum lengkap: ${names.join(", ") || "variabel lingkungan"} belum diisi/valid. Isi di Environment Variables (Vercel/Netlify), lalu deploy ulang.`;
}

interface AuthErr { message?: string; status?: number; code?: string }

/** Menerjemahkan galat Supabase Auth ke langkah perbaikan. */
export function explainAuthError(e: AuthErr): string {
  const msg = String(e.message ?? "").trim();
  const code = String(e.code ?? "");
  if (e.status === 401 || e.status === 403 || /invalid api key|jwt|not allowed|unauthori[sz]ed|forbidden|no api key/i.test(msg)) {
    return `Supabase menolak kunci server. Pastikan ${SERVICE_KEY_VAR} berisi kunci “service_role” (bukan “anon”) dari proyek yang sama dengan NEXT_PUBLIC_SUPABASE_URL, lalu deploy ulang.`;
  }
  if (code === "weak_password" || /password/i.test(msg)) return `Kata sandi ditolak Supabase Auth: ${msg || "tidak memenuhi kebijakan"}. Gunakan kata sandi yang lebih panjang/rumit (huruf besar, kecil, angka, simbol) atau sesuaikan kebijakan di Supabase › Authentication.`;
  if (code === "email_exists" || /already (been )?registered|already exists/i.test(msg)) return "Akun dengan email internal yang sama sudah ada. Coba lagi.";
  if (/email/i.test(msg)) return `Supabase Auth menolak alamat email internal: ${msg}`;
  if (/database error/i.test(msg)) return "Supabase Auth gagal menyimpan pengguna (Database error). Periksa trigger pada tabel auth.users di Supabase › Database › Triggers; trigger yang gagal menggagalkan pembuatan akun.";
  if (e.status === 429 || /rate limit/i.test(msg)) return "Terlalu banyak permintaan ke Supabase Auth. Tunggu beberapa menit lalu coba lagi.";
  return `Supabase Auth menolak: ${msg || "alasan tidak diketahui"}${e.status ? ` (status ${e.status})` : ""}.`;
}

/** Menerjemahkan galat basis data (PostgREST/Postgres) saat menyimpan profil. */
export function explainDbError(e: { message?: string; code?: string }): string {
  const msg = String(e.message ?? "");
  if (e.code === "42P01" || /relation .* does not exist|schema cache|could not find the table/i.test(msg)) return "Tabel pengguna belum ada di basis data. Jalankan seluruh migrasi SQL (0001 s.d. terbaru) di Supabase.";
  if (e.code === "23505") return "Username atau data unik sudah dipakai.";
  if (e.code === "23514") return "Data tidak memenuhi aturan (mis. format username: huruf kecil, angka, titik, garis bawah, strip; 3–32 karakter).";
  if (e.code === "23503") return "Organisasi tidak ditemukan untuk akun Anda. Hubungi administrator sistem.";
  if (e.code === "42501" || /permission denied|row-level security/i.test(msg)) return `Basis data menolak penyimpanan (izin). Pastikan ${SERVICE_KEY_VAR} benar (kunci service_role).`;
  return `Basis data menolak penyimpanan: ${msg.slice(0, 160) || "alasan tidak diketahui"}.`;
}

const INTERNAL_DOMAINS = ["auth.simaspraja.invalid", "simaspraja-akun.example.com"];

export async function createAccount(actor: Actor, a: NewAccount): Promise<CreateResult> {
  const username = a.username.trim().toLowerCase();
  const fullName = a.fullName.trim();
  if (!USERNAME_RE.test(username)) return { ok: false, error: "Username 3–32 karakter: huruf kecil, angka, titik, garis bawah, atau strip." };
  if (!fullName) return { ok: false, error: "Nama lengkap wajib diisi." };
  if (a.roles.length === 0) return { ok: false, error: "Pilih minimal satu peran." };
  const pw = passwordSchema.safeParse(a.password);
  if (!pw.success) return { ok: false, error: `Kata sandi sementara: ${pw.error.issues[0]?.message}` };

  let admin;
  try { admin = adminClient(); } catch (e) { return { ok: false, error: envProblem(e) ?? "Klien server tidak dapat dibuat." }; }

  const dupe = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
  if (dupe.error) return { ok: false, error: explainDbError(dupe.error) };
  if (dupe.data) return { ok: false, error: `Username "${username}" sudah dipakai.` };

  // Email internal hanyalah pengenal (login memakai username). Bila domain pertama ditolak sebagai email tidak valid, coba domain cadangan.
  let internalEmail = "";
  let uid = "";
  let lastErr: AuthErr = {};
  for (const domain of INTERNAL_DOMAINS) {
    internalEmail = `${randomUUID()}@${domain}`;
    const created = await admin.auth.admin.createUser({ email: internalEmail, password: a.password, email_confirm: true });
    if (!created.error && created.data.user) { uid = created.data.user.id; break; }
    lastErr = (created.error ?? {}) as AuthErr;
    console.error("[akun] createUser", lastErr.status, lastErr.code, lastErr.message);
    if (!/email/i.test(String(lastErr.message ?? "")) || /password/i.test(String(lastErr.message ?? ""))) break; // hanya ulangi untuk masalah email
  }
  if (!uid) return { ok: false, error: explainAuthError(lastErr) };

  let failure = "";
  try {
    const p = await admin.from("profiles").insert({
      id: uid, organization_id: actor.organizationId, username, full_name: fullName,
      nip: a.nip?.trim() || null, position_title: a.position?.trim() || null, must_change_password: true,
    });
    if (p.error) throw p.error;
    const needsScope = a.roles.some((r) => r === "admin" || r === "ppk");
    const steps = [
      admin.from("auth_identities").insert({ profile_id: uid, internal_email: internalEmail }),
      admin.from("user_roles").insert(a.roles.map((r) => ({ user_id: uid, role_code: r, granted_by: actor.id }))),
      ...(needsScope ? [admin.from("user_scopes").insert({ user_id: uid, scope_type: "organization", scope_id: null, granted_by: actor.id })] : []),
    ];
    for (const s of steps) { const r = await s; if (r.error) throw r.error; }
  } catch (e) {
    const err = e as { message?: string; code?: string };
    console.error("[akun] simpan profil", err.code, err.message);
    failure = explainDbError(err);
    // Bersihkan agar tidak ada akun setengah jadi (profiles.id -> auth.users bersifat RESTRICT).
    await admin.from("user_scopes").delete().eq("user_id", uid);
    await admin.from("user_roles").delete().eq("user_id", uid);
    await admin.from("auth_identities").delete().eq("profile_id", uid);
    await admin.from("profiles").delete().eq("id", uid);
    await admin.auth.admin.deleteUser(uid);
  }
  if (failure) return { ok: false, error: `Akun dibatalkan. ${failure}` };

  await storeTempPassword(uid, a.password, actor.id); // terenkripsi; dilihat admin di menu Pengguna sampai pengguna menggantinya
  await admin.from("audit_logs").insert({ action: "USER_CREATED", actor_id: actor.id, organization_id: actor.organizationId, table_name: "profiles", record_id: uid, context: { username, roles: a.roles } });
  return { ok: true, id: uid };
}

/**
 * Uji kesiapan pembuatan akun TANPA meninggalkan data: memeriksa variabel server, koneksi kunci service_role, akses tabel,
 * lalu membuat dan langsung menghapus satu akun uji di Supabase Auth. Mengembalikan daftar hasil per langkah.
 */
export async function diagnoseAccountSetup(): Promise<{ label: string; ok: boolean; detail: string }[]> {
  const out: { label: string; ok: boolean; detail: string }[] = [];
  let admin;
  try { admin = adminClient(); out.push({ label: "Variabel server", ok: true, detail: `${SERVICE_KEY_VAR} dan APP_SECRET terisi.` }); }
  catch (e) { out.push({ label: "Variabel server", ok: false, detail: envProblem(e) ?? "Klien server tidak dapat dibuat." }); return out; }

  const list = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  out.push(list.error ? { label: "Kunci service_role diterima Supabase", ok: false, detail: explainAuthError(list.error as AuthErr) } : { label: "Kunci service_role diterima Supabase", ok: true, detail: "Auth Admin API dapat diakses." });

  const tbl = await admin.from("profiles").select("id", { count: "exact", head: true });
  out.push(tbl.error ? { label: "Tabel pengguna", ok: false, detail: explainDbError(tbl.error) } : { label: "Tabel pengguna", ok: true, detail: `Tabel profiles dapat dibaca (${tbl.count ?? 0} akun).` });

  if (!list.error) {
    const probe = `${randomUUID()}@${INTERNAL_DOMAINS[0]}`;
    const made = await admin.auth.admin.createUser({ email: probe, password: tempPassword(), email_confirm: true });
    if (made.error || !made.data.user) out.push({ label: "Uji buat akun di Supabase Auth", ok: false, detail: explainAuthError((made.error ?? {}) as AuthErr) });
    else {
      await admin.auth.admin.deleteUser(made.data.user.id);
      out.push({ label: "Uji buat akun di Supabase Auth", ok: true, detail: "Akun uji berhasil dibuat lalu dihapus (tidak ada data tersisa)." });
    }
  }
  return out;
}
