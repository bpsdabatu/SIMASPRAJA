/**
 * Reset kredensial AKUN secara massal/terarah (pemulihan "admin tidak bisa masuk" dan awal bersih setelah pembersihan akun).
 * Dijalankan di mesin administrator dengan kunci service_role (BUKAN dari browser). Tidak menghapus akun/profil/riwayat/data anggaran:
 * akun tetap ada (jejak audit, pembuat butir anggaran, dan riwayat akun tetap utuh); yang direset adalah kata sandi, status, dan sesi.
 *
 *   npm run accounts:reset -- --diagnose                 # periksa kesehatan SEMUA akun (tidak mengubah apa pun)
 *   npm run accounts:reset -- --username admin           # reset satu akun
 *   npm run accounts:reset -- --all                      # reset SEMUA akun (kata sandi acak baru untuk masing-masing)
 *   npm run accounts:reset -- --all --dry-run            # tampilkan yang akan direset tanpa mengubah
 *   npm run accounts:reset -- --all --suspend-others     # reset admin saja; akun lain ditangguhkan sampai dibuka lewat menu Pengguna
 *
 * Hasil: berkas CSV rahasia `akun-reset-<waktu>.csv` (izin 600) berisi username + kata sandi sementara. Kata sandi juga disimpan
 * terenkripsi sehingga tampil di menu Pengguna sampai pengguna menggantinya. Wajib ganti kata sandi saat masuk. Hapus CSV setelah dibagikan.
 */
