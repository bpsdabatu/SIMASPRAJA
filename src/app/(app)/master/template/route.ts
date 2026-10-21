import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { MASTER } from "@/lib/master-config";
import { importTemplateRows } from "@/lib/master-import";
import { csvResponseHeaders, toCsv } from "@/lib/csv";
import { buildXlsx, xlsxHeaders } from "@/lib/spreadsheet";
import { usernameFromName } from "@/lib/master-seed";
import { SEED_PPTK_NAMES } from "@/data/master-bapersuda";

export const dynamic = "force-dynamic";

/** Templat impor Data Master per jenis (Excel/CSV). */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !user.permissions.has("master.manage")) return new NextResponse("Tidak berwenang", { status: 403 });
  const tab = req.nextUrl.searchParams.get("tab") ?? "";
  const format = req.nextUrl.searchParams.get("format") === "csv" ? "csv" : "xlsx";
  if (tab === "pptk" && !user.permissions.has("users.manage")) return new NextResponse("Tidak berwenang", { status: 403 });
  const prefill = req.nextUrl.searchParams.get("prefill") === "bawaan";
  const rows = tab === "pptk"
    ? [["username", "nama_lengkap", "nip", "jabatan"], ...(prefill
        ? SEED_PPTK_NAMES.map((n) => [usernameFromName(n), n, "", ""]) // nama dari master bawaan; username hanya usulan, NIP/jabatan dilengkapi admin
        : [["pptk.contoh", "Nama Lengkap PPTK", "198001012005011001", "Kepala Sub Bagian Contoh"]])]
    : importTemplateRows(tab);
  const cfg = tab === "pptk" ? { label: "PPTK" } : MASTER[tab];
  if (!rows || !cfg) return new NextResponse("Jenis master tidak dikenal", { status: 404 });
  const base = `templat-master-${tab}${tab === "pptk" && prefill ? "-bawaan" : ""}`;
  if (format === "csv") return new NextResponse(toCsv(rows), { headers: csvResponseHeaders(`${base}.csv`) });
  const buf = await buildXlsx([{ name: cfg.label, header: rows[0]!, rows: rows.slice(1) as (string | number)[][], widths: rows[0]!.map(() => 30) }]);
  return new NextResponse(new Uint8Array(buf), { headers: xlsxHeaders(`${base}.xlsx`) });
}
