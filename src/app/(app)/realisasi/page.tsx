import type { Metadata } from "next";
import Link from "next/link";
import { FileUp, Plus, Search } from "lucide-react";
import { requireModule } from "@/lib/auth/guard";
import { userClient } from "@/lib/supabase/server";
import { loadSuppliersMethods } from "@/lib/lookups";
import { STAGE_LABEL } from "@/lib/auth/context";
import { formatRupiah } from "@/lib/format";
import { loadBalanceRows } from "@/lib/realization-search";
import { cascadeOptions, filterBalance } from "@/lib/realization-search-core";
import { TX_STATUS } from "@/lib/status";
import { Badge, Card, CardHeader } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { EmptyState, Flash, PageHeader, TableWrap } from "@/components/ui/page";
import { availableOf } from "@/lib/tx-rules";
import { TransactionForm, type Recent, type TxItem } from "./transaction-form";

export const metadata: Metadata = { title: "Input Realisasi" };
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface Sp2dRef { sp2d_date: string | null; voided_at: string | null }
interface Tx {
  id: string; transaction_date: string; description: string; status: string; budget_item_id: string;
  suppliers: { name: string } | null; payment_records: { amount: string | number; sp2d_records: Sp2dRef | Sp2dRef[] | null }[];
}
const sp2dDateOf = (t: Tx): string | null => {
  for (const p of t.payment_records) {
    const s = Array.isArray(p.sp2d_records) ? p.sp2d_records.find((x) => !x.voided_at) : p.sp2d_records && !p.sp2d_records.voided_at ? p.sp2d_records : null;
    if (s?.sp2d_date) return s.sp2d_date;
  }
  return null;
};
const fmtD = (d: string) => new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
interface RecentRaw { budget_item_id: string; transaction_date: string; payment_records: { amount: string | number }[] }

type SP = { ok?: string; err?: string; butir?: string; tgl?: string; prog?: string; keg?: string; sub?: string; bel?: string; dana?: string; pptk?: string; cari?: string; dari?: string; sampai?: string };

