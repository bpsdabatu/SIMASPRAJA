"use server";

import { requireModule } from "@/lib/auth/guard";
import { adminClient } from "@/lib/supabase/admin";
import { createAccount, diagnoseAccountSetup, tempPassword } from "@/lib/account-admin";
import { storeTempPassword } from "@/lib/auth/temp-credential";
import { recordAccountEvent } from "@/lib/account-history";
import { userClient } from "@/lib/supabase/server";
import { flashRedirect } from "@/lib/flash";
import { passwordSchema } from "@/lib/auth/password-policy";
import { USERNAME_RE } from "@/lib/auth/login-core";
import { friendlyError, isUuid, optStr, str } from "@/lib/action-utils";

const BACK = "/pengguna";
/** Kembali ke halaman asal (daftar atau halaman Kelola pengguna); nilai lain diabaikan. */
const backOf = (fd: FormData): string => { const b = String(fd.get("back") ?? ""); return /^\/pengguna(\/[0-9a-f-]{36})?$/i.test(b) ? b : BACK; };
const ROLES = ["admin", "ppk", "pptk", "ppbj"] as const;
type Role = (typeof ROLES)[number];

const rolesFrom = (fd: FormData): Role[] => [...new Set(fd.getAll("roles").map(String))].filter((r): r is Role => (ROLES as readonly string[]).includes(r));

async function audit(actorId: string, orgId: string, action: string, recordId: string, context?: Record<string, unknown>) {
  await adminClient().from("audit_logs").insert({ action, actor_id: actorId, organization_id: orgId, table_name: "profiles", record_id: recordId, context: context ?? null });
}

/** Target harus ada di organisasi yang sama dengan admin (service role melewati RLS, jadi diperiksa eksplisit). */
async function targetInOrg(id: string, orgId: string) {
  if (!isUuid(id)) return null;
  const { data } = await adminClient().from("profiles").select("id, username, organization_id").eq("id", id).maybeSingle();
  return data && data.organization_id === orgId ? data : null;
}

export async function createUserAction(fd: FormData): Promise<void> {
  const { user } = await requireModule("users.manage");
  const res = await createAccount(
    { id: user.id, organizationId: user.organizationId },
    { username: str(fd, "username", 32), fullName: str(fd, "fullName", 150), roles: rolesFrom(fd), password: String(fd.get("password") ?? ""), nip: optStr(fd, "nip", 30), position: optStr(fd, "position", 150) },
  );
  if (!res.ok) flashRedirect(BACK, { err: res.error });
  flashRedirect(BACK, { ok: `Pengguna @${str(fd, "username", 32).toLowerCase()} dibuat. Sampaikan kata sandi sementara melalui jalur aman; wajib diganti saat masuk pertama.${rolesFrom(fd).includes("pptk") ? " Akun berperan PPTK otomatis muncul di Data Master › PPTK." : ""}` });
}

export interface DiagnoseState { results?: { label: string; ok: boolean; detail: string }[] }

/** Uji kesiapan pembuatan akun (variabel server, kunci service_role, tabel, dan akun uji yang langsung dihapus). */
export async function diagnoseAccountsAction(_prev: DiagnoseState): Promise<DiagnoseState> {
  await requireModule("users.manage");
  return { results: await diagnoseAccountSetup() };
}

/** Admin aktif terakhir pada organisasi tidak boleh ditangguhkan/dinonaktifkan/dihapus (organisasi tidak boleh kehilangan admin). */
async function isLastActiveAdmin(orgId: string, targetId: string): Promise<boolean> {
  const { data } = await adminClient().from("user_roles").select("user_id, profiles!inner(status, organization_id)")
    .eq("role_code", "admin").eq("profiles.organization_id", orgId).eq("profiles.status", "active");
  const ids = (data ?? []).map((r) => r.user_id as string);
  return ids.includes(targetId) && ids.length <= 1;
}

