import { describe, expect, it, vi } from "vitest";
import {
  CAPTCHA_ERROR, CONTEXT_FORM_ERROR, DUMMY_EMAIL, GENERIC_LOGIN_ERROR,
  THROTTLED_LOGIN_ERROR, performLogin, type LoginDeps, type LoginInput, type ProfileLookup,
} from "@/lib/auth/login-core";

const SECRET_EMAIL = "7f3c1c52-0000-4000-8000-aaaaaaaaaaaa@auth.simaspraja.invalid";

function makeDeps(opts: {
  profile?: Partial<ProfileLookup> | null;
  passwordOk?: boolean;
  userFails?: number;
  ipFails?: number;
  captchaOk?: boolean;
  versionId?: string | null;
} = {}) {
  const profile: ProfileLookup | null =
    opts.profile === null
      ? null
      : { id: "u1", status: "active", organizationId: "o1", internalEmail: SECRET_EMAIL, mustChangePassword: false, ...opts.profile };

  const calls = {
    signIn: [] as Array<{ email: string; password: string }>,
    audits: [] as Array<Record<string, unknown>>,
    attempts: [] as Array<{ usernameHash: string; ipHash: string; succeeded: boolean }>,
    captcha: [] as Array<{ token: string; answer: string }>,
    resolveContext: [] as Array<{ year: number; stage: string }>,
    findProfile: vi.fn(),
    touch: vi.fn(),
    signOut: vi.fn(),
  };

  const deps: LoginDeps = {
    config: { maxFailuresPerUser: 5, maxFailuresPerIp: 20, windowMinutes: 15 },
    now: () => new Date("2026-10-10T00:00:00Z"),
    hash: async (p, v) => `${p}#${v}`,
    consumeCaptcha: async (token, answer) => { calls.captcha.push({ token, answer }); return opts.captchaOk ?? true; },
    countFailures: async (by) => (by === "username_hash" ? (opts.userFails ?? 0) : (opts.ipFails ?? 0)),
    recordAttempt: async (a) => void calls.attempts.push(a),
    findProfile: async (u) => { calls.findProfile(u); return profile; },
    signIn: async (email, password) => {
      calls.signIn.push({ email, password });
      return { ok: email !== DUMMY_EMAIL && (opts.passwordOk ?? true) };
    },
    signOut: async () => void calls.signOut(),
    resolveContext: async (year, stage) => {
      calls.resolveContext.push({ year, stage });
      return opts.versionId === undefined ? "ver-1" : opts.versionId;
    },
    audit: async (e) => void calls.audits.push(e),
    touchLastLogin: async (id) => void calls.touch(id),
  };
  return { deps, calls };
}

const input: LoginInput = {
  username: "pptk.ekonomi", password: "Rahasia12345", year: 2026, stage: "murni",
  captchaToken: "tok", captchaAnswer: "AB3KD", ip: "10.0.0.1",
};
const FAIL = (message: string) => ({ ok: false, message, refreshCaptcha: true });

describe("performLogin - keberhasilan", () => {
  it("masuk dengan username+password dan memakai email internal hanya di server", async () => {
    const { deps, calls } = makeDeps();
    const res = await performLogin(deps, input);
    expect(res).toEqual({
      ok: true, mustChangePassword: false, userId: "u1",
      context: { year: 2026, stage: "murni", versionId: "ver-1" },
    });
    expect(calls.signIn).toEqual([{ email: SECRET_EMAIL, password: input.password }]);
    expect(calls.touch).toHaveBeenCalledWith("u1");
    expect(calls.audits.at(-1)).toMatchObject({ action: "LOGIN_SUCCESS", actorId: "u1" });
  });

  it("hasil tidak pernah memuat email internal", async () => {
    const { deps } = makeDeps();
    const res = await performLogin(deps, input);
    expect(JSON.stringify(res)).not.toContain("auth.simaspraja.invalid");
  });

  it("konteks tahun + tahapan divalidasi ke database setelah kata sandi benar", async () => {
    const { deps, calls } = makeDeps();
    await performLogin(deps, { ...input, year: 2025, stage: "perubahan" });
    expect(calls.resolveContext).toEqual([{ year: 2025, stage: "perubahan" }]);
  });

  it("username dinormalisasi (huruf besar & spasi)", async () => {
    const { deps, calls } = makeDeps();
    await performLogin(deps, { ...input, username: "  PPTK.Ekonomi " });
    expect(calls.findProfile).toHaveBeenCalledWith("pptk.ekonomi");
  });

  it("meneruskan flag wajib ganti kata sandi", async () => {
    const { deps } = makeDeps({ profile: { mustChangePassword: true } });
    const res = await performLogin(deps, input);
    expect(res).toMatchObject({ ok: true, mustChangePassword: true });
  });
});

