/**
 * Membuat akun pengguna (termasuk admin pertama) dengan service role.
 * Dijalankan di mesin administrator/CI, BUKAN dari browser.
 *
 * Contoh (kata sandi lewat variabel lingkungan agar tidak tersimpan di riwayat shell):
 *   BOOTSTRAP_PASSWORD='KataSandiSementara1' npm run user:create -- \
 *     --username admin --name "Administrator" --role admin \
 *     --org-code OPD-EKON --org-name "Bagian Perekonomian dan SDA"
 *
 * Peran PPK/admin otomatis mendapat scope organisasi; PPTK/PPBJ tidak (penugasan lewat butir anggaran/dokumen).
 * Akun baru wajib mengganti kata sandi saat masuk pertama kali.
 */
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { passwordSchema } from "../src/lib/auth/password-policy";

const ROLES = ["admin", "ppk", "pptk", "ppbj"] as const;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function fail(msg: string): never {
  console.error(`Galat: ${msg}`);
  process.exit(1);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail("NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY harus diisi (.env.local).");

  const username = (arg("username") ?? "").trim().toLowerCase();
  const fullName = (arg("name") ?? "").trim();
  const role = arg("role") as (typeof ROLES)[number] | undefined;
  const orgCode = arg("org-code");
  const orgName = arg("org-name");
  const nip = arg("nip");
  const position = arg("position");
  const password = process.env.BOOTSTRAP_PASSWORD ?? "";

  if (!/^[a-z0-9._-]{3,32}$/.test(username)) fail("--username harus 3-32 karakter: a-z, 0-9, titik, garis bawah, strip.");
  if (!fullName) fail("--name wajib diisi.");
  if (!role || !ROLES.includes(role)) fail(`--role harus salah satu dari: ${ROLES.join(", ")}.`);
  if (!orgCode) fail("--org-code wajib diisi.");
  const pw = passwordSchema.safeParse(password);
  if (!pw.success) fail(`BOOTSTRAP_PASSWORD tidak valid: ${pw.error.issues[0]?.message}`);

  const sb = createClient(url!, key!, { auth: { autoRefreshToken: false, persistSession: false } });

  // Organisasi
  let { data: org } = await sb.from("organizations").select("id").eq("code", orgCode).maybeSingle();
  if (!org) {
    if (!orgName) fail("Organisasi belum ada; berikan --org-name untuk membuatnya.");
    const ins = await sb.from("organizations").insert({ code: orgCode, name: orgName }).select("id").single();
    if (ins.error) fail(`Gagal membuat organisasi: ${ins.error.message}`);
    org = ins.data;
  }

  const dupe = await sb.from("profiles").select("id").eq("username", username).maybeSingle();
  if (dupe.data) fail(`Username "${username}" sudah dipakai.`);

  // Identitas auth dengan email internal acak (tidak pernah ditampilkan ke pengguna)
  const internalEmail = `${randomUUID()}@auth.simanja.invalid`;
  const created = await sb.auth.admin.createUser({ email: internalEmail, password, email_confirm: true });
  if (created.error || !created.data.user) fail(`Gagal membuat akun auth: ${created.error?.message}`);
  const uid = created.data.user!.id;

  try {
    const steps = [
      sb.from("profiles").insert({
        id: uid, organization_id: org!.id, username, full_name: fullName, nip, position_title: position,
        must_change_password: true,
      }),
    ];
    for (const s of steps) { const r = await s; if (r.error) throw new Error(r.error.message); }
    const more = [
      sb.from("auth_identities").insert({ profile_id: uid, internal_email: internalEmail }),
      sb.from("user_roles").insert({ user_id: uid, role_code: role }),
      ...(role === "admin" || role === "ppk"
        ? [sb.from("user_scopes").insert({ user_id: uid, scope_type: "organization", scope_id: null })]
        : []),
    ];
    for (const s of more) { const r = await s; if (r.error) throw new Error(r.error.message); }
  } catch (e) {
    await sb.auth.admin.deleteUser(uid); // batalkan agar tidak ada akun setengah jadi
    fail(`Gagal menyimpan profil, akun dibatalkan: ${(e as Error).message}`);
  }

  await sb.from("account_history").insert({ organization_id: org!.id, profile_id: uid, username, full_name: fullName, event: "DIBUAT", detail: { oleh: "scripts/create-user", peran: [role] } }); // abaikan galat bila migrasi 0017 belum dijalankan
  console.log(`Berhasil: pengguna "${username}" (${role}) dibuat. Wajib ganti kata sandi saat masuk pertama.`);
}

main();
