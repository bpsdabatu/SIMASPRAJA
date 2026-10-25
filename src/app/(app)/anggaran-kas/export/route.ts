import { NextResponse, type NextRequest } from "next/server";
import { userClient } from "@/lib/supabase/server";
import { getBudgetContext, getSessionUser } from "@/lib/auth/session";
import { csvResponseHeaders, toCsv } from "@/lib/csv";
import { buildXlsx, xlsxHeaders } from "@/lib/spreadsheet";
import { loadBudgetItems } from "@/lib/budget-items";
import { fetchAll } from "@/lib/fetch-all";
import { STAGE_LABEL } from "@/lib/auth/context";
import { quarterSums } from "@/lib/cash-core";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { draft: "Draf", submitted: "Diajukan", returned: "Dikembalikan", final: "Final" };

interface PlanRow { budget_item_id: string; status: string; revision_no: number; cash_budget_periods: { period_no: number; period_type: string; amount: string | number }[] }

/** Unduh Anggaran Kas TRIWULAN per butir (Excel/CSV). */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !user.permissions.has("cashplan.view")) return new NextResponse("Tidak berwenang", { status: 403 });
  const ctx = await getBudgetContext();
  if (!ctx) return new NextResponse("Konteks anggaran belum dipilih", { status: 409 });
  const sb = await userClient();
  const [{ rows: items, error }, plans] = await Promise.all([
    loadBudgetItems(sb, ctx.versionId),
    fetchAll<PlanRow>((from, to) => sb.from("cash_budget_plans").select("budget_item_id, status, revision_no, cash_budget_periods(period_no, period_type, amount)").eq("budget_version_id", ctx.versionId).order("id").range(from, to)),
  ]);
  if (error || plans.error) return new NextResponse("Data tidak dapat dimuat", { status: 500 });
  const planOf = new Map(plans.rows.map((p) => [p.budget_item_id, p]));

  const header = ["Kode Program", "Kode Kegiatan", "Kode Sub Kegiatan", "Sub Kegiatan", "Kode Rekening", "Rekening Belanja", "Uraian", "PPTK", "Pagu", "TW I", "TW II", "TW III", "TW IV", "Total Kas", "Sisa Belum Dialokasikan", "Status"];
  const totals = [0, 0, 0, 0];
  let totalPagu = 0;
  const body: (string | number)[][] = items.map((r) => {
    const p = planOf.get(r.itemId);
    const m = Array.from({ length: 12 }, (_, i) => Number(p?.cash_budget_periods.find((x) => x.period_type === "month" && x.period_no === i + 1)?.amount ?? 0));
    const tw = quarterSums(m);
    tw.forEach((v, i) => { totals[i]! += v; });
    totalPagu += r.pagu;
    const sum = tw.reduce((a, b) => a + b, 0);
    return [r.programCode, r.activityCode, r.subCode, r.subName, r.accountCode, r.accountName, r.description, r.pptk, r.pagu, ...tw, sum, r.pagu - sum, p ? (STATUS[p.status] ?? p.status) : "Belum disusun"];
  });
  const grand = totals.reduce((a, b) => a + b, 0);
  body.push(["", "", "", "", "", "", "", "TOTAL", totalPagu, ...totals, grand, totalPagu - grand, ""]);

  const base = `anggaran-kas-${ctx.year}-${ctx.stage}`;
  if (req.nextUrl.searchParams.get("format") === "csv") return new NextResponse(toCsv([header, ...body]), { headers: csvResponseHeaders(`${base}.csv`) });
  const money = Array.from({ length: 6 }, (_, i) => 8 + i);
  const buf = await buildXlsx([{
    name: "Anggaran Kas", title: [`Anggaran Kas — Tahun Anggaran ${ctx.year} (${STAGE_LABEL[ctx.stage]})`],
    header, rows: body, widths: [12, 16, 20, 30, 20, 30, 26, 22, 16, 15, 15, 15, 15, 16, 18, 14], moneyCols: money,
  }]);
  return new NextResponse(new Uint8Array(buf), { headers: xlsxHeaders(`${base}.xlsx`) });
}