describe("performLogin - kegagalan tidak membocorkan informasi", () => {
  it("kata sandi salah -> pesan generik + catatan percobaan gagal + audit", async () => {
    const { deps, calls } = makeDeps({ passwordOk: false });
    const res = await performLogin(deps, input);
    expect(res).toEqual(FAIL(GENERIC_LOGIN_ERROR));
    expect(calls.attempts[0]).toMatchObject({ succeeded: false });
    expect(calls.audits.at(-1)).toMatchObject({ action: "LOGIN_FAILURE", context: { reason: "bad_credentials" } });
    expect(calls.touch).not.toHaveBeenCalled();
  });

  it("username tak dikenal, akun ditangguhkan, dan kata sandi salah menghasilkan pesan IDENTIK", async () => {
    const wrong = await performLogin(makeDeps({ passwordOk: false }).deps, input);
    const unknown = await performLogin(makeDeps({ profile: null }).deps, input);
    const suspended = await performLogin(makeDeps({ profile: { status: "suspended" } }).deps, input);
    const disabled = await performLogin(makeDeps({ profile: { status: "disabled" } }).deps, input);
    expect(unknown).toEqual(wrong);
    expect(suspended).toEqual(wrong);
    expect(disabled).toEqual(wrong);
  });

  it("akun ditangguhkan TIDAK dapat masuk walau kata sandi benar", async () => {
    const { deps, calls } = makeDeps({ profile: { status: "suspended" }, passwordOk: true });
    const res = await performLogin(deps, input);
    expect(res.ok).toBe(false);
    // signIn dilakukan dengan email palsu, bukan email akun yang sebenarnya
    expect(calls.signIn).toEqual([{ email: DUMMY_EMAIL, password: input.password }]);
  });

  it("username tak dikenal tetap memicu satu signIn palsu (menyamakan waktu respons)", async () => {
    const { deps, calls } = makeDeps({ profile: null });
    await performLogin(deps, input);
    expect(calls.signIn).toHaveLength(1);
    expect(calls.signIn[0]!.email).toBe(DUMMY_EMAIL);
    expect(calls.audits.at(-1)).toMatchObject({ context: { reason: "unknown_user" } });
  });

  it("format username/sandi tidak valid ditolak generik tanpa menyentuh database", async () => {
    for (const bad of [{ username: "a" }, { username: "bad name!" }, { username: "x".repeat(40) }, { password: "" }, { password: "p".repeat(129) }]) {
      const { deps, calls } = makeDeps();
      const res = await performLogin(deps, { ...input, ...bad });
      expect(res).toEqual(FAIL(GENERIC_LOGIN_ERROR));
      expect(calls.findProfile).not.toHaveBeenCalled();
      expect(calls.signIn).toHaveLength(0);
    }
  });
});

describe("performLogin - throttling", () => {
  it("memblokir setelah batas gagal per username, tanpa mencoba signIn", async () => {
    const { deps, calls } = makeDeps({ userFails: 5 });
    const res = await performLogin(deps, input);
    expect(res).toEqual(FAIL(THROTTLED_LOGIN_ERROR));
    expect(calls.signIn).toHaveLength(0);
    expect(calls.findProfile).not.toHaveBeenCalled();
    expect(calls.audits.at(-1)).toMatchObject({ action: "LOGIN_THROTTLED" });
  });

  it("memblokir per IP walau username berbeda-beda", async () => {
    const { deps, calls } = makeDeps({ ipFails: 20 });
    expect((await performLogin(deps, input)).ok).toBe(false);
    expect(calls.signIn).toHaveLength(0);
  });

  it("4 kegagalan masih diizinkan mencoba (batas = 5)", async () => {
    const { deps } = makeDeps({ userFails: 4 });
    expect((await performLogin(deps, input)).ok).toBe(true);
  });

  it("throttling juga berlaku untuk username yang tidak ada (tidak membedakan keberadaan akun)", async () => {
    const { deps } = makeDeps({ profile: null, userFails: 5 });
    expect(await performLogin(deps, input)).toEqual(FAIL(THROTTLED_LOGIN_ERROR));
  });

  it("menghitung jendela waktu 15 menit ke belakang", async () => {
    const seen: string[] = [];
    const { deps } = makeDeps();
    deps.countFailures = async (_by, _h, since) => { seen.push(since); return 0; };
    await performLogin(deps, input);
    expect(seen[0]).toBe("2026-10-09T23:45:00.000Z");
  });
});

