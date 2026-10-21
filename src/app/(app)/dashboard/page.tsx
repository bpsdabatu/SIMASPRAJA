import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle, ArrowRight, Banknote, Boxes, FileSearch, Hourglass, Layers, ListChecks, Percent, PiggyBank, Trophy, TrendingUp, UserCheck,
} from "lucide-react";
import { requireContext } from "@/lib/auth/session";
import { userClient } from "@/lib/supabase/server";
import { formatDateTimeWIB, formatInteger, formatPercent, formatRupiah } from "@/lib/format";
import { STAGE_LABEL } from "@/lib/auth/context";
import { NAV_ITEMS, canSeeNav } from "@/lib/nav";
import { Alert, Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page";
import { loadQItems } from "@/lib/quarterly";
import { loadSupplierTx } from "@/lib/supplier-ranking";
import { rankSuppliers } from "@/lib/supplier-ranking-core";
import { quarterRange } from "@/lib/quarterly-core";
import {
  DIM_LABEL, MONTH_NAMES, defaultPeriod, parsePeriod, periodLabel, periodSpan, periodValue, rankEntities, type Dim, type Period, type SortBy,
} from "@/lib/ranking-core";
import { Donut, Legend, ProgressRing, QuarterBars, type Part } from "@/components/dashboard-charts";
import { BandCard, KpiTile, MiniStat, RankBody, SupplierList, THEME, type ThemeKey } from "@/components/dashboard-widgets";

export const metadata: Metadata = { title: "Dasbor" };
export const dynamic = "force-dynamic";

interface Kpis {
  total_pagu: string; total_realisasi: string; sisa_anggaran: string; pct_realisasi: string | null;
  jumlah_butir_aktif: number; jumlah_menunggu_sp2d: number; jumlah_dokumen_reviu: number;
  total_menunggu_sp2d: string; total_komitmen: string; dihitung_pada: string;
}

type SP = { akses?: string; per?: string; dari?: string; sampai?: string; urut?: string; pv?: string; vdari?: string; vsampai?: string };

const DIMS: { dim: Dim; theme: ThemeKey; icon: typeof UserCheck }[] = [
  { dim: "pptk", theme: "sky", icon: UserCheck },
  { dim: "kegiatan", theme: "emerald", icon: Layers },
  { dim: "sub", theme: "amber", icon: Boxes },
];
const SHORTCUT_THEMES: ThemeKey[] = ["sky", "emerald", "amber", "violet", "rose", "teal", "indigo", "fuchsia", "orange"];
const ROMAN = ["I", "II", "III", "IV"];

function PeriodOptions() {
  return (
    <>
      <option value="y">Seluruh tahun (s.d. kini)</option>
      <optgroup label="Triwulanan">{[1, 2, 3, 4].map((n) => <option key={n} value={`q${n}`}>Triwulan {ROMAN[n - 1]}</option>)}</optgroup>
      <optgroup label="Bulanan">{MONTH_NAMES.map((m, i) => <option key={m} value={`m${i + 1}`}>{m}</option>)}</optgroup>
      <option value="r">Rentang tanggal (transaksi s.d. SP2D)</option>
    </>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { user, context } = await requireContext();
  const sp = await searchParams;
  const supabase = await userClient();
  const year = context.year;

  // Periode peringkat PPTK/Kegiatan/Sub Kegiatan, dan periode peringkat penyedia (terpisah).
  const period: Period = parsePeriod(sp.per, defaultPeriod(year, new Date()), { from: sp.dari, to: sp.sampai });
  const sortBy: SortBy = sp.urut === "rp" ? "rp" : "pct";
  const vPeriod: Period = parsePeriod(sp.pv, { kind: "year", n: 0 }, { from: sp.vdari, to: sp.vsampai });
  const vSpan = periodSpan(year, vPeriod);

  const [kpiRes, q, sup] = await Promise.all([
    supabase.rpc("dashboard_kpis", { p_version: context.versionId }),
    loadQItems(supabase, context, user.organizationId, `${year}-12-31`),
    loadSupplierTx(supabase, context.versionId),
  ]);
  const { data, error } = kpiRes;
  const k = (Array.isArray(data) ? data[0] : data) as Kpis | undefined;

  const rankings = DIMS.map((d) => ({ ...d, rows: rankEntities(q.items, year, d.dim, period, sortBy) }));
  const suppliers = rankSuppliers(sup.rows, { start: vSpan.start, end: vSpan.end, lifecycle: vPeriod.kind === "range" });

  const qbars = [1, 2, 3, 4].map((n) => {
    const { start, end } = quarterRange(year, n as 1 | 2 | 3 | 4);
    let kas = 0, real = 0;
    for (const it of q.items) {
      if (it.kasMonths) for (let m = (n - 1) * 3; m < n * 3; m++) kas += it.kasMonths[m] ?? 0;
      for (const r of it.real) if (r.date >= start && r.date <= end) real += r.amount;
    }
    return { label: `TW ${ROMAN[n - 1]}`, kas, real };
  });

  const sisa = Number(k?.sisa_anggaran ?? 0);
  const over = sisa < 0;
  const empty = !k || k.jumlah_butir_aktif === 0;
  const pct = Math.max(0, Math.min(100, Number(k?.pct_realisasi ?? 0)));
  const pending = Number(k?.total_menunggu_sp2d ?? 0);
  const real = Number(k?.total_realisasi ?? 0);
  const parts: Part[] = [
    { label: "Realisasi sah", value: real, color: "bg-emerald-500", hex: "#10b981" },
    { label: "Menunggu SP2D", value: pending, color: "bg-amber-400", hex: "#fbbf24" },
    { label: "Sisa tersedia", value: Math.max(0, sisa - pending), color: "bg-sky-400", hex: "#38bdf8" },
  ];
  const shortcuts = NAV_ITEMS.filter((i) => i.href !== "/dashboard" && canSeeNav(i, user)).slice(0, 9);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        eyebrow={`Tahun Anggaran ${year} · ${STAGE_LABEL[context.stage]}`}
        title={`Selamat datang, ${user.fullName.split(" ")[0]}`}
        description={`Ringkasan monitoring dan evaluasi anggaran. Angka mengikuti data yang boleh Anda akses (${user.roles.join(", ").toUpperCase() || "tanpa peran"}).`}
      />

      {sp.akses === "ditolak" && <Alert tone="amber">Anda tidak memiliki izin untuk membuka halaman tersebut.</Alert>}
      {error && <Alert>Ringkasan tidak dapat dimuat. Silakan muat ulang halaman atau hubungi administrator.</Alert>}
      {over && (
        <Alert><AlertTriangle size={15} className="mr-1.5 inline" aria-hidden /> Realisasi melebihi pagu pada konteks ini (sisa anggaran negatif). Periksa data realisasi.</Alert>
      )}

      {k && (
        <>
          {/* Hero: capaian + cincin */}
          <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-navy-900 via-indigo-800 to-fuchsia-700 px-6 py-7 text-white shadow-lift">
            <span aria-hidden className="pointer-events-none absolute -left-10 -top-16 h-56 w-56 rounded-full bg-sky-400/20 blur-2xl" />
            <span aria-hidden className="pointer-events-none absolute -bottom-20 right-10 h-64 w-64 rounded-full bg-amber-300/20 blur-2xl" />
            <div className="relative flex flex-wrap items-center justify-between gap-6">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-200">Capaian realisasi belanja</p>
                <p className="mt-2 font-display text-5xl font-extrabold tabular-nums">{formatPercent(k.pct_realisasi)}</p>
                <p className="mt-2 text-sm text-indigo-100">{formatRupiah(k.total_realisasi)} dari pagu {formatRupiah(k.total_pagu)}</p>
                <div className="mt-4 h-3 max-w-xl overflow-hidden rounded-full bg-white/15" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Persentase realisasi">
                  <div className="h-full rounded-full bg-gradient-to-r from-amber-300 via-lime-300 to-emerald-300" style={{ width: `${pct}%` }} />
                </div>
              </div>
              <div className="text-white"><ProgressRing value={k.pct_realisasi === null ? null : Number(k.pct_realisasi)} size={150} track="rgba(255,255,255,.18)" from="#fde68a" to="#34d399" /></div>
            </div>
          </section>

          {/* Indikator utama berwarna */}
          <section aria-label="Indikator utama" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiTile icon={Banknote} label="Total Pagu Anggaran" value={formatRupiah(k.total_pagu)} count={{ n: Number(k.total_pagu), kind: "rupiah" }} theme="sky" />
            <KpiTile icon={TrendingUp} label="Total Realisasi Belanja" value={formatRupiah(k.total_realisasi)} count={{ n: Number(k.total_realisasi), kind: "rupiah" }} hint="Transaksi ber-SP2D bertanggal" theme="emerald" />
            <KpiTile icon={PiggyBank} label="Sisa Anggaran" value={formatRupiah(k.sisa_anggaran)} count={{ n: Number(k.sisa_anggaran), kind: "rupiah" }} hint="Pagu − realisasi sah" theme={over ? "rose" : "amber"} />
            <KpiTile icon={Percent} label="Persentase Realisasi" value={formatPercent(k.pct_realisasi)} hint={k.pct_realisasi === null ? "Pagu 0: persentase tidak dihitung" : undefined} theme="violet" />
          </section>

          {/* Grafik + indikator sekunder */}
          <section className="grid gap-4 lg:grid-cols-3">
            <Card className="border-teal-200 p-5">
              <h2 className="font-display text-base font-bold text-teal-800">Komposisi anggaran</h2>
              <p className="text-xs text-slate-500">Realisasi, menunggu SP2D, dan sisa tersedia.</p>
              <div className="mt-3 flex flex-col items-center gap-4 sm:flex-row lg:flex-col xl:flex-row">
                <Donut parts={parts} center={{ top: "Realisasi", bottom: formatPercent(k.pct_realisasi) }} />
                <div className="w-full"><Legend parts={parts} /></div>
              </div>
            </Card>
            <Card className="border-indigo-200 p-5 lg:col-span-2">
              <h2 className="font-display text-base font-bold text-indigo-800">Target kas vs realisasi per triwulan</h2>
              <p className="text-xs text-slate-500"><span className="mr-3 inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-indigo-500" />Target kas</span><span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" />Realisasi (tanggal SP2D)</span></p>
              <div className="mt-2"><QuarterBars data={qbars} /></div>
            </Card>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MiniStat icon={ListChecks} label="Butir anggaran aktif" value={formatInteger(k.jumlah_butir_aktif)} theme="cyan" />
            <MiniStat icon={FileSearch} label="Dokumen menunggu reviu" value={formatInteger(k.jumlah_dokumen_reviu)} theme="rose" />
            <MiniStat icon={Hourglass} label="Menunggu SP2D" value={`${formatInteger(k.jumlah_menunggu_sp2d)} transaksi`} theme="orange" />
            <MiniStat icon={Banknote} label="Komitmen kontrak" value={formatRupiah(k.total_komitmen)} theme="fuchsia" />
          </section>

          {empty && (
            <Alert tone="teal">
              Belum ada butir anggaran pada konteks ini. Mulailah dari menu <Link href="/anggaran" className="font-semibold underline">Input Anggaran</Link>{" "}
              (setelah Data Master terisi); sampai saat itu angka di atas bernilai nol.
            </Alert>
          )}
          <p className="text-xs text-slate-500">
            Dihitung pada {formatDateTimeWIB(k.dihitung_pada)}. Definisi: realisasi sah = transaksi berstatus realisasi dengan SP2D bertanggal dan tidak dibatalkan.
            Komitmen kontrak ditampilkan terpisah dan tidak pernah dijumlahkan ke realisasi.
          </p>
        </>
      )}

      {/* Peringkat realisasi & capaian: PPTK, Kegiatan, Sub Kegiatan — bulanan / triwulanan / rentang */}
      <section aria-label="Peringkat realisasi dan capaian" className="space-y-4">
        <Card className="border-slate-200">
          <form action="/dashboard" className="flex flex-wrap items-end gap-3 p-4">
            <input type="hidden" name="pv" value={sp.pv ?? ""} /><input type="hidden" name="vdari" value={sp.vdari ?? ""} /><input type="hidden" name="vsampai" value={sp.vsampai ?? ""} />
            <div className="mr-auto min-w-[14rem]">
              <h2 className="font-display text-base font-bold text-navy-900">Peringkat realisasi anggaran &amp; capaian (%)</h2>
              <p className="text-xs text-slate-500">{periodLabel(period, year)} · capaian = realisasi kumulatif s.d. akhir periode ÷ pagu.</p>
            </div>
            <Field label="Periode" htmlFor="per"><Select id="per" name="per" defaultValue={periodValue(period)} className="w-60"><PeriodOptions /></Select></Field>
            <Field label="Transaksi dari" htmlFor="dari"><Input id="dari" name="dari" type="date" defaultValue={period.kind === "range" ? period.from : sp.dari ?? ""} className="w-40" /></Field>
            <Field label="SP2D s.d." htmlFor="sampai"><Input id="sampai" name="sampai" type="date" defaultValue={period.kind === "range" ? period.to : sp.sampai ?? ""} className="w-40" /></Field>
            <Field label="Urutkan" htmlFor="urut"><Select id="urut" name="urut" defaultValue={sortBy} className="w-44"><option value="pct">Capaian (%)</option><option value="rp">Nominal realisasi periode</option></Select></Field>
            <button className={buttonVariants({ variant: "primary" })}>Tampilkan</button>
          </form>
          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
            Bulanan/triwulanan dihitung menurut tanggal SP2D. Pilih <b>Rentang tanggal</b> untuk menghitung transaksi yang tanggal transaksinya ≥ tanggal awal dan tanggal SP2D-nya ≤ tanggal akhir.
          </p>
        </Card>
        {q.error ? <Alert>Data peringkat tidak dapat dimuat sepenuhnya. Muat ulang halaman.</Alert> : (
          <div className="grid gap-4 xl:grid-cols-3">
            {rankings.map((r, i) => (
              <BandCard key={r.dim} theme={r.theme} icon={i === 0 ? UserCheck : i === 1 ? Layers : Boxes} title={`Per ${DIM_LABEL[r.dim]}`} subtitle={`${r.rows.length} ${DIM_LABEL[r.dim]} · ${sortBy === "rp" ? "urut nominal" : "urut capaian"}`}>
                <RankBody rows={r.rows} theme={r.theme} />
              </BandCard>
            ))}
          </div>
        )}
      </section>

      {/* Peringkat penyedia */}
      <section aria-label="Peringkat penyedia">
        <BandCard theme="violet" icon={Trophy} title="Peringkat penyedia berdasarkan nominal transaksi" subtitle={`${periodLabel(vPeriod, year)} · dari transaksi tertinggi ke terendah`}>
          <form action="/dashboard" className="flex flex-wrap items-end gap-3 border-b border-violet-100 bg-violet-50/50 px-5 py-4">
            <input type="hidden" name="per" value={sp.per ?? ""} /><input type="hidden" name="dari" value={sp.dari ?? ""} /><input type="hidden" name="sampai" value={sp.sampai ?? ""} /><input type="hidden" name="urut" value={sp.urut ?? ""} />
            <Field label="Periode" htmlFor="pv"><Select id="pv" name="pv" defaultValue={periodValue(vPeriod)} className="w-60"><PeriodOptions /></Select></Field>
            <Field label="Transaksi dari" htmlFor="vdari"><Input id="vdari" name="vdari" type="date" defaultValue={vPeriod.kind === "range" ? vPeriod.from : sp.vdari ?? ""} className="w-40" /></Field>
            <Field label="SP2D s.d." htmlFor="vsampai"><Input id="vsampai" name="vsampai" type="date" defaultValue={vPeriod.kind === "range" ? vPeriod.to : sp.vsampai ?? ""} className="w-40" /></Field>
            <button className={buttonVariants({ variant: "primary" })}>Tampilkan</button>
          </form>
          {sup.error ? <p className="p-5 text-sm text-red-700">Data penyedia tidak dapat dimuat sepenuhnya. Muat ulang halaman.</p> : <SupplierList rows={suppliers} />}
        </BandCard>
      </section>

      {shortcuts.length > 0 && (
        <section aria-label="Pintasan modul">
          <h2 className="mb-3 font-display text-base font-bold text-navy-900">Pintasan modul</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shortcuts.map((s, i) => {
              const t = THEME[SHORTCUT_THEMES[i % SHORTCUT_THEMES.length]!];
              return (
                <li key={s.href}>
                  <Link href={s.href} className={`group flex items-center justify-between gap-3 rounded-xl border ${t.border} ${t.soft} px-4 py-3.5 transition-shadow hover:shadow-lift`}>
                    <span className="min-w-0">
                      <span className={`block text-sm font-semibold ${t.text}`}>{s.label}</span>
                      <span className="block truncate text-xs text-slate-500">{s.hint}</span>
                    </span>
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${t.chip}`}><ArrowRight size={15} aria-hidden className="transition-transform group-hover:translate-x-0.5" /></span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