const STATUS_EVENT = { active: "DIAKTIFKAN", suspended: "DITANGGUHKAN", disabled: "DINONAKTIFKAN" } as const;
const STATUS_AUDIT = { active: "USER_ACTIVATED", suspended: "USER_SUSPENDED", disabled: "USER_DISABLED" } as const;

export async function setUserStatusAction(fd: FormData): Promise<void> {
  const { user } = await requireModule("users.manage");
  const id = str(fd, "userId", 40);
  const to = str(fd, "to", 10) as keyof typeof STATUS_EVENT;
  if (id === user.id) flashRedirect(backOf(fd), { err: "Anda tidak dapat mengubah status akun sendiri." });
  const target = await targetInOrg(id, user.organizationId);
  if (!target || !(to in STATUS_EVENT)) flashRedirect(backOf(fd), { err: "Permintaan tidak valid." });
  if (to !== "active" && (await isLastActiveAdmin(user.organizationId, id))) flashRedirect(backOf(fd), { err: "Akun ini adalah satu-satunya admin aktif. Tambahkan/aktifkan admin lain terlebih dahulu." });
  const { error } = await adminClient().from("profiles").update({ status: to }).eq("id", id);
  if (error) flashRedirect(backOf(fd), { err: "Status tidak dapat diubah." });
  if (to !== "active") await adminClient().auth.admin.signOut(id, "global").catch(() => undefined);
  await audit(user.id, user.organizationId, STATUS_AUDIT[to], id);
  await recordAccountEvent({ profileId: id, username: target!.username, event: STATUS_EVENT[to], actorId: user.id, actorUsername: user.username, organizationId: user.organizationId });
  flashRedirect(backOf(fd), { ok: to === "active" ? `@${target!.username} diaktifkan.` : to === "suspended" ? `@${target!.username} ditangguhkan dan sesinya diakhiri.` : `@${target!.username} dinonaktifkan (tidak dapat masuk dan tidak muncul pada pilihan penugasan). Data yang pernah dibuat tetap utuh.` });
}

/** Ubah data akun: nama lengkap, NIP, jabatan, dan username (kata sandi/peran/status memiliki aksi sendiri). */
export async function updateUserAction(fd: FormData): Promise<void> {
  const { user } = await requireModule("users.manage");
  const id = str(fd, "userId", 40);
  const target = await targetInOrg(id, user.organizationId);
  if (!target) flashRedirect(backOf(fd), { err: "Pengguna tidak ditemukan." });
  const fullName = str(fd, "fullName", 150);
  const username = str(fd, "username", 32).toLowerCase();
  if (!fullName) flashRedirect(backOf(fd), { err: "Nama lengkap wajib diisi." });
  if (!USERNAME_RE.test(username)) flashRedirect(backOf(fd), { err: "Username 3–32 karakter: huruf kecil, angka, titik, garis bawah, atau strip." });
  const admin = adminClient();
  if (username !== target!.username) {
    const dupe = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
    if (dupe.data) flashRedirect(backOf(fd), { err: `Username "${username}" sudah dipakai.` });
  }
  const { error } = await admin.from("profiles").update({ full_name: fullName, username, nip: optStr(fd, "nip", 30), position_title: optStr(fd, "position", 150) }).eq("id", id);
  if (error) { console.error("[pengguna] ubah data", error.code, error.message); flashRedirect(backOf(fd), { err: error.code === "23505" ? "Username sudah dipakai." : "Data akun tidak dapat disimpan." }); }
  await audit(user.id, user.organizationId, "USER_UPDATED", id, { username_lama: target!.username, username_baru: username });
  await recordAccountEvent({ profileId: id, username, fullName, event: "DATA_DIUBAH", actorId: user.id, actorUsername: user.username, organizationId: user.organizationId, detail: username !== target!.username ? { username_lama: target!.username } : null });
  flashRedirect(backOf(fd), { ok: `Data @${username} diperbarui.${username !== target!.username ? " Username baru berlaku untuk masuk berikutnya." : ""}` });
}