describe("performLogin - kode keamanan (CAPTCHA)", () => {
  it("kode salah/kedaluwarsa ditolak sebelum throttling, pencarian profil, dan signIn", async () => {
    const { deps, calls } = makeDeps({ captchaOk: false });
    expect(await performLogin(deps, input)).toEqual(FAIL(CAPTCHA_ERROR));
    expect(calls.findProfile).not.toHaveBeenCalled();
    expect(calls.signIn).toHaveLength(0);
    expect(calls.attempts).toHaveLength(0); // tidak menghitung sebagai kegagalan akun (cegah penguncian akun orang lain)
    expect(calls.audits.at(-1)).toMatchObject({ action: "LOGIN_CAPTCHA_FAILED" });
  });

  it("token dan jawaban diteruskan apa adanya ke penguji kode", async () => {
    const { deps, calls } = makeDeps();
    await performLogin(deps, input);
    expect(calls.captcha).toEqual([{ token: "tok", answer: "AB3KD" }]);
  });

  it("setiap kegagalan meminta kode baru (kode lama sudah habis dipakai)", async () => {
    for (const d of [makeDeps({ passwordOk: false }), makeDeps({ captchaOk: false }), makeDeps({ userFails: 5 })]) {
      const res = await performLogin(d.deps, input);
      expect(res).toMatchObject({ ok: false, refreshCaptcha: true });
    }
  });
});

describe("performLogin - tahun & tahapan anggaran pada halaman masuk", () => {
  it("tahapan atau tahun tidak valid ditolak sebelum menyentuh database", async () => {
    for (const bad of [{ stage: "final" }, { stage: "" }, { year: 1999 }, { year: 2101 }, { year: Number.NaN }, { year: 2026.5 }]) {
      const { deps, calls } = makeDeps();
      expect(await performLogin(deps, { ...input, ...bad })).toEqual(FAIL(CONTEXT_FORM_ERROR));
      expect(calls.captcha).toHaveLength(0);
      expect(calls.signIn).toHaveLength(0);
    }
  });

  it("kata sandi benar tetapi konteks belum tersedia -> TETAP masuk tanpa konteks (admin dapat membuat versi anggaran)", async () => {
    const { deps, calls } = makeDeps({ versionId: null });
    expect(await performLogin(deps, input)).toEqual({ ok: true, mustChangePassword: false, userId: "u1", context: null });
    expect(calls.signOut).not.toHaveBeenCalled();
    expect(calls.audits.at(-1)).toMatchObject({ action: "LOGIN_CONTEXT_UNAVAILABLE", actorId: "u1" });
    expect(calls.audits.some((a) => a.action === "LOGIN_SUCCESS")).toBe(false);
  });

  it("IP tidak diketahui tidak dihitung pada pembatasan IP (tidak mengunci seluruh pengguna)", async () => {
    const { deps } = makeDeps({ ipFails: 999 });
    expect((await performLogin(deps, { ...input, ip: null })).ok).toBe(true);
  });

  it("masuk berhasil membersihkan catatan gagal username tersebut", async () => {
    const { deps } = makeDeps();
    const cleared: string[] = [];
    deps.clearFailures = async (h) => void cleared.push(h);
    await performLogin(deps, input);
    expect(cleared).toEqual(["username#pptk.ekonomi"]);
  });

  it("konteks tidak diperiksa bila kata sandi salah (tahun tidak dapat diintip tanpa akun sah)", async () => {
    const { deps, calls } = makeDeps({ passwordOk: false });
    await performLogin(deps, input);
    expect(calls.resolveContext).toHaveLength(0);
  });
});
