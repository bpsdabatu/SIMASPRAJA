import { describe, expect, it } from "vitest";
import { classifySignInError, describeSignInError } from "@/lib/auth/signin-error";

describe("classifySignInError", () => {
  it("kata sandi salah = galat kredensial", () => {
    expect(classifySignInError({ code: "invalid_credentials", status: 400, message: "Invalid login credentials" })).toBe("credentials");
    expect(classifySignInError({ status: 400, message: "Invalid login credentials" })).toBe("credentials");
  });
  it("email belum terkonfirmasi / akun diblokir = galat kredensial (pesan tetap generik)", () => {
    expect(classifySignInError({ code: "email_not_confirmed", status: 400 })).toBe("credentials");
    expect(classifySignInError({ code: "user_banned", status: 400 })).toBe("credentials");
  });
  it("kunci/URL salah, rate limit, jaringan = galat sistem (bukan kata sandi salah)", () => {
    expect(classifySignInError({ status: 401, message: "Invalid API key" })).toBe("system");
    expect(classifySignInError({ code: "bad_jwt", status: 401 })).toBe("system");
    expect(classifySignInError({ code: "over_request_rate_limit", status: 429 })).toBe("system");
    expect(classifySignInError({ name: "AuthRetryableFetchError", status: 0, message: "fetch failed" })).toBe("system");
    expect(classifySignInError({ status: 500, message: "Database error" })).toBe("system");
  });
  it("ringkasan log tidak memuat nilai rahasia dan dipotong", () => {
    const s = describeSignInError({ name: "AuthApiError", code: "x", status: 401, message: "m".repeat(500) });
    expect(s.length).toBeLessThanOrEqual(200);
    expect(s).toContain("status 401");
  });
});