import { randomInt } from "node:crypto";
import { chmodSync, writeFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { passwordSchema } from "../src/lib/auth/password-policy";
import { sealTempPassword } from "../src/lib/auth/temp-seal";

const flag = (n: string) => process.argv.includes(`--${n}`);
function arg(n: string): string | undefined { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; }
function fail(msg: string): never { console.error(`Galat: ${msg}`); process.exit(1); }

function randomPassword(): string {
  const U = "ABCDEFGHJKLMNPQRSTUVWXYZ", L = "abcdefghijkmnopqrstuvwxyz", D = "23456789", S = "!@#$%*?-_";
  const pick = (s: string) => s[randomInt(s.length)]!;
  const chars = [pick(U), pick(U), pick(L), pick(L), pick(L), pick(D), pick(D), pick(S), ...Array.from({ length: 6 }, () => pick(U + L + D))];
  for (let i = chars.length - 1; i > 0; i--) { const j = randomInt(i + 1); [chars[i], chars[j]] = [chars[j]!, chars[i]!]; }
  return chars.join("");
}

interface Prof { id: string; username: string; full_name: string; status: string; organization_id: string; must_change_password: boolean; auth_identities: { internal_email: string } | { internal_email: string }[] | null; user_roles: { role_code: string }[] }
const identityOf = (p: Prof) => (Array.isArray(p.auth_identities) ? p.auth_identities[0] : p.auth_identities)?.internal_email ?? null;

async function health(sb: SupabaseClient, p: Prof) {
  const au = await sb.auth.admin.getUserById(p.id);
  const problems: string[] = [];
  if (p.status !== "active") problems.push(`status ${p.status}`);
  if (au.error || !au.data.user) problems.push("pengguna Supabase Auth TIDAK ADA");
  const email = au.data.user?.email ?? null;
  const ident = identityOf(p);
  if (!ident) problems.push(email ? "auth_identities kosong (dapat diperbaiki otomatis)" : "auth_identities kosong");
  else if (email && email !== ident) problems.push("email Auth != auth_identities (diselaraskan saat reset)");
  if (p.user_roles.length === 0) problems.push("tanpa peran");
  return { problems, authEmail: email, authOk: !au.error && !!au.data.user };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, secret = process.env.APP_SECRET;
  if (!url || !key) fail("NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY harus diisi (.env.local).");
  const sb = createClient(url!, key!, { auth: { autoRefreshToken: false, persistSession: false } });
  console.log(`Proyek Supabase: ${new URL(url!).host}  <-- HARUS sama dengan NEXT_PUBLIC_SUPABASE_URL di hosting`);

  const { data, error } = await sb.from("profiles").select("id, username, full_name, status, organization_id, must_change_password, auth_identities(internal_email), user_roles(role_code)").order("username").limit(5000);
  if (error) fail(`Tidak dapat membaca profiles: ${error.message}. Periksa kunci service_role/proyek, dan migrasi SQL.`);
  let list = (data ?? []) as unknown as Prof[];
  if (list.length === 0) fail("Belum ada akun. Buat admin pertama: BOOTSTRAP_PASSWORD='...' npm run user:create -- --username admin --name \"Administrator\" --role admin --org-code <KODE> --org-name \"<NAMA OPD>\"");

  if (flag("diagnose")) {
    console.log(`\nPemeriksaan ${list.length} akun:`);
    for (const p of list) {
      const h = await health(sb, p);
      console.log(`  ${h.problems.length ? "✗" : "✓"} ${p.username.padEnd(20)} [${p.user_roles.map((r) => r.role_code).join(",") || "-"}] ${h.problems.join("; ") || "sehat"}`);
    }
    const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
    const f = await sb.from("auth_attempts").select("id", { count: "exact", head: true }).eq("succeeded", false).gte("attempted_at", since);
    console.log(`\nPercobaan masuk gagal 24 jam terakhir: ${f.count ?? "?"} (pembatasan 5 gagal/username dan 20 gagal/IP per 15 menit; --all/--username membersihkannya).`);
    const ctx = await sb.from("budget_versions").select("id", { count: "exact", head: true }).in("status", ["active", "final", "draft"]);
    console.log(`Versi anggaran (draf/aktif/final): ${ctx.count ?? "?"}${ctx.count === 0 ? "  <-- kosong; admin kini dapat membuatnya dari halaman Pilih Konteks setelah masuk" : ""}`);
    return;
  }

  const one = arg("username")?.trim().toLowerCase();
  if (!one && !flag("all")) fail("Pilih --diagnose, --username <nama>, atau --all.");
  if (one) list = list.filter((p) => p.username === one);
  if (list.length === 0) fail(`Username "${one}" tidak ditemukan.`);
  const suspendOthers = flag("suspend-others");
  if (suspendOthers && !list.some((p) => p.user_roles.some((r) => r.role_code === "admin"))) fail("--suspend-others butuh minimal satu akun berperan admin.");
  if (!secret || secret.length < 32) console.warn("Peringatan: APP_SECRET tidak ada/kurang dari 32 karakter di .env.local; kata sandi sementara tidak dapat disimpan terenkripsi (tidak tampil di menu Pengguna), hanya di CSV.");
  const dry = flag("dry-run");

  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const out: string[][] = [["username", "nama", "peran", "status", "kata_sandi_sementara"]];
  let ok = 0, skipped = 0;
  for (const p of list) {
    const isAdmin = p.user_roles.some((r) => r.role_code === "admin");
    const roles = p.user_roles.map((r) => r.role_code).join("/") || "-";
    const h = await health(sb, p);
    if (!h.authOk) { console.warn(`  ✗ ${p.username}: tidak ada di Supabase Auth; buat ulang akun (npm run user:create). Dilewati.`); skipped++; continue; }
    const internalEmail = identityOf(p) ?? h.authEmail!;
    if (suspendOthers && !isAdmin) {
      if (!dry) {
        await sb.from("profiles").update({ status: "suspended" }).eq("id", p.id);
        await sb.auth.admin.signOut(p.id, "global").catch(() => undefined);
        await sb.from("account_history").insert({ organization_id: p.organization_id, profile_id: p.id, username: p.username, full_name: p.full_name, event: "DITANGGUHKAN", detail: { oleh: "scripts/reset-accounts" } });
      }
      console.log(`  – ${p.username}: ditangguhkan (${dry ? "simulasi" : "selesai"}).`); out.push([p.username, p.full_name, roles, "ditangguhkan", ""]); continue;
    }
    const password = randomPassword();
    if (!passwordSchema.safeParse(password).success) fail("Pembuat kata sandi acak menghasilkan sandi tidak valid.");
    if (dry) { console.log(`  ○ ${p.username}: akan direset${identityOf(p) ? "" : " (+ perbaiki auth_identities)"}.`); continue; }

    const upd = await sb.auth.admin.updateUserById(p.id, { password, email: internalEmail, email_confirm: true });
    if (upd.error) { console.warn(`  ✗ ${p.username}: Supabase menolak (${upd.error.message}). Dilewati.`); skipped++; continue; }
    if (!identityOf(p)) {
      const ins = await sb.from("auth_identities").insert({ profile_id: p.id, internal_email: internalEmail });
      if (ins.error) { console.warn(`  ✗ ${p.username}: gagal memperbaiki auth_identities (${ins.error.message}).`); skipped++; continue; }
    }
    const pr = await sb.from("profiles").update({ status: "active", must_change_password: true }).eq("id", p.id);
    if (pr.error) { console.warn(`  ✗ ${p.username}: gagal memperbarui profil (${pr.error.message}).`); skipped++; continue; }
    await sb.auth.admin.signOut(p.id, "global").catch(() => undefined);
    if (secret && secret.length >= 32) {
      const ct = await sealTempPassword(secret, password);
      const up = await sb.from("account_temp_credentials").upsert({ profile_id: p.id, ciphertext: ct, created_by: null, created_at: new Date().toISOString() }, { onConflict: "profile_id" });
      if (up.error) console.warn(`    (kata sandi ${p.username} tidak tersimpan di menu Pengguna: ${up.error.message}; pakai CSV)`);
    }
    await sb.from("account_history").insert({ organization_id: p.organization_id, profile_id: p.id, username: p.username, full_name: p.full_name, event: "SANDI_DIRESET", detail: { oleh: "scripts/reset-accounts" } });
    await sb.from("audit_logs").insert({ action: "USER_PASSWORD_RESET", organization_id: p.organization_id, table_name: "profiles", record_id: p.id, context: { by: "scripts/reset-accounts" } });
    out.push([p.username, p.full_name, roles, "aktif", password]);
    ok++; console.log(`  ✓ ${p.username}`);
  }
  if (dry) { console.log("\nSimulasi selesai; tidak ada perubahan."); return; }

  // Buka blokir throttling untuk semua yang direset (percobaan gagal dihapus; jejak tetap ada di audit_logs).
  const del = await sb.from("auth_attempts").delete().eq("succeeded", false).gte("attempted_at", new Date(Date.now() - 7 * 24 * 3_600_000).toISOString());
  if (del.error) console.warn(`Peringatan: gagal membersihkan pembatasan login: ${del.error.message}`);

  const file = `akun-reset-${stamp}.csv`;
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  writeFileSync(file, out.map((r) => r.map(esc).join(",")).join("\n") + "\n", { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* Windows */ }
  console.log(`\nSelesai: ${ok} akun direset, ${skipped} dilewati. Daftar kata sandi sementara: ./${file} (RAHASIA — bagikan lewat jalur aman lalu hapus).`);
  console.log("Pengguna wajib mengganti kata sandi saat masuk. Bila aplikasi tetap menolak setelah ini, periksa variabel lingkungan di hosting (proyek Supabase/kunci berbeda) dan deploy ulang.");
}

main();
