import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { CONTEXT_COOKIE, verifyContext } from "@/lib/auth/context";

/**
 * Gerbang lapis pertama (cepat, tanpa query DB):
 *  1. Menyegarkan sesi Supabase dan memvalidasi JWT lewat auth.getUser().
 *  2. Pengguna tanpa sesi -> /login.
 *  3. Pengguna tanpa cookie konteks yang sah -> /pilih-konteks.
 * Otorisasi sesungguhnya tetap dilakukan di service layer dan RLS (middleware bukan batas keamanan tunggal).
 */
// Beranda "/" terbuka untuk siapa pun. "/login" hanya untuk tamu (pengguna masuk dialihkan ke dasbor).
const OPEN_PATHS = new Set(["/"]);
const PUBLIC_PATHS = new Set(["/login"]);
const NO_CONTEXT_PATHS = ["/pilih-konteks", "/ganti-password"];
// Batas waktu panggilan ke Supabase di middleware. Tanpa ini, Supabase yang tidak merespons (proyek dijeda/URL salah/jaringan)
// membuat SELURUH halaman menggantung sampai Vercel memutus dengan 504 MIDDLEWARE_INVOCATION_TIMEOUT.
const AUTH_TIMEOUT_MS = 8000;

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Beranda terbuka untuk siapa pun: tidak perlu menunggu Supabase sama sekali.
  if (OPEN_PATHS.has(request.nextUrl.pathname)) return response;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(AUTH_TIMEOUT_MS) }) },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // Gagal/lambat/tidak terjangkau = diperlakukan sebagai belum masuk (halaman /login tetap terbuka, tidak 504).
  let user: { id: string } | null = null;
  try {
    const res = await Promise.race([
      supabase.auth.getUser(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("auth timeout")), AUTH_TIMEOUT_MS)),
    ]);
    user = res.data.user;
  } catch {
    user = null;
  }
  const path = request.nextUrl.pathname;

  const redirectTo = (to: string) => {
    const url = request.nextUrl.clone();
    url.pathname = to;
    url.search = "";
    const res = NextResponse.redirect(url);
    // Pertahankan cookie sesi yang baru disegarkan.
    response.cookies.getAll().forEach((c) => res.cookies.set(c));
    return res;
  };

  if (OPEN_PATHS.has(path)) return response;
  if (!user) return PUBLIC_PATHS.has(path) ? response : redirectTo("/login");
  if (PUBLIC_PATHS.has(path)) return redirectTo("/dashboard");

  if (!NO_CONTEXT_PATHS.some((p) => path.startsWith(p))) {
    const secret = process.env.APP_SECRET ?? "";
    const ctx = secret
      ? await verifyContext(secret, request.cookies.get(CONTEXT_COOKIE)?.value, { userId: user.id })
      : null;
    if (!ctx) return redirectTo("/pilih-konteks");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
