import { NextResponse, type NextRequest } from "next/server";
import { userClient } from "@/lib/supabase/server";
import { getBudgetContext, getSessionUser } from "@/lib/auth/session";
import { csvResponseHeaders, toCsv } from "@/lib/csv";
import { buildXlsx, xlsxHeaders } from "@/lib/spreadsheet";
import { loadBudgetItems } from "@/lib/budget-items";
import { quarterSums } from "@/lib/cash-core";
import { fetchAll } from "@/lib/fetch-all";

export const dynamic = "force-dynamic";

/**
 * Templat impor Anggaran Kas TRIWULAN: berisi butir dari Input Anggaran tahapan yang dibuka (id_butir, Program/Kegiatan/Sub Kegiatan/Rekening,
 * sumber dana, PPTK, pagu) dan isian TW yang sudah ada. PPTK menerima butir penugasannya; ADMIN menerima seluruh butir ber-PPTK
 * (untuk didistribusikan ke PPTK lewat unggah).
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  const isAdmin = !!user?.roles.includes("admin");
  if (!user || (!isAdmin && !user.permissions.has("cashplan.edit"))) return new NextResponse("Tidak berwenang", { status: 403 });
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
  const open = (id: string) => ["draft", "returned", undefined].includes(planOf.get(id)?.status);
  const mine = items.filter((r) => (isAdmin ? !!r.pptkId : r.pptkId === user.id) && open(r.itemId));

  const header = ["id_butir", "kode_program", "kode_kegiatan", "kode_sub_kegiatan", "kode_rekening", "sumber_dana", "uraian", "pptk", "pagu", "tw1", "tw2", "tw3", "tw4"];
  const body = mine.map((r) => {
    const p = planOf.get(r.itemId);
    const m = Array.from({ length: 12 }, (_, i) => Number(p?.cash_budget_periods.find((x) => x.period_type === "month" && x.period_no === i + 1)?.amount ?? 0));
    return [r.itemId, r.programCode, r.activityCode, r.subCode, r.accountCode, r.funding, r.description || r.subName, r.pptk, r.pagu, ...quarterSums(m).map((v) => v || "")] as (string | number)[];
  });
  if (req.nextUrl.searchParams.get("format") === "csv") return new NextResponse(toCsv([header, ...body]), { headers: csvResponseHeaders("templat-anggaran-kas-triwulan.csv") });
  const buf = await buildXlsx([{ name: "Anggaran Kas TW", header, rows: body, widths: [38, 12, 16, 20, 20, 16, 40, 24, 16, 16, 16, 16, 16], moneyCols: [8, 9, 10, 11, 12] }]);
  return new NextResponse(new Uint8Array(buf), { headers: xlsxHeaders("templat-anggaran-kas-triwulan.xlsx") });
}
