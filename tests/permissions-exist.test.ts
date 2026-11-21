import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Mencegah kode memeriksa izin yang tidak ada di database (mis. document.edit): fitur diam-diam tak pernah tampil. */
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) { const p = join(dir, n); statSync(p).isDirectory() ? walk(p, out) : /\.(ts|tsx)$/.test(n) && out.push(p); }
  return out;
}
const seed = readFileSync("supabase/migrations/0001_core_identity.sql", "utf8");
const known = new Set([...seed.matchAll(/\('([a-z_]+\.[a-z_]+)','[a-z_]+','/g)].map((m) => m[1]!));

describe("izin yang dipakai kode ada di database", () => {
  it("seed izin terbaca", () => expect(known.size).toBeGreaterThan(20));
  it("semua literal izin pada kode dikenal", () => {
    const bad: string[] = [];
    for (const f of walk("src")) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/(?:requireModule|requireAdminModule|permissions\.has|P\.has|permission:)\s*\(?\s*"([a-z_]+\.[a-z_]+)"/g)) if (!known.has(m[1]!)) bad.push(`${f}: ${m[1]}`);
    }
    expect(bad).toEqual([]);
  });
});
