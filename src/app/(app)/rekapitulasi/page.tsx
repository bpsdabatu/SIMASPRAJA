import type { Metadata } from "next";
import Link from "next/link";
import { Download, Search } from "lucide-react";
import { requireModule } from "@/lib/auth/guard";
import { userClient } from "@/lib/supabase/server";
import { getOrganizationName } from "@/lib/lookups";
import { loadBalanceRows } from "@/lib/realization-search";
import { cascadeOptions, filterBalance, totalsOf, type BalanceRow } from "@/lib/realization-search-core";
import { STAGE_LABEL } from "@/lib/auth/context";
import { formatPercent, formatRupiah } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { EmptyState, Flash, PageHeader, TableWrap } from "@/components/ui/page";
import { PrintButton } from "@/components/ui/submit-button";
import { PrintFooter, PrintHeader, SignatureBlock } from "@/components/ui/report";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Rekapitulasi" };
export const dynamic = "force-dynamic";

type SP = { ok?: string; err?: string; prog?: string; keg?: string; sub?: string; bel?: string; dana?: string; pptk?: string; cari?: string };

export default async function RekapPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { user, context } = await requireModule("recap.view");
  const sp = await searchParams;
  const supabase = await userClient();
  const [balance, org] = await Promise.all([loadBalanceRows(supabase, context.versionId), getOrganizationName(supabase, user.organizationId)]);

  const f = { prog: sp.prog ?? "", keg: sp.keg ?? "", sub: sp.sub ?? "", bel: sp.bel ?? "", dana: sp.dana ?? "", pptk: sp.pptk ?? "", cari: sp.cari ?? "" };
  const rows = filterBalance(balance.rows, f);
  const opt = cascadeOptions(balance.rows, f);
  const t = totalsOf(rows);
  const hasFilter = Object.values(f).some((v) => v.trim() !== "");
  const showPending = t.pending > 0; // kolom data lama (sebelum SP2D tanpa verifikasi); disembunyikan bila kosong
  const groups = new Map<string, BalanceRow[]>();
  for (const r of rows) { const k = `${r.subCode}|${r.subName}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); }
  const sub = `Tahun Anggaran ${context.year} — ${STAGE_LABEL[context.stage]}`;
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PrintHeader orgName={org} title="Rekapitulasi Realisasi dan Sisa Anggaran" subtitle={sub} />
      <PageHeader
        eyebrow={sub}
        title="Rekapitulasi"
        description="Pagu, realisasi (SP2D bertanggal), komitmen kontrak, dan sisa anggaran per butir. Gunakan filter untuk menelusuri menurut program hingga PPTK."
        actions={<>
          {user.permissions.has("recap.export") && <>
            <a href={`/rekapitulasi/export?format=xlsx&${qs}`} className={buttonVariants({ variant: "outline" })}><Download size={16} aria-hidden /> Excel</a>
            <a href={`/rekapitulasi/export?format=csv&${qs}`} className={buttonVariants({ variant: "outline" })}><Download size={16} aria-hidden /> CSV</a>
          </>}
          <PrintButton />
        </>}
      />
      <Flash ok={sp.ok} err={sp.err} />

      <div className="no-print grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[["Pagu", formatRupiah(t.pagu)], ["Realisasi", formatRupiah(t.realisasi)], ["Sisa", formatRupiah(t.sisa)], ["Persentase", formatPercent(t.pct)]].map(([l, v]) => (
          <Card key={l} className="p-5"><p className="text-sm text-slate-600">{l}</p><p className="mt-1 font-display text-xl font-bold tabular-nums text-navy-900">{v}</p></Card>
        ))}
      </div>

      <Card>
        <CardHeader title={`Realisasi & Sisa Anggaran (${rows.length} butir)`} description="Realisasi = SP2D bertanggal. Komitmen kontrak ditampilkan terpisah dan tidak dihitung sebagai realisasi." className="no-print" />
        <form action="/rekapitulasi" className="no-print grid gap-x-3 gap-y-2 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Program" htmlFor="r-prog"><Select id="r-prog" name="prog" defaultValue={f.prog}><option value="">Semua program</option>{opt.prog.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></Field>
          <Field label="Kegiatan" htmlFor="r-keg"><Select id="r-keg" name="keg" defaultValue={f.keg}><option value="">Semua kegiatan</option>{opt.keg.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></Field>
          <Field label="Sub kegiatan" htmlFor="r-sub"><Select id="r-sub" name="sub" defaultValue={f.sub}><option value="">Semua sub kegiatan</option>{opt.sub.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></Field>
          <Field label="Belanja (rekening)" htmlFor="r-bel"><Select id="r-bel" name="bel" defaultValue={f.bel}><option value="">Semua rekening belanja</option>{opt.bel.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></Field>
          <Field label="PPTK" htmlFor="r-pptk"><Select id="r-pptk" name="pptk" defaultValue={f.pptk}><option value="">Semua PPTK</option>{opt.pptk.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}<option value="none">Belum ditugaskan</option></Select></Field>
          <Field label="Sumber dana" htmlFor="r-dana"><Select id="r-dana" name="dana" defaultValue={f.dana}><option value="">Semua sumber dana</option>{opt.dana.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></Field>
          <Field label="Kata kunci" htmlFor="r-cari" className="sm:col-span-2"><Input id="r-cari" name="cari" defaultValue={f.cari} placeholder="uraian, kode, nama" maxLength={60} /></Field>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
            <button className={buttonVariants({ variant: "primary" })}><Search size={16} aria-hidden /> Cari</button>
            {hasFilter && <Link href="/rekapitulasi" className={buttonVariants({ variant: "outline" })}>Atur ulang</Link>}
          </div>
        </form>
        {balance.error ? <EmptyState title="Data tidak dapat dimuat">Muat ulang halaman atau hubungi administrator.</EmptyState>
          : rows.length === 0 ? <EmptyState title="Tidak ada data">Belum ada butir anggaran pada konteks ini atau tidak cocok dengan filter.</EmptyState>
          : (
          <TableWrap>
            <table className="table-base">
              <thead><tr><th>Sub kegiatan / rekening</th><th>Sumber dana</th><th>PPTK</th><th className="text-right">Pagu</th><th className="text-right">Realisasi</th>{showPending && <th className="text-right">Menunggu SP2D</th>}<th className="text-right">Komitmen</th><th className="text-right">Sisa anggaran</th><th className="text-right">%</th></tr></thead>
              <tbody>
                {[...groups.entries()].map(([key, list]) => {
                  const [code, name] = key.split("|");
                  const g = totalsOf(list);
                  return [
                    <tr key={key} className="bg-navy-50/70">
                      <td colSpan={3} className="font-semibold text-navy-900"><span className="font-mono text-[13px]">{code}</span> {name}</td>
                      <td className="num font-semibold">{formatRupiah(g.pagu)}</td><td className="num font-semibold">{formatRupiah(g.realisasi)}</td>
                      {showPending && <td className="num font-semibold">{formatRupiah(g.pending)}</td>}
                      <td className="num font-semibold">{formatRupiah(g.komitmen)}</td>
                      <td className="num font-semibold">{formatRupiah(g.sisa)}</td><td className="num font-semibold">{formatPercent(g.pct)}</td>
                    </tr>,
                    ...list.map((r) => (
                      <tr key={r.itemId}>
                        <td className="pl-6"><span className="font-mono text-[13px] text-slate-500">{r.accountCode}</span> {r.accountName}{r.description && <span className="block text-xs text-slate-500">{r.description}</span>}</td>
                        <td>{r.funding || "—"}</td><td>{r.pptk || "—"}</td>
                        <td className="num">{formatRupiah(r.pagu)}</td><td className="num">{formatRupiah(r.realisasi)}</td>
                        {showPending && <td className="num">{r.pending ? formatRupiah(r.pending) : "—"}</td>}
                        <td className="num">{formatRupiah(r.komitmen)}</td>
                        <td className={cn("num font-semibold", r.sisa < 0 && "text-red-700")}>{formatRupiah(r.sisa)}</td><td className="num">{formatPercent(r.pct)}</td>
                      </tr>
                    )),
                  ];
                })}
              </tbody>
              <tfoot><tr className="bg-slate-50 font-bold">
                <td colSpan={3} className="px-3 py-3 text-right">TOTAL ({rows.length} butir)</td>
                <td className="num px-3 py-3">{formatRupiah(t.pagu)}</td><td className="num px-3 py-3">{formatRupiah(t.realisasi)}</td>
                {showPending && <td className="num px-3 py-3">{formatRupiah(t.pending)}</td>}
                <td className="num px-3 py-3">{formatRupiah(t.komitmen)}</td>
                <td className="num px-3 py-3">{formatRupiah(t.sisa)}</td><td className="num px-3 py-3">{formatPercent(t.pct)}</td>
              </tr></tfoot>
            </table>
          </TableWrap>
        )}
      </Card>
      <SignatureBlock />
      <PrintFooter />
    </div>
  );
}
