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
  await admin.from("audit_logs").insert({
    action: "PASSWORD_CHANGED",
    actor_id: user.id,
    organization_id: user.organizationId,
    table_name: "auth",
  });
  redirect("/dashboard");
}
