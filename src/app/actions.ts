"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { userClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { getSessionUser } from "@/lib/auth/session";
import { keyedHash } from "@/lib/auth/crypto";
import { CONTEXT_COOKIE, isStage } from "@/lib/auth/context";
import { setContextCookie } from "@/lib/auth/context-cookie";
import { passwordSchema } from "@/lib/auth/password-policy";
import { flashRedirect } from "@/lib/flash";
import { recordAccountEvent } from "@/lib/account-history";
import type { FormState } from "@/lib/form-state";

/** Memilih konteks (tahun + tahapan). Divalidasi ke database sesuai hak pengguna. */
export async function selectContextAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const year = Number(formData.get("year"));
  const stage = String(formData.get("stage") ?? "");
  if (!Number.isInteger(year) || !isStage(stage)) {
    return { error: "Pilih Tahun Anggaran dan Tahapan Anggaran yang tersedia." };
  }

  const supabase = await userClient();
  const { data: versionId, error } = await supabase.rpc("resolve_budget_context", {
    p_year: year,
    p_stage: stage,
  });
  if (error || !versionId) {
    return { error: "Konteks anggaran tidak tersedia atau Anda tidak berwenang memakainya." };
  }

  await setContextCookie(user.id, { year, stage, versionId: versionId as string });
  redirect("/dashboard");
}

/**
 * Membuat tahun + tahapan anggaran (versi draf) langsung dari /pilih-konteks, khusus pengguna berizin budget.edit (ADMIN).
 * Diperlukan karena menu Input Anggaran baru dapat dibuka setelah konteks ada: tanpa jalur ini admin terkunci pada basis data kosong/baru direset.
 * Bila kombinasi sudah ada, langsung dipilih (tidak membuat versi ganda).
 */
export async function createContextAction(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!user.permissions.has("budget.edit")) flashRedirect("/pilih-konteks", { err: "Anda tidak berwenang membuat tahun/tahapan anggaran." });

  const year = Number(formData.get("year"));
  const stage = String(formData.get("stage") ?? "");
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !isStage(stage)) {
    flashRedirect("/pilih-konteks", { err: "Pilih tahun dan tahapan anggaran yang valid." });
  }
  const supabase = await userClient();
  let versionId: string | null = null;
  let created = false;
  try {
    const existing = await supabase.rpc("resolve_budget_context", { p_year: year, p_stage: stage });
    if (!existing.error && existing.data) versionId = existing.data as string;
    else {
      const made = await supabase.rpc("create_budget_version", { p_year: year, p_stage: stage, p_note: "Dibuat dari halaman Pilih Konteks", p_copy_from: null });
      if (made.error || !made.data) {
        console.error("[pilih-konteks] create_budget_version", made.error?.code, made.error?.message);
        flashRedirect("/pilih-konteks", { err: "Versi anggaran tidak dapat dibuat. Pastikan migrasi SQL sudah dijalankan di Supabase." });
      }
      versionId = made.data as string;
      created = true;
    }
  } catch (e) {
    if (e instanceof Error && /NEXT_REDIRECT/.test(e.message)) throw e;
    console.error("[pilih-konteks]", e instanceof Error ? e.message : "unknown");
    flashRedirect("/pilih-konteks", { err: "Terjadi kesalahan pada sistem. Silakan coba lagi." });
  }
  await setContextCookie(user.id, { year, stage: stage as never, versionId: versionId! });
  if (created) await adminClient().from("audit_logs").insert({ action: "BUDGET_CONTEXT_CREATED", actor_id: user.id, organization_id: user.organizationId, table_name: "budget_versions", record_id: versionId, context: { year, stage } });
  flashRedirect(created ? "/anggaran" : "/dashboard", created ? { ok: `TA ${year} tahapan ${stage} dibuat (draf). Aktifkan versinya di bawah, lalu isi Input Anggaran.` } : {});
}

export async function logoutAction(): Promise<void> {
  const user = await getSessionUser();
  const supabase = await userClient();
  if (user) {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    await adminClient().from("audit_logs").insert({
      action: "LOGOUT",
      actor_id: user.id,
      organization_id: user.organizationId,
      table_name: "auth",
      ip_hash: await keyedHash(serverEnv().APP_SECRET, "ip", ip),
    });
  }
  await supabase.auth.signOut();
  (await cookies()).delete(CONTEXT_COOKIE);
  redirect("/login");
}

/** Ganti kata sandi sendiri (wajib setelah akun dibuat/di-reset administrator). */
export async function changePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const next = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (next !== confirm) return { error: "Konfirmasi kata sandi tidak sama." };
  const parsed = passwordSchema.safeParse(next);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Kata sandi tidak memenuhi syarat." };

  const supabase = await userClient();
  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) return { error: "Kata sandi tidak dapat diperbarui. Gunakan kata sandi yang berbeda dari sebelumnya." };

  const admin = adminClient();
  await admin.from("profiles").update({ must_change_password: false }).eq("id", user.id);
  await admin.from("account_temp_credentials").delete().eq("profile_id", user.id); // kata sandi pilihan pengguna tidak disimpan
  await recordAccountEvent({ profileId: user.id, username: user.username, fullName: user.fullName, event: "SANDI_DIGANTI", actorId: user.id, actorUsername: user.username });
  await admin.from("audit_logs").insert({
    action: "PASSWORD_CHANGED",
    actor_id: user.id,
    organization_id: user.organizationId,
    table_name: "auth",
  });
  redirect("/dashboard");
}
