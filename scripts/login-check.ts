/**
 * Uji alur login SEPERTI aplikasi, langkah demi langkah, untuk menemukan mengapa username/kata sandi ditolak.
 * Tidak mengubah data apa pun (hanya membaca + satu percobaan signInWithPassword; sesi tidak disimpan).
 *
 *   LOGIN_PASSWORD='kata-sandi' npm run login:check -- --username admin
 *   npm run login:check -- --username admin          # tanpa kata sandi: hanya memeriksa data & konfigurasi
 *
 * Memakai .env.local (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, APP_SECRET).
 */
import { createClient } from "@supabase/supabase-js";
import { classifySignInError, describeSignInError } from "../src/lib/auth/signin-error";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const ok = (m: string) => console.log(`  ✓ ${m}`);
const bad = (m: string) => { console.log(`  ✗ ${m}`); problems++; };
let problems = 0;

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const srv = process.env.SUPABASE_SERVICE_ROLE_KEY, secret = process.env.APP_SECRET;
  const username = (arg("username") ?? "").trim().toLowerCase();
  const password = process.env.LOGIN_PASSWORD ?? "";

  console.log("1) Variabel lingkungan");
  url ? ok(`NEXT_PUBLIC_SUPABASE_URL = ${new URL(url).host}  (HARUS sama dengan yang di Vercel/Netlify)`) : bad("NEXT_PUBLIC_SUPABASE_URL kosong");
  anon && anon.length >= 20 ? ok("NEXT_PUBLIC_SUPABASE_ANON_KEY terisi") : bad("NEXT_PUBLIC_SUPABASE_ANON_KEY kosong/pendek");
  srv && srv.length >= 20 ? ok("SUPABASE_SERVICE_ROLE_KEY terisi") : bad("SUPABASE_SERVICE_ROLE_KEY kosong/pendek");
  secret && secret.length >= 32 ? ok("APP_SECRET terisi (>= 32 karakter)") : bad("APP_SECRET kosong/kurang dari 32 karakter (captcha & cookie konteks gagal)");
  if (!url || !anon || !srv) return;
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) { bad("--username wajib (3-32 karakter: a-z, 0-9, titik, garis bawah, strip)"); return; }

  const admin = createClient(url, srv, { auth: { autoRefreshToken: false, persistSession: false } });
  const probe = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });

  console.log("\n2) Tabel pendukung login (kunci service_role)");
  for (const t of ["profiles", "auth_identities", "auth_attempts", "captcha_nonces", "audit_logs"]) {
    const r = await admin.from(t).select("*", { count: "exact", head: true });
    r.error ? bad(`${t}: ${r.error.code ?? ""} ${r.error.message}`) : ok(`${t} dapat dibaca`);
  }

  console.log(`\n3) Akun "${username}"`);
  const prof = await admin.from("profiles").select("id, status, must_change_password, auth_identities(internal_email), user_roles(role_code)").eq("username", username).maybeSingle();
  if (prof.error) { bad(`gagal membaca profil: ${prof.error.message}`); return; }
  if (!prof.data) { bad("username TIDAK ADA di database ini (proyek Supabase salah, atau username berbeda?)"); return; }
  const p = prof.data as unknown as { id: string; status: string; must_change_password: boolean; auth_identities: { internal_email: string } | { internal_email: string }[] | null; user_roles: { role_code: string }[] };
  p.status === "active" ? ok("status aktif") : bad(`status "${p.status}" -> login ditolak`);
  p.user_roles.length ? ok(`peran: ${p.user_roles.map((r) => r.role_code).join(", ")}`) : bad("tanpa peran");
  const email = (Array.isArray(p.auth_identities) ? p.auth_identities[0] : p.auth_identities)?.internal_email;
  if (!email) { bad("auth_identities kosong -> login ditolak (perbaiki: npm run accounts:reset -- --username " + username + ")"); return; }
  ok("auth_identities ada");
  const au = await admin.auth.admin.getUserById(p.id);
  if (au.error || !au.data.user) { bad(`pengguna Supabase Auth tidak ditemukan: ${au.error?.message ?? ""}`); return; }
  au.data.user.email === email ? ok("email Auth sama dengan auth_identities") : bad("email Auth BERBEDA dengan auth_identities -> kata sandi tak pernah cocok (npm run accounts:reset -- --username " + username + " menyelaraskan)");
  au.data.user.email_confirmed_at ? ok("email terkonfirmasi") : bad("email belum terkonfirmasi -> Supabase menolak masuk");
  if ((au.data.user as { banned_until?: string | null }).banned_until) bad(`akun diblokir sampai ${(au.data.user as { banned_until?: string }).banned_until}`);

  console.log("\n4) Pembatasan percobaan (15 menit terakhir, seluruh akun)");
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const f = await admin.from("auth_attempts").select("id", { count: "exact", head: true }).eq("succeeded", false).gte("attempted_at", since);
  console.log(`  i ${f.count ?? "?"} percobaan gagal; batas 5/username dan 20/IP. Bila terkunci: npm run user:reset -- --username ${username}`);

  console.log("\n5) Uji masuk ke Supabase (kunci anon + email internal)");
  if (!password) { console.log("  – dilewati (isi LOGIN_PASSWORD untuk menguji kata sandi)"); }
  else {
    const t = await probe.auth.signInWithPassword({ email, password });
    if (!t.error) ok("BERHASIL: kata sandi cocok. Bila aplikasi tetap menolak, penyebabnya konfigurasi hosting (env berbeda/belum redeploy) atau kode keamanan.");
    else classifySignInError(t.error) === "credentials" ? bad(`kata sandi ditolak Supabase (${describeSignInError(t.error)}) -> reset: npm run user:reset -- --username ${username}`) : bad(`galat SISTEM, bukan kata sandi: ${describeSignInError(t.error)} -> periksa URL/kunci anon`);
  }
  console.log(problems ? `\n${problems} masalah ditemukan (lihat tanda ✗).` : "\nTidak ada masalah pada data akun/konfigurasi lokal.");
}
main().catch((e) => { console.error("Galat:", e instanceof Error ? e.message : e); process.exit(1); });