/** Hapus permanen. Hanya akun yang belum dipakai pada data lain; selain itu disarankan menonaktifkan (database membatalkan penghapusan). */
export async function deleteUserAction(fd: FormData): Promise<void> {
  const { user } = await requireModule("users.manage");
  const id = str(fd, "userId", 40);
  if (id === user.id) flashRedirect(backOf(fd), { err: "Anda tidak dapat menghapus akun sendiri." });
  const target = await targetInOrg(id, user.organizationId);
  if (!target) flashRedirect(backOf(fd), { err: "Pengguna tidak ditemukan." });
  if (str(fd, "confirm", 40).toLowerCase() !== target!.username) flashRedirect(backOf(fd), { err: `Konfirmasi tidak sesuai. Ketik username @${target!.username} untuk menghapus.` });
  if (await isLastActiveAdmin(user.organizationId, id)) flashRedirect(backOf(fd), { err: "Akun ini adalah satu-satunya admin aktif dan tidak dapat dihapus." });
  const admin = adminClient();
  const detach = fd.get("detach") === "1";
  let del = await admin.rpc("delete_account", { p_user: id, p_detach: detach });
  // Migrasi 0020 belum dijalankan: untuk hapus biasa pakai fungsi 0019.
  if (del.error && (del.error.code === "PGRST202" || /could not find the function/i.test(del.error.message)) && !detach) del = await admin.rpc("delete_unused_account", { p_user: id });
  if (del.error) {
    console.error("[pengguna] hapus", del.error.code, del.error.message);
    if (del.error.code === "23503" || /ACCOUNT_IN_USE/.test(del.error.message)) {
      flashRedirect(backOf(fd), { err: detach
        ? `@${target!.username} tidak dapat dihapus meski keterkaitan dilepas: akun masih menjadi pemilik data wajib (mis. penyusun dokumen/transaksi) atau tabel riwayat menolak perubahan. Gunakan “Nonaktifkan”.`
        : `@${target!.username} sudah tercatat pada data lain (anggaran, realisasi, dokumen, atau penugasan). Pilih “Nonaktifkan” (data tetap utuh), atau centang “Lepaskan keterkaitan” lalu hapus.` });
    }
    if (del.error.code === "PGRST202" || /could not find the function/i.test(del.error.message)) flashRedirect(backOf(fd), { err: "Fitur hapus belum aktif: jalankan migrasi 0019_kelola_akun.sql dan 0020_hapus_akun_lepas_keterkaitan.sql di Supabase, lalu coba lagi." });
    flashRedirect(backOf(fd), { err: "Akun tidak dapat dihapus." });
  }
  const au = await admin.auth.admin.deleteUser(id);
  if (au.error) console.error("[pengguna] hapus auth", au.error.message);
  await audit(user.id, user.organizationId, "USER_DELETED", id, { username: target!.username });
  await recordAccountEvent({ profileId: id, username: target!.username, event: "DIHAPUS", actorId: user.id, actorUsername: user.username, organizationId: user.organizationId, detail: detach ? { lepas_keterkaitan: true } : null });
  flashRedirect(BACK, { ok: au.error ? `Profil @${target!.username} dihapus, tetapi akun loginnya belum terhapus di Supabase Auth; hapus manual di Authentication › Users.` : `Akun @${target!.username} dihapus permanen.` });
}

