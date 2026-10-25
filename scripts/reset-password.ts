/**
 * Pemulihan akun (mis. ADMIN tidak bisa masuk): atur ulang kata sandi, aktifkan akun, dan buka blokir percobaan masuk.
 * Dijalankan di mesin administrator dengan kunci service_role (BUKAN dari browser).
 *
 *   npm run user:reset -- --username admin                 # kata sandi acak dibuat otomatis lalu dicetak
 *   NEW_PASSWORD='KataSandiBaru123' npm run user:reset -- --username admin
 *   npm run user:reset -- --username admin --diagnose      # hanya memeriksa penyebab, tanpa mengubah apa pun
 *
 * Setelah ini pengguna wajib mengganti kata sandi saat masuk. Perintah ini memakai .env.local (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
 */
import { randomInt } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { passwordSchema } from "../src/lib/auth/password-policy";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
function fail(msg: string): never { console.error(`Galat: ${msg}`); process.exit(1); }

function randomPassword(): string {
  const U = "ABCDEFGHJKLMNPQRSTUVWXYZ", L = "abcdefghijkmnopqrstuvwxyz", D = "23456789", S = "!@#$%*?-_";
  const pick = (s: string) => s[randomInt(s.length)]!;
  const chars = [pick(U), pick(U), pick(L), pick(L), pick(L), pick(D), pick(D), pick(S), ...Array.from({ length: 6 }, () => pick(U + L + D))];
  for (let i = chars.length - 1; i > 0; i--) { const j = randomInt(i + 1); [chars[i], chars[j]] = [chars[j]!, chars[i]!]; }
  return chars.join("");
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail("NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY harus diisi (.env.local).");
  const username = (arg("username") ?? "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) fail("--username wajib diisi (3-32 karakter: a-z, 0-9, titik, garis bawah, strip).");
  const sb = createClient(url!, key!, { auth: { autoRefreshToken: false, persistSession: false } });
  console.log(`Proyek Supabase yang dipakai skrip: ${new URL(url!).host}  <-- HARUS sama dengan NEXT_PUBLIC_SUPABASE_URL di Vercel/Netlify`);

  const prof = await sb.from("profiles").select("id, username, status, must_change_password, organization_id, auth_identities(internal_email), user_roles(role_code)").eq("username", username).maybeSingle();
  if (prof.error) fail(`Tidak dapat membaca tabel profiles: ${prof.error.message}. Pastikan kunci service_role dan proyek Supabase benar.`);
  if (!prof.data) fail(`Username "${username}" tidak ditemukan. Periksa proyek Supabase pada .env.local (apakah proyek sama dengan yang dipakai aplikasi di Vercel?).`);
  const p = prof.data;
  const identity = Array.isArray(p.auth_identities) ? p.auth_identities[0] : p.auth_identities;
  const roles = (p.user_roles ?? []).map((r: { role_code: string }) => r.role_code).join(", ") || "(tanpa peran)";

  const authUser = await sb.auth.admin.getUserById(p.id);
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const fails = await sb.from("auth_attempts").select("id", { count: "exact", head: true }).eq("succeeded", false).gte("attempted_at", since);

  console.log("Hasil pemeriksaan:");
  console.log(`  status akun           : ${p.status}${p.status !== "active" ? "  <-- akun tidak aktif, login ditolak" : ""}`);
  console.log(`  peran                 : ${roles}`);
  console.log(`  identitas login       : ${identity?.internal_email ? "ada" : "TIDAK ADA  <-- login ditolak (auth_identities kosong)"}`);
  console.log(`  pengguna Supabase Auth: ${authUser.error || !authUser.data.user ? "TIDAK DITEMUKAN  <-- " + (authUser.error?.message ?? "") : "ada"}`);
  if (authUser.data.user && identity?.internal_email && authUser.data.user.email !== identity.internal_email) console.log("  email Auth != identitas login  <-- tidak cocok; skrip akan menyelaraskan");
  console.log(`  percobaan gagal 24 jam: ${fails.count ?? "?"} (seluruh akun; pembatasan dihitung per username/IP)`);
  if (flag("diagnose")) return;

  if (authUser.error || !authUser.data.user) fail("Pengguna tidak ada di Supabase Auth; buat ulang akun dengan `npm run user:create`.");
  if (!identity?.internal_email) fail("auth_identities untuk akun ini kosong; tambahkan baris (profile_id, internal_email) sesuai email Auth atau buat ulang akun.");

  const password = process.env.NEW_PASSWORD || randomPassword();
  const ok = passwordSchema.safeParse(password);
  if (!ok.success) fail(`NEW_PASSWORD tidak valid: ${ok.error.issues[0]?.message}`);

  const upd = await sb.auth.admin.updateUserById(p.id, { password, email: identity.internal_email, email_confirm: true });
  if (upd.error) fail(`Supabase menolak pengaturan kata sandi: ${upd.error.message}`);
  const pr = await sb.from("profiles").update({ status: "active", must_change_password: true }).eq("id", p.id);
  if (pr.error) fail(`Gagal memperbarui profil: ${pr.error.message}`);
  await sb.auth.admin.signOut(p.id, "global").catch(() => undefined);
  // Buka blokir throttling: hapus percobaan gagal 24 jam terakhir (untuk username & IP).
  const del = await sb.from("auth_attempts").delete().eq("succeeded", false).gte("attempted_at", since);
  if (del.error) console.warn(`Peringatan: gagal membersihkan pembatasan login: ${del.error.message}`);
  await sb.from("account_temp_credentials").delete().eq("profile_id", p.id); // bersihkan sandi sementara lama bila tabel ada
  await sb.from("audit_logs").insert({ action: "USER_PASSWORD_RESET", organization_id: p.organization_id, table_name: "profiles", record_id: p.id, context: { by: "scripts/reset-password" } });

  // Uji masuk seperti aplikasi (kunci anon + email internal + kata sandi): memisahkan masalah data Supabase vs konfigurasi aplikasi.
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (anon) {
    const probe = createClient(url!, anon, { auth: { autoRefreshToken: false, persistSession: false } });
    const t = await probe.auth.signInWithPassword({ email: identity.internal_email, password });
    console.log(t.error ? `\nUji masuk ke Supabase GAGAL: ${t.error.message}` : "\nUji masuk ke Supabase BERHASIL (data akun benar).");
    if (!t.error) console.log("  Bila aplikasi tetap menolak, penyebabnya konfigurasi aplikasi: variabel lingkungan di hosting menunjuk proyek/kunci berbeda, atau belum deploy ulang.");
  }
  console.log("\nBerhasil.");
  console.log(`  username      : ${username}`);
  console.log(`  kata sandi    : ${password}`);
  console.log("  Masuk dengan kata sandi ini; aplikasi akan meminta Anda menggantinya. Catat lalu hapus dari riwayat terminal.");
}

main();
