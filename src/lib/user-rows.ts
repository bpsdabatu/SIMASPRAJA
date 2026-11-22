import type { SupabaseClient } from "@supabase/supabase-js";

export interface UserRow {
  id: string; username: string; full_name: string; nip: string | null; position_title: string | null;
  status: "active" | "suspended" | "disabled"; last_login_at: string | null; must_change_password: boolean; user_roles: { role_code: string }[];
}

/**
 * Memuat profil + peran dengan DUA kueri terpisah (bukan penyisipan relasi `user_roles(...)`).
 * `user_roles` punya dua kunci asing ke `profiles` (user_id dan granted_by), sehingga penyisipan relasi otomatis PostgREST dapat menjadi
 * ambigu (PGRST201) dan seluruh daftar gagal dimuat. Galat dikembalikan sebagai teks (kode + pesan) agar penyebabnya terlihat bagi Admin.
 */
export async function loadUserRows(sb: SupabaseClient, opts: { id?: string; organizationId?: string; limit?: number } = {}): Promise<{ rows: UserRow[]; error: string | null }> {
  let q = sb.from("profiles").select("id, username, full_name, nip, position_title, status, last_login_at, must_change_password").order("full_name").limit(opts.limit ?? 1000);
  if (opts.id) q = q.eq("id", opts.id);
  if (opts.organizationId) q = q.eq("organization_id", opts.organizationId);
  const { data, error } = await q;
  if (error) return { rows: [], error: `profiles: ${error.code ?? ""} ${error.message}`.trim() };
  const profiles = (data ?? []) as Omit<UserRow, "user_roles">[];
  const roles = new Map<string, { role_code: string }[]>();
  for (let i = 0; i < profiles.length; i += 100) {
    const ids = profiles.slice(i, i + 100).map((p) => p.id);
    const r = await sb.from("user_roles").select("user_id, role_code").in("user_id", ids);
    if (r.error) return { rows: [], error: `user_roles: ${r.error.code ?? ""} ${r.error.message}`.trim() };
    for (const x of (r.data ?? []) as { user_id: string; role_code: string }[]) {
      const list = roles.get(x.user_id) ?? [];
      list.push({ role_code: x.role_code });
      roles.set(x.user_id, list);
    }
  }
  return { rows: profiles.map((p) => ({ ...p, user_roles: roles.get(p.id) ?? [] })), error: null };
}
