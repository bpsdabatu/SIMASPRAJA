import { NextResponse, type NextRequest } from "next/server";
import { userClient } from "@/lib/supabase/server";
import { getBudgetContext, getSessionUser } from "@/lib/auth/session";
import { loadQuarterReport } from "@/lib/quarterly";
import { buildQuarterPdf } from "@/lib/quarterly-pdf";
import { getPrintSettings } from "@/lib/print-settings-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !user.permissions.has("recap.export")) return new NextResponse("Tidak berwenang", { status: 403 });
  const ctx = await getBudgetContext();
  if (!ctx) return new NextResponse("Konteks anggaran belum dipilih", { status: 409 });
  const sp = req.nextUrl.searchParams;
  const { report, error } = await loadQuarterReport(await userClient(), ctx, user.organizationId, { quarter: sp.get("tw"), pptk: sp.get("pptk") });
  if (error) return new NextResponse("Data tidak dapat dimuat", { status: 500 });
  const buf = await buildQuarterPdf(report, await getPrintSettings());
  return new NextResponse(new Uint8Array(buf), { headers: {
    "Content-Type": "application/pdf", "Cache-Control": "no-store",
    "Content-Disposition": `attachment; filename="laporan-triwulan-${report.quarter}-${ctx.year}.pdf"`,
  } });
}
