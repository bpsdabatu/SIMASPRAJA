import type { Metadata } from "next";
import { requireModule } from "@/lib/auth/guard";
import { userClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { STAGE_LABEL } from "@/lib/auth/context";
import { getOrganizationName } from "@/lib/lookups";
import { formatRupiah } from "@/lib/format";
import { Badge, Card, CardHeader } from "@/components/ui/card";
import { Download, Repeat2, Upload } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { EmptyState, Flash, PageHeader } from "@/components/ui/page";
import { ConfirmSubmit, PrintButton, SubmitButton } from "@/components/ui/submit-button";
import { PrintFooter, PrintHeader, SignatureBlock } from "@/components/ui/report";
import { cashStatusAction, deleteCashPlanAction, saveCashPlanAction } from "./actions";
import { CashAdjustPanel, CashImportPanel } from "./cash-tools";
import { CashPlanGrid, type GridRow } from "./cash-plan-grid";

export const metadata: Metadata = { title: "Anggaran Kas" };
export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const STATUS = {
  none: { label: "Belum disusun", tone: "slate" }, draft: { label: "Draf", tone: "amber" }, submitted: { label: "Diajukan", tone: "navy" },
  returned: { label: "Dikembalikan", tone: "red" }, final: { label: "Final", tone: "green" },
} as const;
type St = keyof typeof STATUS;

interface ItemRow {
  budget_item_id: string; pagu: string | number;
  budget_items: {
    id: string; description: string | null; pptk_id: string | null;
    sub_activities: { code: string; name: string } | null; expenditure_accounts: { code: string; name: string } | null;
    pptk: { full_name: string } | null;
  } | null;
}
interface PlanRow { id: string; budget_item_id: string; status: St; revision_no: number; change_reason: string | null; cash_budget_periods: { period_no: number; period_type?: string; amount: string | number }[] }

export default async function AnggaranKasPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { user, context } = await requireModule("cashplan.view");
  const sp = await searchParams;
  const supabase = await userClient();
  const [itemsRes, plansRes, org, versRes] = await Promise.all([
    fetchAll<ItemRow>((from, to) => supabase.from("budget_item_versions")
      .select("budget_item_id, pagu, budget_items(id, description, pptk_id, sub_activities(code,name), expenditure_accounts(code,name), pptk:profiles!budget_items_pptk_id_fkey(full_name))")
      .eq("budget_version_id", context.versionId).order("budget_item_id").range(from, to)),
    fetchAll<PlanRow>((from, to) => supabase.from("cash_budget_plans").select("id, budget_item_id, status, revision_no, change_reason, cash_budget_periods(period_no, amount)")
      .eq("budget_version_id", context.versionId).order("id").range(from, to)),
    getOrganizationName(supabase, user.organizationId),
    supabase.from("budget_versions").select("id, stage_code, version_no, status, parent_version_id, created_at, fiscal_years(year)").order("created_at", { ascending: true }).limit(200),
  ]);
  type V = { id: string; stage_code: keyof typeof STAGE_LABEL; version_no: number; status: string; parent_version_id: string | null; fiscal_years: { year: number } | { year: number }[] | null };
  const yearOf = (v: V) => (Array.isArray(v.fiscal_years) ? v.fiscal_years[0]?.year : v.fiscal_years?.year);
  const allV = (versRes.data ?? []) as unknown as V[];
  const curV = allV.find((v) => v.id === context.versionId);
  const sameYear = allV.filter((v) => v.id !== context.versionId && curV && yearOf(v) === yearOf(curV));
  const sources = sameYear.map((v) => ({ id: v.id, label: `${STAGE_LABEL[v.stage_code]} v${v.version_no} (${v.status})` }));
  const defaultSource = (curV?.parent_version_id && sameYear.some((v) => v.id === curV.parent_version_id) ? curV.parent_version_id : sameYear[sameYear.length - 1]?.id) ?? "";
  const error = itemsRes.error;
  const items = itemsRes.rows.filter((r) => r.budget_items)
    .sort((a, b) => (a.budget_items!.sub_activities?.code ?? "").localeCompare(b.budget_items!.sub_activities?.code ?? "", "id", { numeric: true }));
  const plans = new Map(plansRes.rows.map((p) => [p.budget_item_id, p]));
  const canEdit = user.permissions.has("cashplan.edit");
  const canFinalize = user.permissions.has("cashplan.finalize");
  // Akun selain admin memakai tabel ringkas (isi semua butir sekaligus); admin tetap memakai tampilan kartu yang sudah ada.
  const isAdmin = user.roles.includes("admin");
  const gridRows: GridRow[] = items.map((r) => {
    const b = r.budget_items!;
    const plan = plans.get(r.budget_item_id);
    return {
      itemId: r.budget_item_id, planId: plan?.id ?? null,
      subCode: b.sub_activities?.code ?? "", subName: b.sub_activities?.name ?? "",
      account: `${b.expenditure_accounts?.code ?? ""} ${b.expenditure_accounts?.name ?? ""}`.trim(), desc: b.description ?? "", pptk: b.pptk?.full_name ?? "",
      pagu: Number(r.pagu),
      months: MONTHS.map((_, i) => Number(plan?.cash_budget_periods.find((p) => p.period_no === i + 1)?.amount ?? 0)),
      status: plan?.status ?? "none", rev: plan?.revision_no ?? 0, reason: plan?.change_reason ?? null,
      mine: b.pptk_id === user.id,
    };
  });
  const gridKey = gridRows.map((g) => `${g.itemId}:${g.status}:${g.rev}:${g.months.join(",")}`).join("|");

  const totals = MONTHS.map((_, i) => items.reduce((s, r) => s + Number(plans.get(r.budget_item_id)?.cash_budget_periods.find((p) => p.period_no === i + 1)?.amount ?? 0), 0));
  const grand = totals.reduce((a, b) => a + b, 0);
  const totalPagu = items.reduce((s, r) => s + Number(r.pagu), 0);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PrintHeader orgName={org} title="Anggaran Kas" subtitle={`Tahun Anggaran ${context.year} — ${STAGE_LABEL[context.stage]}`} />
      <PageHeader
        eyebrow={`TA ${context.year} · ${STAGE_LABEL[context.stage]}`}
        title="Anggaran Kas"
        description="Rencana penarikan kas bulanan per butir, disusun dari data Input Anggaran. PPTK mengisi semua butir dalam satu tabel lalu menyimpan/mengajukan sekaligus; pejabat berwenang mengembalikan atau memfinalisasi. Total kas tidak boleh melebihi pagu."
        actions={<>
          <a href="/anggaran-kas/export?format=xlsx" className={buttonVariants({ variant: "outline" })}><Download size={16} aria-hidden /> Excel</a>
          <a href="/anggaran-kas/export?format=csv" className={buttonVariants({ variant: "outline" })}><Download size={16} aria-hidden /> CSV</a>
          <PrintButton />
        </>}
      />
      <Flash ok={sp.ok} err={sp.err} />

      <Card className="no-print">
        <details>
          <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 text-sm font-semibold text-navy-800 [&::-webkit-details-marker]:hidden">Cara menambah data Anggaran Kas</summary>
          <ol className="list-decimal space-y-1.5 border-t border-slate-100 py-4 pl-9 pr-5 text-sm text-slate-700">
            <li><b>Admin</b>: isi pagu butir di <b>Input Anggaran</b> (versi yang dibuka) dan tetapkan <b>PPTK</b> pada tiap butir (Ubah → PPTK). Butir tanpa PPTK tidak dapat disusun kas-nya.</li>
            <li><b>PPTK</b> login pada tahun/tahapan yang sama, buka menu ini: setiap butir miliknya tampil sebagai kartu.</li>
            <li>Isi nominal <b>Januari–Desember</b> per butir, klik <b>Simpan draf</b> (total tidak boleh melebihi pagu). Alternatif: unduh templat Excel di bawah, isi, lalu unggah.</li>
            <li>Klik <b>Ajukan</b>. Pejabat berwenang (PPK/admin) <b>Finalisasi</b> atau <b>Kembalikan</b> (perbaiki lalu ajukan lagi). Draf yang salah dapat dihapus.</li>
          </ol>
        </details>
      </Card>

      {canEdit && (
        <Card className="no-print">
          <details>
            <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 text-sm font-semibold text-navy-800 [&::-webkit-details-marker]:hidden"><Upload size={16} aria-hidden /> Isi Anggaran Kas dari Excel / CSV</summary>
            <CashImportPanel versionId={context.versionId} />
          </details>
          <details className="border-t border-slate-100">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 text-sm font-semibold text-navy-800 [&::-webkit-details-marker]:hidden"><Repeat2 size={16} aria-hidden /> Sesuaikan kas karena Pergeseran / Perubahan</summary>
            <CashAdjustPanel versionId={context.versionId} sources={sources} defaultSource={defaultSource} />
          </details>
        </Card>
      )}

      <div className="no-print grid gap-4 sm:grid-cols-3">
        {[["Total pagu", formatRupiah(totalPagu)], ["Total anggaran kas", formatRupiah(grand)], ["Belum dialokasikan", formatRupiah(totalPagu - grand)]].map(([l, v]) => (
          <Card key={l} className="p-5"><p className="text-sm text-slate-600">{l}</p><p className="mt-1 font-display text-xl font-bold tabular-nums text-navy-900">{v}</p></Card>
        ))}
      </div>

      {error ? <Card><EmptyState title="Data tidak dapat dimuat">Muat ulang halaman atau hubungi administrator.</EmptyState></Card>
        : items.length === 0 ? <Card><EmptyState title="Belum ada butir anggaran">Butir yang ditugaskan kepada Anda akan tampil di sini setelah anggaran diinput.</EmptyState></Card>
        : (
        <>
        {!isAdmin && (
          <div className="no-print">
            <CashPlanGrid key={gridKey} versionId={context.versionId} rows={gridRows} canEdit={canEdit} canSubmit={user.permissions.has("cashplan.submit")} canFinalize={canFinalize} />
          </div>
        )}
        {isAdmin && (
        <div className="no-print space-y-4">
          {items.map((r) => {
            const b = r.budget_items!;
            const plan = plans.get(r.budget_item_id);
            const status: St = plan?.status ?? "none";
            const mine = canEdit && b.pptk_id === user.id;
            const editable = mine && (status === "none" || status === "draft" || status === "returned");
            const byMonth = (n: number) => Number(plan?.cash_budget_periods.find((p) => p.period_no === n)?.amount ?? 0);
            const sum = MONTHS.reduce((s, _, i) => s + byMonth(i + 1), 0);
            return (
              <Card key={r.budget_item_id}>
                <CardHeader
                  title={`${b.sub_activities?.code ?? ""} — ${b.sub_activities?.name ?? ""}`}
                  description={`${b.expenditure_accounts?.code ?? ""} ${b.expenditure_accounts?.name ?? ""}${b.description ? ` · ${b.description}` : ""} · PPTK: ${b.pptk?.full_name ?? "belum ditugaskan"}`}
                  actions={<><Badge tone={STATUS[status].tone}>{STATUS[status].label}{plan && plan.revision_no > 1 ? ` · rev ${plan.revision_no}` : ""}</Badge></>}
                />
                <div className="px-5 py-4">
                  <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                    <span>Pagu: <b className="tabular-nums">{formatRupiah(r.pagu)}</b></span>
                    <span>Kas: <b className="tabular-nums">{formatRupiah(sum)}</b></span>
                    <span className={Number(r.pagu) - sum === 0 ? "text-emerald-700" : "text-amber-700"}>Sisa dialokasikan: <b className="tabular-nums">{formatRupiah(Number(r.pagu) - sum)}</b></span>
                  </div>
                  {status === "returned" && plan?.change_reason && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">Dikembalikan: {plan.change_reason}</p>}

                  {editable ? (
                    <form action={saveCashPlanAction}>
                      <input type="hidden" name="versionId" value={context.versionId} /><input type="hidden" name="itemId" value={r.budget_item_id} />
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                        {MONTHS.map((m, i) => (
                          <label key={m} className="block text-xs font-medium text-slate-600">{m}
                            <Input name={`m${i + 1}`} type="number" min={0} step="0.01" inputMode="decimal" defaultValue={byMonth(i + 1) || ""} placeholder="0" className="mt-1 h-9 text-right tabular-nums" />
                          </label>
                        ))}
                      </div>
                      <div className="mt-4"><SubmitButton variant="primary" pendingText="Menyimpan...">Simpan draf</SubmitButton></div>
                    </form>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="table-base"><thead><tr>{MONTHS.map((m) => <th key={m} className="text-right">{m}</th>)}</tr></thead>
                        <tbody><tr>{MONTHS.map((m, i) => <td key={m} className="num text-[13px]">{byMonth(i + 1) ? formatRupiah(byMonth(i + 1)).replace(",00", "").replace("Rp ", "") : "—"}</td>)}</tr></tbody></table>
                    </div>
                  )}

                  {plan && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {mine && (status === "draft" || status === "returned") && (
                        <form action={cashStatusAction}>
                          <input type="hidden" name="versionId" value={context.versionId} /><input type="hidden" name="planId" value={plan.id} /><input type="hidden" name="to" value="submitted" />
                          <ConfirmSubmit variant="accent" message="Ajukan anggaran kas ini? Setelah diajukan tidak dapat diubah kecuali dikembalikan.">Ajukan</ConfirmSubmit>
                        </form>
                      )}
                      {mine && (status === "draft" || status === "returned") && (
                        <form action={deleteCashPlanAction}>
                          <input type="hidden" name="versionId" value={context.versionId} /><input type="hidden" name="planId" value={plan.id} />
                          <ConfirmSubmit variant="danger" message="Hapus draf anggaran kas butir ini? Isian bulanan akan dikosongkan.">Hapus draf</ConfirmSubmit>
                        </form>
                      )}
                      {canFinalize && status === "submitted" && (
                        <>
                          <form action={cashStatusAction}>
                            <input type="hidden" name="versionId" value={context.versionId} /><input type="hidden" name="planId" value={plan.id} /><input type="hidden" name="to" value="final" />
                            <ConfirmSubmit variant="primary" message="Finalisasi anggaran kas ini?">Finalisasi</ConfirmSubmit>
                          </form>
                          <form action={cashStatusAction} className="flex gap-2">
                            <input type="hidden" name="versionId" value={context.versionId} /><input type="hidden" name="planId" value={plan.id} /><input type="hidden" name="to" value="returned" />
                            <Input name="reason" required maxLength={300} placeholder="Alasan pengembalian" aria-label="Alasan pengembalian" className="h-10 w-64" />
                            <SubmitButton variant="outline">Kembalikan</SubmitButton>
                          </form>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            );
          })}

          <Card>
            <CardHeader title="Total per bulan" />
            <div className="overflow-x-auto">
              <table className="table-base"><thead><tr>{MONTHS.map((m) => <th key={m} className="text-right">{m}</th>)}<th className="text-right">Total</th></tr></thead>
                <tbody><tr>{totals.map((t, i) => <td key={i} className="num text-[13px]">{t ? formatRupiah(t).replace(",00", "").replace("Rp ", "") : "—"}</td>)}<td className="num font-bold text-navy-900">{formatRupiah(grand)}</td></tr></tbody></table>
            </div>
          </Card>
        </div>
        )}

        {/* Tampilan cetak: rekap seluruh butir dalam satu tabel */}
        <div className="print-only">
          <table className="table-base">
            <thead><tr><th>Sub kegiatan / rekening</th><th className="text-right">Pagu</th>{MONTHS.map((m) => <th key={m} className="text-right">{m}</th>)}<th className="text-right">Total kas</th></tr></thead>
            <tbody>
              {items.map((r) => {
                const b = r.budget_items!;
                const plan = plans.get(r.budget_item_id);
                const by = (n: number) => Number(plan?.cash_budget_periods.find((p) => p.period_no === n)?.amount ?? 0);
                const sum = MONTHS.reduce((a, _, i) => a + by(i + 1), 0);
                return (
                  <tr key={r.budget_item_id}>
                    <td>{b.sub_activities?.code} {b.sub_activities?.name}<br />{b.expenditure_accounts?.code} {b.expenditure_accounts?.name}{b.pptk?.full_name ? ` · PPTK: ${b.pptk.full_name}` : ""}</td>
                    <td className="num">{formatRupiah(r.pagu).replace(",00", "").replace("Rp ", "")}</td>
                    {MONTHS.map((_, i) => <td key={i} className="num">{by(i + 1) ? formatRupiah(by(i + 1)).replace(",00", "").replace("Rp ", "") : "—"}</td>)}
                    <td className="num font-semibold">{formatRupiah(sum).replace(",00", "").replace("Rp ", "")}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr className="font-bold"><td>TOTAL</td><td className="num">{formatRupiah(totalPagu).replace(",00", "").replace("Rp ", "")}</td>{totals.map((t, i) => <td key={i} className="num">{t ? formatRupiah(t).replace(",00", "").replace("Rp ", "") : "—"}</td>)}<td className="num">{formatRupiah(grand).replace(",00", "").replace("Rp ", "")}</td></tr></tfoot>
          </table>
        </div>
        </>
      )}
      <SignatureBlock />
      <PrintFooter />
    </div>
  );
}
