/**
 * Logika login berbasis username, bebas dari Next.js/Supabase agar dapat diuji.
 * Semua efek samping masuk lewat `LoginDeps`.
 *
 * Urutan pemeriksaan: bentuk input -> kode keamanan (sekali pakai) -> throttling ->
 * username+kata sandi -> konteks anggaran (tahun + tahapan) yang dipilih di halaman masuk.
 *
 * Jaminan keamanan:
 *  - Pesan galat generik yang sama untuk username tak dikenal, akun nonaktif, dan kata sandi salah.
 *  - Email internal tidak pernah keluar dari fungsi ini (hasil hanya ok/pesan).
 *  - Throttling per username (dihash) dan per IP (dihash), termasuk untuk username yang tidak ada.
 *  - Untuk username tak dikenal tetap dilakukan satu panggilan signIn palsu agar waktu respons serupa.
 *  - Konteks (tahun/tahapan) baru diperiksa SETELAH kata sandi benar, sehingga daftar tahun tidak
 *    dapat dipakai penyerang untuk mengintip data.
 *  - Bila konteks yang dipilih belum tersedia, akun yang sah TETAP masuk tanpa konteks dan diarahkan ke /pilih-konteks
 *    (tanpa cookie konteks, middleware menutup semua modul). Sebelumnya sesi ditutup sehingga ADMIN tidak dapat masuk untuk
 *    membuat versi anggaran yang justru dibutuhkan agar konteks tersedia (jebakan "admin tidak bisa login").
 */
import { isStage, type Stage } from "@/lib/auth/context";

export const GENERIC_LOGIN_ERROR = "Username atau kata sandi tidak sesuai.";
export const THROTTLED_LOGIN_ERROR = "Terlalu banyak percobaan masuk. Silakan coba lagi beberapa menit lagi.";
export const CAPTCHA_ERROR = "Kode keamanan tidak sesuai atau sudah kedaluwarsa. Silakan masukkan kode yang baru.";
export const CONTEXT_FORM_ERROR = "Pilih Tahun Anggaran dan Tahapan Anggaran yang valid.";
export const DUMMY_EMAIL = "tidak-ada@auth.simaspraja.invalid";

export const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

export interface ProfileLookup {
  id: string;
  status: "active" | "suspended" | "disabled";
  organizationId: string;
  internalEmail: string;
  mustChangePassword: boolean;
}

export interface LoginDeps {
  config: { maxFailuresPerUser: number; maxFailuresPerIp: number; windowMinutes: number };
  now(): Date;
  hash(purpose: "username" | "ip", value: string): Promise<string>;
  /** Memverifikasi kode keamanan dan MENGHABISKANNYA (sekali pakai). */
  consumeCaptcha(token: string, answer: string): Promise<boolean>;
  countFailures(by: "username_hash" | "ip_hash", hash: string, sinceIso: string): Promise<number>;
  recordAttempt(a: { usernameHash: string; ipHash: string; succeeded: boolean }): Promise<void>;
  /** Opsional: menghapus catatan gagal username ini setelah masuk berhasil (salah ketik sebelumnya tidak ikut menghitung). */
  clearFailures?(usernameHash: string): Promise<void>;
  findProfile(username: string): Promise<ProfileLookup | null>;
  signIn(email: string, password: string): Promise<{ ok: boolean }>;
  signOut(): Promise<void>;
  /** Mengembalikan budget_version_id bila kombinasi tersedia untuk pengguna yang baru masuk. */
  resolveContext(year: number, stage: Stage): Promise<string | null>;
  audit(e: {
    action: "LOGIN_SUCCESS" | "LOGIN_FAILURE" | "LOGIN_THROTTLED" | "LOGIN_CAPTCHA_FAILED" | "LOGIN_CONTEXT_UNAVAILABLE";
    actorId?: string;
    organizationId?: string;
    ipHash: string;
    context?: Record<string, unknown>;
  }): Promise<void>;
  touchLastLogin(profileId: string): Promise<void>;
}

