import { NextResponse, type NextRequest } from "next/server";
import { userClient } from "@/lib/supabase/server";
import { getBudgetContext, getSessionUser } from "@/lib/auth/session";
import { csvResponseHeaders, toCsv } from "@/lib/csv";
import { buildXlsx, xlsxHeaders } from "@/lib/spreadsheet";
import { loadBudgetItems } from "@/lib/budget-items";
import { fetchAll } from "@/lib/fetch-all";

export const dynamic = "force-dynamic";

const MONTHS = ["jan", "feb", "mar", "apr", "mei", "jun", "jul", "agu", "sep", "okt", "nov", "des"];

/**
 * Templat impor Anggaran Kas: sudah berisi butir dari Input Anggaran (id_butir, kode, pagu) dan isian bulan
 * yang telah ada. PPTK hanya menerima butir penugasannya (RLS); admin/PPK melihat seluruhnya tetapi tidak dapat menyimpan.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !user.permissions.has("cashplan.edit")) return new NextResponse("Tidak berwenang", { status: 403 });
  const ctx = await getBudgetContext();
  if (!ctx) return new NextResponse("Konteks anggaran belum dipilih", { status: 409 });
  const sb = await userClient();
  const [{ rows: items, error }, plans] = await Promise.all([
    loadBudgetItems(sb, ctx.versionId),
    fetchAll<{ budget_item_id: string; status: string; cash_budget_periods: { period_no: number; period_type: string; amount: string | number }[] }>((from, to) =>
      sb.from("cash_budget_plans").select("budget_item_id, status, cash_budget_periods(period_no, period_type, amount)").eq("budget_version_id", ctx.versionId).order("id").range(from, to)),
  ]);
  if (error || plans.error) return new NextResponse("Data tidak dapat dimuat", { status: 500 });
  const planOf = new Map(plans.rows.map((p) => [p.budget_item_id, p]));
  const mine = items.filter((r) => r.pptkId === user.id && ["draft", "returned", undefined].includes(planOf.get(r.itemId)?.status));

  const tw = req.nextUrl.searchParams.get("periode") === "tw";
  const periods = tw ? ["tw1", "tw2", "tw3", "tw4"] : MONTHS;
  const header = ["id_butir", "kode_sub_kegiatan", "kode_rekening", "sumber_dana", "uraian", "pagu", ...periods];
  const body = mine.map((r) => {
    const p = planOf.get(r.itemId);
    const m = MONTHS.map((_, i) => Number(p?.cash_budget_periods.find((x) => x.period_type === "month" && x.period_no === i + 1)?.amount ?? 0));
    const vals = tw ? [0, 1, 2, 3].map((q) => Math.round((m[q * 3]! + m[q * 3 + 1]! + m[q * 3 + 2]!) * 100) / 100) : m;
    return [r.itemId, r.subCode, r.accountCode, r.funding, r.description || r.subName, r.pagu, ...vals.map((v) => v || "")] as (string | number)[];
  });
  if (req.nextUrl.searchParams.get("format") === "csv") return new NextResponse(toCsv([header, ...body]), { headers: csvResponseHeaders("templat-anggaran-kas.csv") });
  const buf = await buildXlsx([{ name: "Anggaran Kas", header, rows: body, widths: [38, 20, 18, 16, 40, 16, ...Array(periods.length).fill(14)], moneyCols: [5, ...periods.map((_, i) => 6 + i)] }]);
  return new NextResponse(new Uint8Array(buf), { headers: xlsxHeaders("templat-anggaran-kas.xlsx") });
}
