import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));
const state: { admin: unknown; throwEnv: boolean } = { admin: null, throwEnv: false };
vi.mock("../src/lib/supabase/admin", () => ({
  adminClient: () => {
    if (state.throwEnv) z.object({ SUPABASE_SERVICE_ROLE_KEY: z.string().min(20) }).parse({});
    return state.admin;
  },
}));

import { createAccount, envProblem, explainAuthError, explainDbError, tempPassword } from "../src/lib/account-admin";
import { passwordSchema } from "../src/lib/auth/password-policy";

interface Opts { existsUsername?: boolean; authErrors?: Array<{ message: string; status?: number; code?: string } | null>; dbFail?: { table: string; error: { message: string; code?: string } } }
function fakeAdmin(o: Opts = {}) {
  const log: string[] = [];
  const errs = [...(o.authErrors ?? [null])];
  const admin = {
    log,
    auth: { admin: {
      createUser: async (a: { email: string }) => { log.push(`createUser:${a.email.split("@")[1]}`); const e = errs.shift() ?? null; return e ? { data: { user: null }, error: e } : { data: { user: { id: "UID1" } }, error: null }; },
      deleteUser: async () => { log.push("deleteUser"); return {}; },
    } },
    from(table: string) {
      const chain = {
        select: () => chain, eq: () => chain,
        maybeSingle: async () => ({ data: o.existsUsername ? { id: "X" } : null, error: null }),
        insert: async () => { log.push(`insert:${table}`); return o.dbFail?.table === table ? { error: o.dbFail.error } : { error: null }; },
        delete: () => ({ eq: async () => { log.push(`delete:${table}`); return {}; } }),
      };
      return chain;
    },
  };
  return admin;
}
const actor = { id: "A1", organizationId: "O1" };
const base = { username: "tengko.wolok", fullName: "TENGKO WOLOK, S.T.", roles: ["pptk" as const], password: "Abcdefghi1!" };

beforeEach(() => { state.throwEnv = false; });

describe("pesan galat yang dapat ditindaklanjuti", () => {
  it("kunci server ditolak -> menyebut service_role", () => {
    expect(explainAuthError({ status: 401, message: "Invalid API key" })).toContain("service_role");
    expect(explainAuthError({ message: "JWT expired" })).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });
  it("kata sandi, email, database, dan batas laju", () => {
    expect(explainAuthError({ code: "weak_password", message: "Password should contain symbols" })).toContain("Kata sandi ditolak");
    expect(explainAuthError({ message: "Database error creating new user" })).toContain("trigger");
    expect(explainAuthError({ status: 429, message: "x" })).toContain("Terlalu banyak");
    expect(explainAuthError({ message: "weird" })).toContain("weird");
  });
  it("galat basis data", () => {
    expect(explainDbError({ code: "42P01", message: "relation does not exist" })).toContain("migrasi");
    expect(explainDbError({ code: "23505", message: "dup" })).toContain("sudah dipakai");
    expect(explainDbError({ code: "42501", message: "permission denied" })).toContain("service_role");
  });
  it("variabel lingkungan yang kurang disebut namanya", () => {
    try { z.object({ SUPABASE_SERVICE_ROLE_KEY: z.string().min(20), APP_SECRET: z.string().min(32) }).parse({}); } catch (e) {
      expect(envProblem(e)).toContain("SUPABASE_SERVICE_ROLE_KEY");
      expect(envProblem(e)).toContain("APP_SECRET");
    }
    expect(envProblem(new Error("x"))).toBeNull();
  });
});

describe("kata sandi sementara", () => {
  it("memenuhi kebijakan dan selalu berbeda", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) { const p = tempPassword(); expect(passwordSchema.safeParse(p).success).toBe(true); expect(/[!@#$%*?\-_]/.test(p)).toBe(true); seen.add(p); }
    expect(seen.size).toBe(50);
  });
});

describe("createAccount", () => {
  it("sukses: membuat auth, profil, identitas, peran (PPTK tanpa scope)", async () => {
    const a = fakeAdmin(); state.admin = a;
    const r = await createAccount(actor, base);
    expect(r).toEqual({ ok: true, id: "UID1" });
    expect(a.log).toEqual(expect.arrayContaining(["createUser:auth.simaspraja.invalid", "insert:profiles", "insert:auth_identities", "insert:user_roles", "insert:audit_logs"]));
    expect(a.log).not.toContain("insert:user_scopes");
  });
  it("peran Admin/PPK memperoleh scope organisasi", async () => {
    const a = fakeAdmin(); state.admin = a;
    await createAccount(actor, { ...base, roles: ["ppk"] });
    expect(a.log).toContain("insert:user_scopes");
  });
  it("variabel server hilang -> pesan menyebut variabel", async () => {
    state.throwEnv = true;
    const r = await createAccount(actor, base);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });
  it("kunci ditolak Supabase -> pesan jelas, tidak membuat profil", async () => {
    const a = fakeAdmin({ authErrors: [{ message: "Invalid API key", status: 401 }] }); state.admin = a;
    const r = await createAccount(actor, base);
    expect(!r.ok && r.error).toContain("service_role");
    expect(a.log).not.toContain("insert:profiles");
  });
  it("email internal ditolak -> mencoba domain cadangan lalu berhasil", async () => {
    const a = fakeAdmin({ authErrors: [{ message: "Unable to validate email address: invalid format" }, null] }); state.admin = a;
    const r = await createAccount(actor, base);
    expect(r.ok).toBe(true);
    expect(a.log.filter((l) => l.startsWith("createUser"))).toEqual(["createUser:auth.simaspraja.invalid", "createUser:simaspraja-akun.example.com"]);
  });
  it("kata sandi lemah tidak diulang dengan domain lain", async () => {
    const a = fakeAdmin({ authErrors: [{ message: "Password should be at least 12 characters", code: "weak_password" }] }); state.admin = a;
    const r = await createAccount(actor, base);
    expect(!r.ok && r.error).toContain("Kata sandi ditolak");
    expect(a.log.filter((l) => l.startsWith("createUser"))).toHaveLength(1);
  });
  it("gagal menyimpan peran -> akun dibersihkan dan alasan ditampilkan", async () => {
    const a = fakeAdmin({ dbFail: { table: "user_roles", error: { message: "boom", code: "42501" } } }); state.admin = a;
    const r = await createAccount(actor, base);
    expect(!r.ok && r.error).toContain("Akun dibatalkan");
    expect(a.log).toEqual(expect.arrayContaining(["delete:profiles", "deleteUser"]));
    expect(a.log).not.toContain("insert:audit_logs");
  });
  it("username ganda dan masukan tidak valid ditolak lebih awal", async () => {
    state.admin = fakeAdmin({ existsUsername: true });
    expect((await createAccount(actor, base))).toMatchObject({ ok: false });
    expect((await createAccount(actor, { ...base, username: "AB" }))).toMatchObject({ ok: false });
    expect((await createAccount(actor, { ...base, roles: [] }))).toMatchObject({ ok: false });
    expect((await createAccount(actor, { ...base, password: "pendek" }))).toMatchObject({ ok: false });
  });
});