export async function resetPasswordAction(fd: FormData): Promise<void> {
  const { user } = await requireModule("users.manage");
  const id = str(fd, "userId", 40);
  if (id === user.id) flashRedirect(backOf(fd), { err: "Ganti kata sandi sendiri melalui menu profil." });
  const target = await targetInOrg(id, user.organizationId);
  if (!target) flashRedirect(backOf(fd), { err: "Pengguna tidak ditemukan." });
  // Kosong = dibuat acak otomatis (reset cepat). Kata sandi sementara dapat dilihat di kolom "Kata sandi sementara" sampai pengguna menggantinya.
  const given = String(fd.get("password") ?? "").trim();
  const pw = passwordSchema.safeParse(given || tempPassword());
  if (!pw.success) flashRedirect(backOf(fd), { err: `Kata sandi sementara: ${pw.error.issues[0]?.message}` });
  const admin = adminClient();
  const upd = await admin.auth.admin.updateUserById(id, { password: pw.data });
  if (upd.error) { console.error("[pengguna] reset", upd.error.message); flashRedirect(backOf(fd), { err: "Kata sandi tidak dapat diatur ulang." }); }
  await admin.from("profiles").update({ must_change_password: true, status: "active" }).eq("id", id);
  await admin.auth.admin.signOut(id, "global").catch(() => undefined);
  await storeTempPassword(id, pw.data, user.id);
  await audit(user.id, user.organizationId, "USER_PASSWORD_RESET", id);
  await recordAccountEvent({ profileId: id, username: target!.username, event: "SANDI_DIRESET", actorId: user.id, actorUsername: user.username, organizationId: user.organizationId });
  flashRedirect(backOf(fd), { ok: `Kata sandi @${target!.username} diatur ulang. Lihat kata sandi sementaranya di kolom “Kata sandi sementara”; pengguna wajib menggantinya saat masuk.` });
}

export async function setRolesAction(fd: FormData): Promise<void> {
  const { user } = await requireModule("users.manage");
  const id = str(fd, "userId", 40);
  const roles = rolesFrom(fd);
  if (!isUuid(id)) flashRedirect(backOf(fd), { err: "Pengguna tidak valid." });
  if (roles.length === 0) flashRedirect(backOf(fd), { err: "Pilih minimal satu peran." });
  if (!roles.includes("admin") && (await isLastActiveAdmin(user.organizationId, id))) flashRedirect(backOf(fd), { err: "Akun ini adalah satu-satunya admin aktif; peran Admin tidak dapat dicabut. Tambahkan admin lain terlebih dahulu." });
  // Memakai klien pengguna: RLS + pelindung trigger (tidak boleh mengubah peran sendiri) tetap berlaku.
  const sb = await userClient();
  const { data: cur, error: e0 } = await sb.from("user_roles").select("role_code").eq("user_id", id);
  if (e0) flashRedirect(backOf(fd), { err: friendlyError(e0) });
  const have = new Set((cur ?? []).map((r) => r.role_code as string));
  const add = roles.filter((r) => !have.has(r));
  const del = [...have].filter((r) => !(roles as string[]).includes(r));
  if (add.length) { const { error } = await sb.from("user_roles").insert(add.map((r) => ({ user_id: id, role_code: r, granted_by: user.id }))); if (error) flashRedirect(backOf(fd), { err: friendlyError(error) }); }
  if (del.length) { const { error } = await sb.from("user_roles").delete().eq("user_id", id).in("role_code", del); if (error) flashRedirect(backOf(fd), { err: friendlyError(error) }); }
  const needsScope = roles.some((r) => r === "admin" || r === "ppk");
  if (needsScope) {
    // Indeks unik berbasis ekspresi tidak dapat dipakai on_conflict PostgREST: periksa dulu, baru sisipkan.
    const { data: has } = await sb.from("user_scopes").select("id").eq("user_id", id).eq("scope_type", "organization").maybeSingle();
    if (!has) {
      const { error } = await sb.from("user_scopes").insert({ user_id: id, scope_type: "organization", scope_id: null, granted_by: user.id });
      if (error) flashRedirect(backOf(fd), { err: friendlyError(error) });
    }
  } else {
    await sb.from("user_scopes").delete().eq("user_id", id).eq("scope_type", "organization");
  }
  const who = await targetInOrg(id, user.organizationId);
  if (who) await recordAccountEvent({ profileId: id, username: who.username, event: "PERAN_DIUBAH", actorId: user.id, actorUsername: user.username, organizationId: user.organizationId, detail: { peran: roles } });
  flashRedirect(backOf(fd), { ok: "Peran diperbarui." });
}
