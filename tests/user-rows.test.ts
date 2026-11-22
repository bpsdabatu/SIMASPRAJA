import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadUserRows } from "../src/lib/user-rows";

/** Klien palsu: setiap metode rantai mengembalikan dirinya; await menghasilkan hasil tabel. */
function fake(tables: Record<string, { data?: unknown; error?: { code?: string; message: string } }>, log: string[] = []) {
  return {
    from: (t: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "order", "limit", "eq", "in"]) chain[m] = (...a: unknown[]) => { log.push(`${t}.${m}(${a.map(String).join(",")})`); return chain; };
      chain.then = (res: (v: unknown) => void) => res({ data: tables[t]?.data ?? null, error: tables[t]?.error ?? null });
      return chain;
    },
  } as unknown as SupabaseClient;
}

describe("loadUserRows", () => {
  const p = (id: string, n: string) => ({ id, username: n, full_name: n, nip: null, position_title: null, status: "active", last_login_at: null, must_change_password: false });
  it("menggabungkan peran tanpa penyisipan relasi (tidak ada select user_roles(...) pada profiles)", async () => {
    const log: string[] = [];
    const sb = fake({ profiles: { data: [p("1", "ani"), p("2", "budi")] }, user_roles: { data: [{ user_id: "1", role_code: "ppk" }, { user_id: "1", role_code: "pptk" }, { user_id: "2", role_code: "admin" }] } }, log);
    const r = await loadUserRows(sb, { organizationId: "org" });
    expect(r.error).toBeNull();
    expect(r.rows.map((x) => [x.username, x.user_roles.map((y) => y.role_code)])).toEqual([["ani", ["ppk", "pptk"]], ["budi", ["admin"]]]);
    expect(log.some((l) => l.includes("user_roles(") )).toBe(false);
  });
  it("pengguna tanpa peran mendapat daftar kosong", async () => {
    const r = await loadUserRows(fake({ profiles: { data: [p("1", "ani")] }, user_roles: { data: [] } }));
    expect(r.rows[0]!.user_roles).toEqual([]);
  });
  it("galat database dikembalikan sebagai teks (kode + pesan)", async () => {
    const r = await loadUserRows(fake({ profiles: { error: { code: "PGRST201", message: "Could not embed" } } }));
    expect(r.rows).toEqual([]); expect(r.error).toContain("PGRST201");
    const r2 = await loadUserRows(fake({ profiles: { data: [p("1", "ani")] }, user_roles: { error: { code: "42501", message: "denied" } } }));
    expect(r2.error).toContain("user_roles");
  });
});
