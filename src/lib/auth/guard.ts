import "server-only";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/session";

/** Konteks + sesi + izin modul. Pengguna tanpa izin dialihkan ke dasbor (RLS tetap penentu akses data). */
export async function requireModule(permission: string) {
  const ctx = await requireContext();
  if (!ctx.user.permissions.has(permission)) redirect("/dashboard?akses=ditolak");
  return ctx;
}

/** Seperti requireModule, tetapi hanya untuk akun berperan admin (mis. Laporan Realisasi Anggaran). Selain admin dialihkan ke dasbor. */
export async function requireAdminModule(permission: string) {
  const ctx = await requireModule(permission);
  if (!ctx.user.roles.includes("admin")) redirect("/dashboard?akses=ditolak");
  return ctx;
}

/** Seperti requireModule, tetapi cukup memiliki SALAH SATU izin. */
export async function requireAnyModule(permissions: string[]) {
  const ctx = await requireContext();
  if (!permissions.some((p) => ctx.user.permissions.has(p))) redirect("/dashboard?akses=ditolak");
  return ctx;
}
