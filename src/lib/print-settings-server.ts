import "server-only";
import { cookies } from "next/headers";
import { DEFAULT_PRINT, PRINT_COOKIE, parsePrintSettings, type PrintSettings } from "@/lib/print-settings";

/** Pengaturan cetak pengguna saat ini (cookie). Di luar permintaan web (skrip/tes) -> bawaan. */
export async function getPrintSettings(): Promise<PrintSettings> {
  try { return parsePrintSettings((await cookies()).get(PRINT_COOKIE)?.value); } catch { return DEFAULT_PRINT; }
}
