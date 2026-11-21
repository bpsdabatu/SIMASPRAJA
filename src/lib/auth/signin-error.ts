/**
 * Membedakan galat KREDENSIAL (kata sandi salah dsb.) dari galat SISTEM (kunci/URL Supabase salah, jaringan, rate limit).
 * Tanpa pembedaan ini, setiap masalah konfigurasi tampil sebagai "Username atau kata sandi tidak sesuai" dan ikut
 * dihitung sebagai percobaan gagal (mengunci akun yang sebenarnya benar). Murni (tanpa server-only) agar dapat diuji.
 */
export interface SignInErrorLike { message?: string; code?: string; status?: number; name?: string }

const CREDENTIAL_CODES = new Set([
  "invalid_credentials", "user_not_found", "email_not_confirmed", "user_banned", "email_address_invalid", "validation_failed",
]);

export type SignInErrorKind = "credentials" | "system";

export function classifySignInError(e: SignInErrorLike): SignInErrorKind {
  const code = String(e.code ?? "");
  if (CREDENTIAL_CODES.has(code)) return "credentials";
  // Versi lama Supabase Auth tidak mengisi `code`: pesan khasnya "Invalid login credentials" (status 400).
  if (!code && e.status === 400 && /invalid login credentials|email not confirmed/i.test(String(e.message ?? ""))) return "credentials";
  return "system";
}

/** Ringkasan aman untuk log server (tanpa email/kata sandi/kunci). */
export function describeSignInError(e: SignInErrorLike): string {
  return [e.name, e.code, e.status !== undefined ? `status ${e.status}` : "", e.message].filter(Boolean).join(" | ").slice(0, 200);
}
