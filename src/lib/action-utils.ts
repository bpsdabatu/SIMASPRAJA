import "server-only";
import { flashRedirect } from "@/lib/flash";

interface PgError { code?: string; message?: string }

const SAFE_CODES = new Set(["22023", "42501", "23514", "23505", "P0001"]);

/** Pesan galat aman untuk pengguna: hanya pesan buatan kita (RPC/trigger), bukan detail internal. */
export function friendlyError(error: PgError | null | undefined): string {
  if (!error) return "";
  const m = error.message ?? "";
  if (error.code && SAFE_CODES.has(error.code) && !/violates|row-level security|permission denied|relation|column/i.test(m)) {
    return m;
  }
  if (error.code === "42501" || /row-level security|permission denied/i.test(m)) {
    return "Anda tidak berwenang melakukan tindakan ini atau status data sudah berubah.";
  }
  if (error.code === "23505") return "Data yang sama sudah ada.";
  if (error.code === "23503") return "Data rujukan tidak ditemukan.";
  // Fungsi/tabel/kolom basis data tidak ditemukan = migrasi SQL belum dijalankan (penyebab paling umum "Tindakan gagal diproses").
  if ((error.code && /^(PGRST|42883|42P01|42703)/.test(error.code)) || /could not find the function|schema cache/i.test(m)) {
    console.error("[db-schema]", error.code ?? "-", m);
    return "Basis data belum diperbarui. Jalankan migrasi SQL terbaru (0014) di Supabase, lalu coba lagi.";
  }
  // Rincian hanya ke log server (Vercel → Logs), tidak ditampilkan ke pengguna.
  console.error("[db-error]", error.code ?? "-", m);
  return "Tindakan gagal diproses. Periksa isian Anda atau hubungi administrator.";
}

/**
 * Menjalankan operasi lalu mengalihkan dengan pesan sukses/galat. `fn` mengembalikan `{ error }` (gaya Supabase).
 * redirect() melempar, jadi dipanggil di luar try/catch.
 */
export async function runAction(
  backTo: string,
  okMessage: string,
  fn: () => PromiseLike<{ error: PgError | null }>,
  okTo?: string,
): Promise<never> {
  let message = "";
  try {
    const { error } = await fn();
    if (error) message = friendlyError(error);
  } catch (e) {
    console.error("[action]", e instanceof Error ? e.message : "unknown");
    message = "Terjadi kesalahan pada sistem. Silakan coba lagi.";
  }
  if (message) flashRedirect(backTo, { err: message });
  flashRedirect(okTo ?? backTo, { ok: okMessage });
}

export function str(fd: FormData, key: string, max = 500): string {
  return String(fd.get(key) ?? "").trim().slice(0, max);
}
export function optStr(fd: FormData, key: string, max = 500): string | null {
  const v = str(fd, key, max);
  return v === "" ? null : v;
}
export function num(fd: FormData, key: string): number {
  const raw = String(fd.get(key) ?? "").trim().replace(",", ".");
  return raw === "" ? NaN : Number(raw);
}
export function uuidOrNull(fd: FormData, key: string): string | null {
  const v = str(fd, key, 40);
  return /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}
export const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
