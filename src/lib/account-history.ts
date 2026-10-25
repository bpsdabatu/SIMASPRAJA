import "server-only";
import { adminClient } from "@/lib/supabase/admin";

/**
 * Riwayat siklus hidup akun (tabel account_history, migrasi 0017): kapan akun dibuat, kata sandi diatur ulang/diganti,
 * akun ditangguhkan/diaktifkan, peran diubah. Tidak pernah menyimpan kata sandi. Hanya service role yang dapat membaca/menulis.
 * Pencatatan bersifat best-effort: kegagalan hanya dicatat di log server dan tidak membatalkan tindakan akun.
 */
export type AccountEventCode = "DIBUAT" | "SANDI_DIRESET" | "SANDI_DIGANTI" | "DITANGGUHKAN" | "DIAKTIFKAN" | "PERAN_DIUBAH" | "DIPULIHKAN";

export const EVENT_LABEL: Record<AccountEventCode, string> = {
  DIBUAT: "Akun dibuat",
  SANDI_DIRESET: "Kata sandi diatur ulang admin",
  SANDI_DIGANTI: "Kata sandi diganti pengguna",
  DITANGGUHKAN: "Akun ditangguhkan",
  DIAKTIFKAN: "Akun diaktifkan",
  PERAN_DIUBAH: "Peran diubah",
  DIPULIHKAN: "Akun dipulihkan (skrip admin)",
};

export interface AccountEventInput {
  profileId: string;
  username: string;
  fullName?: string | null;
  event: AccountEventCode;
  actorId?: string | null;
  actorUsername?: string | null;
  organizationId?: string | null;
  detail?: Record<string, unknown> | null;
}

export async function recordAccountEvent(e: AccountEventInput): Promise<void> {
  try {
    const admin = adminClient();
    let actorUsername = e.actorUsername ?? null;
    if (!actorUsername && e.actorId) {
      const { data } = await admin.from("profiles").select("username").eq("id", e.actorId).maybeSingle();
      actorUsername = (data?.username as string | undefined) ?? null;
    }
    const { error } = await admin.from("account_history").insert({
      organization_id: e.organizationId ?? null,
      profile_id: e.profileId,
      username: e.username,
      full_name: e.fullName ?? null,
      event: e.event,
      actor_id: e.actorId ?? null,
      actor_username: actorUsername,
      detail: e.detail ?? null,
    });
    if (error) console.error("[riwayat-akun]", error.code, error.message);
  } catch (err) {
    console.error("[riwayat-akun]", err instanceof Error ? err.message : "unknown");
  }
}

export interface AccountHistoryRow {
  id: number;
  profile_id: string;
  username: string;
  full_name: string | null;
  event: AccountEventCode;
  actor_username: string | null;
  detail: Record<string, unknown> | null;
  occurred_at: string;
}

/** Riwayat terbaru (maks 500). `ready=false` bila migrasi 0017 belum dijalankan. */
export async function loadAccountHistory(organizationId: string, opts: { username?: string; limit?: number } = {}): Promise<{ ready: boolean; rows: AccountHistoryRow[] }> {
  let q = adminClient().from("account_history").select("id, profile_id, username, full_name, event, actor_username, detail, occurred_at")
    .eq("organization_id", organizationId).order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(Math.min(opts.limit ?? 200, 500));
  if (opts.username) q = q.eq("username", opts.username);
  const { data, error } = await q;
  if (error) return { ready: false, rows: [] };
  return { ready: true, rows: (data ?? []) as AccountHistoryRow[] };
}

/** Ringkasan per akun untuk tabel Pengguna: kapan dibuat (dan oleh siapa) serta reset terakhir. */
export interface AccountSummary { createdAt: string | null; createdBy: string | null; lastResetAt: string | null; lastResetBy: string | null; resets: number }

export async function loadAccountSummaries(organizationId: string): Promise<{ ready: boolean; map: Map<string, AccountSummary> }> {
  const map = new Map<string, AccountSummary>();
  const { data, error } = await adminClient().from("account_history").select("profile_id, event, actor_username, occurred_at")
    .eq("organization_id", organizationId).in("event", ["DIBUAT", "SANDI_DIRESET"]).order("occurred_at", { ascending: true }).limit(5000);
  if (error) return { ready: false, map };
  for (const r of (data ?? []) as { profile_id: string; event: string; actor_username: string | null; occurred_at: string }[]) {
    const s = map.get(r.profile_id) ?? { createdAt: null, createdBy: null, lastResetAt: null, lastResetBy: null, resets: 0 };
    if (r.event === "DIBUAT" && !s.createdAt) { s.createdAt = r.occurred_at; s.createdBy = r.actor_username; }
    if (r.event === "SANDI_DIRESET") { s.lastResetAt = r.occurred_at; s.lastResetBy = r.actor_username; s.resets++; }
    map.set(r.profile_id, s);
  }
  return { ready: true, map };
}
