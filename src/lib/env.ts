import "server-only";
import { z } from "zod";

/**
 * Validasi variabel lingkungan. Dipanggil secara malas (lazy) agar `next build`
 * tidak gagal saat variabel tidak ada di lingkungan build tertentu.
 * Rahasia server TIDAK PERNAH dibaca dari variabel ber-awalan NEXT_PUBLIC_.
 */
/** Nama variabel kunci server untuk pesan galat (satu-satunya tempat nama ini berada di luar admin.ts; nilainya TIDAK dibaca di sini). */
export const SERVICE_KEY_VAR = "SUPABASE_SERVICE_ROLE_KEY";

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
});

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  APP_SECRET: z.string().min(32, "APP_SECRET minimal 32 karakter"),
  LOGIN_MAX_FAILURES_PER_USER: z.coerce.number().int().min(1).default(5),
  LOGIN_MAX_FAILURES_PER_IP: z.coerce.number().int().min(1).default(20),
  LOGIN_WINDOW_MINUTES: z.coerce.number().int().min(1).default(15),
});

export function publicEnv() {
  return publicSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

export function serverEnv() {
  return serverSchema.parse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    APP_SECRET: process.env.APP_SECRET,
    LOGIN_MAX_FAILURES_PER_USER: process.env.LOGIN_MAX_FAILURES_PER_USER,
    LOGIN_MAX_FAILURES_PER_IP: process.env.LOGIN_MAX_FAILURES_PER_IP,
    LOGIN_WINDOW_MINUTES: process.env.LOGIN_WINDOW_MINUTES,
  });
}
