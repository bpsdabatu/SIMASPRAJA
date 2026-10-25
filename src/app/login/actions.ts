"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { performLogin } from "@/lib/auth/login-core";
import { buildLoginDeps } from "@/lib/auth/login-deps";
import { createCaptcha } from "@/lib/auth/captcha";
import { setContextCookie } from "@/lib/auth/context-cookie";
import { serverEnv } from "@/lib/env";
import type { CaptchaChallenge, FormState } from "@/lib/form-state";

async function newCaptcha(): Promise<CaptchaChallenge> {
  const c = await createCaptcha(serverEnv().APP_SECRET);
  return { token: c.token, image: c.image };
}

/** Memuat ulang kode keamanan (tombol segarkan). */
export async function refreshCaptchaAction(): Promise<CaptchaChallenge | null> {
  try {
    return await newCaptcha();
  } catch {
    return null;
  }
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  const year = Number(formData.get("year"));
  const stage = String(formData.get("stage") ?? "");
  const captchaToken = String(formData.get("captchaToken") ?? "");
  const captchaAnswer = String(formData.get("captchaAnswer") ?? "");

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;

  let destination = "/dashboard";
  try {
    const result = await performLogin(await buildLoginDeps(), {
      username, password, year, stage, captchaToken, captchaAnswer, ip,
    });
    if (!result.ok) {
      return { error: result.message, captcha: result.refreshCaptcha ? await newCaptcha() : undefined };
    }
    if (result.context) await setContextCookie(result.userId, result.context);
    else destination = "/pilih-konteks?info=konteks"; // tahun/tahapan pilihan belum ada: pilih yang tersedia atau (admin) buat baru
    if (result.mustChangePassword) destination = "/ganti-password";
  } catch (err) {
    // Jangan bocorkan detail internal; catat di log server saja.
    console.error("[login] kesalahan sistem", err instanceof Error ? err.message : "unknown");
    let captcha: CaptchaChallenge | undefined;
    try { captcha = await newCaptcha(); } catch { /* konfigurasi server bermasalah */ }
    return { error: "Terjadi kesalahan pada sistem. Silakan coba lagi atau hubungi administrator.", captcha };
  }
  redirect(destination);
}
