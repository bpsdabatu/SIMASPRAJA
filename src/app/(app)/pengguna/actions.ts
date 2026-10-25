"use server";

import { requireModule } from "@/lib/auth/guard";
import { adminClient } from "@/lib/supabase/admin";
import { createAccount, diagnoseAccountSetup, tempPassword } from "@/lib/account-admin";
import { storeTempPassword } from "@/lib/auth/temp-credential";
import { recordAccountEvent } from "@/lib/account-history";
import { userClient } from "@/lib/supabase/server";
import { flashRedirect } from "@/lib/flash";
import { passwordSchema } from "@/lib/auth/password-policy";
import { friendlyError, isUuid, optStr, str } from "@/lib/action-utils";

const BACK = "/pengguna";
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

export async function setUserStatusAction(fd: FormData): Promise<void> {
  const { user } = await requireModule("users.manage");
  const id = str(fd, "userId", 40);
  const to = str(fd, "to", 10);
  if (id === user.id) flashRedirect(BACK, { err: "Anda tidak dapat mengubah status akun sendiri." });
  const target = await targetInOrg(id, user.organizationId);
  if (!target || !["active", "suspended"].includes(to)) flashRedirect(BACK, { err: "Permintaan tidak valid." });
  const { error } = await adminClient().from("profiles").update({ status: to }).eq("id", id);
  if (error) flashRedirect(BACK, { err: "Status tidak dapat diubah." });
  if (to === "suspended") await adminClient().auth.admin.signOut(id, "global").catch(() => undefined);
  await audit(user.id, user.organizationId, to === "active" ? "USER_ACTIVATED" : "USER_SUSPENDED", id);
  await recordAccountEvent({ profileId: id, username: target!.username, event: to === "active" ? "DIAKTIFKAN" : "DITANGGUHKAN", actorId: user.id, actorUsername: user.username, organizationId: user.organizationId });
  flashRedirect(BACK, { ok: to === "active" ? `@${target!.username} diaktifkan.` : `@${target!.username} ditangguhkan dan sesinya diakhiri.` });
}

export async function resetPasswordAction(fd: FormData): Promise<void> {
  const { user } = await requireModule("users.manage");
  const id = str(fd, "userId", 40);
  if (id === user.id) flashRedirect(BACK, { err: "Ganti kata sandi sendiri melalui menu profil." });
  const target = await targetInOrg(id, user.organizationId);
  if (!target) flashRedirect(BACK, { err: "Pengguna tidak ditemukan." });
  // Kosong = dibuat acak otomatis (reset cepat). Kata sandi sementara dapat dilihat di kolom "Kata sandi sementara" sampai pengguna menggantinya.
  const given = String(fd.get("password") ?? "").trim();
  const pw = passwordSchema.safeParse(given || tempPassword());
  if (!pw.success) flashRedirect(BACK, { err: `Kata sandi sementara: ${pw.error.issues[0]?.message}` });
  const admin = adminClient();
  const upd = await admin.auth.admin.updateUserById(id, { password: pw.data });
  if (upd.error) { console.error("[pengguna] reset", upd.error.message); flashRedirect(BACK, { err: "Kata sandi tidak dapat diatur ulang." }); }
  await admin.from("profiles").update({ must_change_password: true, status: "active" }).eq("id", id);
  await admin.auth.admin.signOut(id, "global").catch(() => undefined);
  await storeTempPassword(id, pw.data, user.id);
  await audit(user.id, user.organizationId, "USER_PASSWORD_RESET", id);
  await recordAccountEvent({ profileId: id, username: target!.username, event: "SANDI_DIRESET", actorId: user.id, actorUsername: user.username, organizationId: user.organizationId });
  flashRedirect(BACK, { ok: `Kata sandi @${target!.username} diatur ulang. Lihat kata sandi sementaranya di kolom “Kata sandi sementara”; pengguna wajib menggantinya saat masuk.` });
}

export async function setRolesAction(fd: FormData): Promise<void> {
  const { user } = await requireModule("users.manage");
  const id = str(fd, "userId", 40);
  const roles = rolesFrom(fd);
  if (!isUuid(id)) flashRedirect(BACK, { err: "Pengguna tidak valid." });
  if (roles.length === 0) flashRedirect(BACK, { err: "Pilih minimal satu peran." });
  // Memakai klien pengguna: RLS + pelindung trigger (tidak boleh mengubah peran sendiri) tetap berlaku.
  const sb = await userClient();
  const { data: cur, error: e0 } = await sb.from("user_roles").select("role_code").eq("user_id", id);
  if (e0) flashRedirect(BACK, { err: friendlyError(e0) });
  const have = new Set((cur ?? []).map((r) => r.role_code as string));
  const add = roles.filter((r) => !have.has(r));
  const del = [...have].filter((r) => !(roles as string[]).includes(r));
  if (add.length) { const { error } = await sb.from("user_roles").insert(add.map((r) => ({ user_id: id, role_code: r, granted_by: user.id }))); if (error) flashRedirect(BACK, { err: friendlyError(error) }); }
  if (del.length) { const { error } = await sb.from("user_roles").delete().eq("user_id", id).in("role_code", del); if (error) flashRedirect(BACK, { err: friendlyError(error) }); }
  const needsScope = roles.some((r) => r === "admin" || r === "ppk");
  if (needsScope) {
    // Indeks unik berbasis ekspresi tidak dapat dipakai on_conflict PostgREST: periksa dulu, baru sisipkan.
    const { data: has } = await sb.from("user_scopes").select("id").eq("user_id", id).eq("scope_type", "organization").maybeSingle();
    if (!has) {
      const { error } = await sb.from("user_scopes").insert({ user_id: id, scope_type: "organization", scope_id: null, granted_by: user.id });
      if (error) flashRedirect(BACK, { err: friendlyError(error) });
    }
  } else {
    await sb.from("user_scopes").delete().eq("user_id", id).eq("scope_type", "organization");
  }
  const who = await targetInOrg(id, user.organizationId);
  if (who) await recordAccountEvent({ profileId: id, username: who.username, event: "PERAN_DIUBAH", actorId: user.id, actorUsername: user.username, organizationId: user.organizationId, detail: { peran: roles } });
  flashRedirect(BACK, { ok: "Peran diperbarui." });
}