export default async function RealisasiPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { user, context } = await requireModule("realization.view");
  const sp = await searchParams;
  const canCreate = user.permissions.has("realization.edit");
  const supabase = await userClient();

  const dari = DATE_RE.test(sp.dari ?? "") ? sp.dari! : "";
  const sampai = DATE_RE.test(sp.sampai ?? "") ? sp.sampai! : "";

  let txQuery = supabase.from("realization_transactions")
    .select("id, transaction_date, description, status, budget_item_id, suppliers(name), payment_records(amount, sp2d_records(sp2d_date, voided_at))")
    .eq("budget_version_id", context.versionId).order("transaction_date", { ascending: false }).order("created_at", { ascending: false }).limit(1000);
  if (dari) txQuery = txQuery.gte("transaction_date", dari);
  if (sampai) txQuery = txQuery.lte("transaction_date", sampai);

  const [{ data: txRaw, error }, balance, opts, recentRes] = await Promise.all([
    txQuery,
    loadBalanceRows(supabase, context.versionId),
    canCreate ? loadSuppliersMethods(supabase) : Promise.resolve(null),
    // Untuk peringatan input ganda: seluruh transaksi aktif (tidak terpengaruh filter tampilan)
    canCreate
      ? supabase.from("realization_transactions").select("budget_item_id, transaction_date, payment_records(amount)")
          .eq("budget_version_id", context.versionId).neq("status", "cancelled").order("transaction_date", { ascending: false }).limit(3000)
      : Promise.resolve({ data: null }),
  ]);

  // Filter butir (Program, Kegiatan, Sub Kegiatan, Belanja, PPTK, Sumber Dana) — pilihan berjenjang mengikuti pilihan di atasnya
  const f = { prog: sp.prog ?? "", keg: sp.keg ?? "", sub: sp.sub ?? "", bel: sp.bel ?? "", dana: sp.dana ?? "", pptk: sp.pptk ?? "" };
  const cari = (sp.cari ?? "").trim().toLowerCase().slice(0, 60);
  const opt = cascadeOptions(balance.rows, f);
  const matched = new Map(filterBalance(balance.rows, f).map((r) => [r.itemId, r]));
  const rowOf = new Map(balance.rows.map((r) => [r.itemId, r]));

  const sum = (t: Tx) => t.payment_records.reduce((s, p) => s + Number(p.amount), 0);
  const txs = ((txRaw ?? []) as unknown as Tx[]).filter((t) => {
    if (!matched.has(t.budget_item_id)) return false;
    if (!cari) return true;
    const r = rowOf.get(t.budget_item_id);
    return [t.description, t.suppliers?.name ?? "", r?.subName ?? "", r?.subCode ?? "", r?.accountName ?? "", r?.accountCode ?? ""].some((x) => x.toLowerCase().includes(cari));
  });
  const total = txs.filter((t) => t.status !== "cancelled").reduce((a, t) => a + sum(t), 0);
  const hasFilter = Object.values(f).some(Boolean) || !!cari || !!dari || !!sampai;

  // Butir milik PPTK yang sedang login (untuk form input)
  const txItems: TxItem[] = balance.rows.filter((r) => r.pptkId === user.id).map((r) => ({
    id: r.itemId, subCode: r.subCode, subName: r.subName, accountCode: r.accountCode, accountName: r.accountName, funding: r.funding,
    description: r.description, pagu: r.pagu, realisasi: r.realisasi, pending: r.pending, available: availableOf(r.pagu, r.realisasi, r.pending),
  }));
  const recent: Recent[] = ((recentRes.data ?? []) as unknown as RecentRaw[])
    .map((t) => ({ itemId: t.budget_item_id, date: t.transaction_date, amount: t.payment_records.reduce((a, p) => a + Number(p.amount), 0) }));

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader
        eyebrow={`TA ${context.year} · ${STAGE_LABEL[context.stage]}`}
        title="Input Realisasi"
        actions={(user.permissions.has("realization.edit") || user.permissions.has("realization.correct")) ? (
          <div className="flex flex-wrap gap-2">
            <Link href="/realisasi/impor" className={buttonVariants({ variant: "accent" })}><FileUp size={15} aria-hidden /> Impor dari berkas</Link>
            {user.permissions.has("realization.edit") && <Link href="/realisasi/penyedia" className={buttonVariants({ variant: "outline" })}>Kelola penyedia</Link>}
          </div>
        ) : undefined}
        description="Realisasi langsung tercatat saat disimpan (isi tanggal transaksi dan tanggal SP2D, tanpa verifikasi). Pencarian pagu, realisasi, dan sisa anggaran per butir ada di menu Rekapitulasi."
      />
      <Flash ok={sp.ok} err={sp.err} />

      <Card>
        <CardHeader
          title={`Transaksi realisasi (${txs.length})`}
          description={txs.length > 0 ? `Total nilai: ${formatRupiah(total)}` : undefined}
        />
        <form action="/realisasi" className="grid gap-x-3 gap-y-2 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Program" htmlFor="f-prog"><Select id="f-prog" name="prog" defaultValue={f.prog}><option value="">Semua program</option>{opt.prog.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></Field>
          <Field label="Kegiatan" htmlFor="f-keg"><Select id="f-keg" name="keg" defaultValue={f.keg}><option value="">Semua kegiatan</option>{opt.keg.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></Field>
          <Field label="Sub kegiatan" htmlFor="f-sub"><Select id="f-sub" name="sub" defaultValue={f.sub}><option value="">Semua sub kegiatan</option>{opt.sub.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></Field>
          <Field label="Belanja (rekening)" htmlFor="f-bel"><Select id="f-bel" name="bel" defaultValue={f.bel}><option value="">Semua rekening belanja</option>{opt.bel.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></Field>
          <Field label="PPTK" htmlFor="f-pptk"><Select id="f-pptk" name="pptk" defaultValue={f.pptk}><option value="">Semua PPTK</option>{opt.pptk.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}<option value="none">Belum ditugaskan</option></Select></Field>
          <Field label="Sumber dana" htmlFor="f-dana"><Select id="f-dana" name="dana" defaultValue={f.dana}><option value="">Semua sumber dana</option>{opt.dana.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></Field>
          <Field label="Tgl transaksi dari" htmlFor="f-dari"><Input id="f-dari" name="dari" type="date" defaultValue={dari} /></Field>
          <Field label="Tgl transaksi s.d." htmlFor="f-sampai"><Input id="f-sampai" name="sampai" type="date" defaultValue={sampai} /></Field>
          <Field label="Kata kunci" htmlFor="f-cari" className="sm:col-span-2 lg:col-span-2"><Input id="f-cari" name="cari" defaultValue={sp.cari ?? ""} placeholder="uraian, penyedia, kode / nama sub kegiatan atau rekening" maxLength={60} /></Field>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-2">
            <button className={buttonVariants({ variant: "primary" })}><Search size={16} aria-hidden /> Terapkan</button>
            {hasFilter && <Link href="/realisasi" className={buttonVariants({ variant: "outline" })}>Atur ulang</Link>}
          </div>
        </form>
        {error ? <EmptyState title="Data tidak dapat dimuat">Muat ulang halaman atau hubungi administrator.</EmptyState>
          : txs.length === 0 ? <EmptyState title={hasFilter ? "Tidak ada transaksi yang cocok" : "Belum ada transaksi"}>{hasFilter ? "Ubah atau atur ulang filter." : canCreate ? "Input realisasi pertama pada formulir di bawah." : undefined}</EmptyState>
          : (
          <TableWrap>
            <div className="max-h-[26rem] overflow-y-auto">
              <table className="table-base">
                <thead className="sticky top-0 z-10 bg-slate-50"><tr><th>Tgl transaksi</th><th>Tgl SP2D</th><th>Sub kegiatan · Rekening</th><th>Uraian</th><th>Penyedia</th><th className="text-right">Nilai</th><th>Status</th></tr></thead>
                <tbody>
                  {txs.map((t) => {
                    const r = rowOf.get(t.budget_item_id);
                    const st = TX_STATUS[t.status] ?? { label: t.status, tone: "slate" as const };
                    return (
                      <tr key={t.id}>
                        <td className="whitespace-nowrap">{fmtD(t.transaction_date)}</td>
                        <td className="whitespace-nowrap">{sp2dDateOf(t) ? fmtD(sp2dDateOf(t)!) : "—"}</td>
                        <td className="text-xs text-slate-600"><span className="font-mono">{r?.subCode}</span> · {r?.accountCode}<span className="block text-slate-500">{r?.accountName}</span></td>
                        <td><Link href={`/realisasi/${t.id}`} className="font-medium text-navy-700 hover:underline">{t.description}</Link></td>
                        <td>{t.suppliers?.name ?? "—"}</td>
                        <td className="num font-medium">{formatRupiah(sum(t))}</td>
                        <td>{t.status === "realisasi" ? <Badge tone="green">Tercatat</Badge> : <Badge tone={st.tone}>{st.label}</Badge>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </TableWrap>
        )}
      </Card>

      {!canCreate && (
        <p className="rounded-lg border border-sky-200 bg-sky-50 px-3.5 py-2.5 text-sm text-sky-900">Realisasi diinput oleh <b>PPTK</b> dari butir anggaran yang ditugaskan kepadanya. Admin menugaskan PPTK pada menu <Link href="/anggaran" className="font-semibold underline">Input Anggaran</Link> (Ubah → PPTK).</p>
      )}

      {canCreate && opts && (
        <Card id="form">
          <details open>
            <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-sm font-semibold text-navy-800 [&::-webkit-details-marker]:hidden"><Plus size={16} aria-hidden /> Input realisasi baru</summary>
            {txItems.length === 0 ? (
              <p className="border-t border-slate-100 px-5 py-4 text-sm text-slate-600">Belum ada butir anggaran yang ditugaskan kepada Anda pada konteks ini.</p>
            ) : (
              <TransactionForm key={sp.ok ?? "form"} versionId={context.versionId} year={context.year} items={txItems} recent={recent} suppliers={opts.suppliers} methods={opts.methods} preselect={sp.butir ?? ""} defaultDate={sp.tgl ?? ""} canManageMaster={user.permissions.has("master.manage")} />
            )}
          </details>
        </Card>
      )}
    </div>
  );
}
