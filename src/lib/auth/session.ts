import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { userClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { CONTEXT_COOKIE, verifyContext, type Stage } from "@/lib/auth/context";

export type RoleCode = "admin" | "ppk" | "pptk" | "ppbj";

export interface SessionUser {
  id: string;
  username: string;
  fullName: string;
  organizationId: string;
  mustChangePassword: boolean;
  roles: RoleCode[];
  permissions: Set<string>;
}

/**
 * Pengguna sesi saat ini. Memakai auth.getUser() (memvalidasi JWT ke server Supabase),
 * bukan getSession() yang hanya membaca cookie. Dicache per-request.
 */
/** ID pengguna hasil validasi JWT ke server Supabase (auth.getUser). Dicache per-request agar hanya SATU panggilan jaringan per permintaan. */
const getAuthUserId = cache(async (): Promise<string | null> => {
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  return auth.user?.id ?? null;
});

/**
 * Matriks peran -> izin bersifat global dan jarang berubah, sehingga di-cache singkat di memori instans (bukan per pengguna).
 * Peran pengguna sendiri TIDAK di-cache (selalu dibaca dari database); izin tetap ditegakkan ulang oleh RLS.
 */
const PERM_TTL_MS = 60_000;
const permCache = new Map<string, { at: number; perms: string[] }>();
async function permissionsFor(supabase: Awaited<ReturnType<typeof userClient>>, roles: RoleCode[]): Promise<Set<string>> {
  if (roles.length === 0) return new Set();
  const key = [...roles].sort().join(",");
  const hit = permCache.get(key);
  if (hit && Date.now() - hit.at < PERM_TTL_MS) return new Set(hit.perms);
  const { data: perms, error } = await supabase.from("role_permissions").select("permission_code").in("role_code", roles);
  const list = (perms ?? []).map((p) => p.permission_code as string);
  if (!error) permCache.set(key, { at: Date.now(), perms: list });
  return new Set(list);
}

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const userId = await getAuthUserId();
  if (!userId) return null;
  const supabase = await userClient();

  // Profil dan peran tidak saling bergantung: diambil bersamaan (sebelumnya berurutan).
  const [{ data: profile }, { data: roleRows }] = await Promise.all([
    supabase.from("profiles").select("id, username, full_name, organization_id, status, must_change_password").eq("id", userId).maybeSingle(),
    supabase.from("user_roles").select("role_code").eq("user_id", userId),
  ]);
  if (!profile || profile.status !== "active") return null;
  const roles = (roleRows ?? []).map((r) => r.role_code as RoleCode);
  const permissions = await permissionsFor(supabase, roles);

  return {
    id: profile.id,
    username: profile.username,
    fullName: profile.full_name,
    organizationId: profile.organization_id,
    mustChangePassword: profile.must_change_password,
    roles,
    permissions,
  };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export interface BudgetContext {
  year: number;
  stage: Stage;
  versionId: string;
}

/**
 * Konteks anggaran aktif. Cookie hanya petunjuk: tanda tangan, kepemilikan, dan kedaluwarsa
 * diperiksa, lalu DIVALIDASI ULANG ke database (RPC resolve_budget_context) sehingga konteks
 * yang dicabut/tidak lagi tersedia langsung ditolak. Tidak pernah memercayai nilai dari klien.
 */
export const getBudgetContext = cache(async (): Promise<BudgetContext | null> => {
  const userId = await getAuthUserId(); // cukup ID tervalidasi; tidak perlu menunggu profil/peran
  if (!userId) return null;
  const store = await cookies();
  const payload = await verifyContext(serverEnv().APP_SECRET, store.get(CONTEXT_COOKIE)?.value, {
    userId,
  });
  if (!payload) return null;

  const supabase = await userClient();
  const { data, error } = await supabase.rpc("resolve_budget_context", {
    p_year: payload.y,
    p_stage: payload.s,
  });
  if (error || !data || data !== payload.v) return null;
  return { year: payload.y, stage: payload.s, versionId: data as string };
});

export async function requireContext(): Promise<{ user: SessionUser; context: BudgetContext }> {
  // Dijalankan bersamaan: validasi konteks (1 RPC) tidak lagi menunggu profil + peran + izin.
  const [user, context] = await Promise.all([getSessionUser(), getBudgetContext()]);
  if (!user) redirect("/login");
  if (!context) redirect("/pilih-konteks");
  return { user, context };
}
