import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { openTempPassword, sealTempPassword } from "@/lib/auth/temp-seal";

/**
 * Kata sandi SEMENTARA (yang diberikan admin saat membuat/mereset akun) disimpan terenkripsi AES-256-GCM (kunci diturunkan dari APP_SECRET)
 * di tabel yang hanya dapat diakses service role, supaya admin dapat melihatnya di menu Pengguna sampai pengguna menggantinya.
 * Kata sandi pilihan pengguna sendiri tidak pernah disimpan di sini.
 */
export { sealTempPassword, openTempPassword };

/** Menyimpan (best-effort: kegagalan hanya dicatat, tidak membatalkan pembuatan/reset akun). */
export async function storeTempPassword(profileId: string, plain: string, actorId: string): Promise<void> {
  try {
    const ciphertext = await sealTempPassword(serverEnv().APP_SECRET, plain);
    const { error } = await adminClient().from("account_temp_credentials").upsert({ profile_id: profileId, ciphertext, created_by: actorId, created_at: new Date().toISOString() }, { onConflict: "profile_id" });
    if (error) console.error("[akun] simpan kata sandi sementara", error.code, error.message);
  } catch (e) { console.error("[akun] simpan kata sandi sementara", e instanceof Error ? e.message : "unknown"); }
}

export async function clearTempPassword(profileId: string): Promise<void> {
  try { await adminClient().from("account_temp_credentials").delete().eq("profile_id", profileId); } catch { /* best-effort */ }
}

/** Peta profileId -> kata sandi sementara (hanya untuk halaman/ekspor admin). `ready=false` bila tabel belum ada (migrasi 0016 belum dijalankan). */
export async function loadTempPasswords(ids: string[]): Promise<{ ready: boolean; map: Map<string, string> }> {
  const map = new Map<string, string>();
  if (ids.length === 0) return { ready: true, map };
  const secret = serverEnv().APP_SECRET;
  const { data, error } = await adminClient().from("account_temp_credentials").select("profile_id, ciphertext").in("profile_id", ids);
  if (error) return { ready: false, map };
  for (const r of data ?? []) { const p = await openTempPassword(secret, r.ciphertext as string); if (p) map.set(r.profile_id as string, p); }
  return { ready: true, map };
}