export type LoginResult =
  | {
      ok: true;
      mustChangePassword: boolean;
      userId: string;
      /** null = kata sandi benar tetapi tahun/tahapan yang dipilih belum tersedia; pengguna memilih/membuatnya di /pilih-konteks. */
      context: { year: number; stage: Stage; versionId: string } | null;
    }
  | { ok: false; message: string; refreshCaptcha: boolean };

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export interface LoginInput {
  username: string;
  password: string;
  year: number;
  stage: string;
  captchaToken: string;
  captchaAnswer: string;
  ip: string | null;
}

const fail = (message: string): LoginResult => ({ ok: false, message, refreshCaptcha: true });

export async function performLogin(deps: LoginDeps, input: LoginInput): Promise<LoginResult> {
  const username = normalizeUsername(input.username);
  const password = input.password;

  // Validasi bentuk. Tetap generik: tidak membocorkan aturan format ke penyerang.
  if (!USERNAME_RE.test(username) || password.length < 1 || password.length > 128) {
    return fail(GENERIC_LOGIN_ERROR);
  }
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100 || !isStage(input.stage)) {
    return fail(CONTEXT_FORM_ERROR);
  }
  const stage: Stage = input.stage;

  const usernameHash = await deps.hash("username", username);
  const ipHash = await deps.hash("ip", input.ip ?? "unknown");

  // Kode keamanan diperiksa lebih dulu (murah) dan selalu dihabiskan, benar atau salah tidak dapat dipakai ulang.
  const captchaOk = await deps.consumeCaptcha(input.captchaToken, input.captchaAnswer);
  if (!captchaOk) {
    await deps.audit({ action: "LOGIN_CAPTCHA_FAILED", ipHash });
    return fail(CAPTCHA_ERROR);
  }

  const since = new Date(deps.now().getTime() - deps.config.windowMinutes * 60_000).toISOString();
  // IP tidak diketahui: jangan menumpuk semua pengguna pada satu ember "unknown" (satu orang salah ketik mengunci seluruh kantor).
  const [userFails, ipFails] = await Promise.all([
    deps.countFailures("username_hash", usernameHash, since),
    input.ip ? deps.countFailures("ip_hash", ipHash, since) : Promise.resolve(0),
  ]);
  if (userFails >= deps.config.maxFailuresPerUser || ipFails >= deps.config.maxFailuresPerIp) {
    await deps.audit({ action: "LOGIN_THROTTLED", ipHash });
    return fail(THROTTLED_LOGIN_ERROR);
  }

  const profile = await deps.findProfile(username);
  const usable = profile !== null && profile.status === "active";

  const signed = await deps.signIn(usable ? profile.internalEmail : DUMMY_EMAIL, password);

  if (!usable || !signed.ok) {
    await deps.recordAttempt({ usernameHash, ipHash, succeeded: false });
    await deps.audit({
      action: "LOGIN_FAILURE",
      actorId: profile?.id,
      organizationId: profile?.organizationId,
      ipHash,
      context: { reason: !profile ? "unknown_user" : !usable ? "inactive_account" : "bad_credentials" },
    });
    return fail(GENERIC_LOGIN_ERROR);
  }

  // Kata sandi benar. Sekarang validasi konteks anggaran ke database (berbasis RLS pengguna ini).
  const versionId = await deps.resolveContext(input.year, stage);
  if (!versionId) {
    await deps.recordAttempt({ usernameHash, ipHash, succeeded: true });
    await deps.clearFailures?.(usernameHash);
    await deps.touchLastLogin(profile.id);
    await deps.audit({
      action: "LOGIN_CONTEXT_UNAVAILABLE",
      actorId: profile.id,
      organizationId: profile.organizationId,
      ipHash,
      context: { year: input.year, stage },
    });
    return { ok: true, mustChangePassword: profile.mustChangePassword, userId: profile.id, context: null };
  }

  await deps.recordAttempt({ usernameHash, ipHash, succeeded: true });
  await deps.clearFailures?.(usernameHash);
  await deps.touchLastLogin(profile.id);
  await deps.audit({
    action: "LOGIN_SUCCESS",
    actorId: profile.id,
    organizationId: profile.organizationId,
    ipHash,
    context: { year: input.year, stage },
  });
  return {
    ok: true,
    mustChangePassword: profile.mustChangePassword,
    userId: profile.id,
    context: { year: input.year, stage, versionId },
  };
}
