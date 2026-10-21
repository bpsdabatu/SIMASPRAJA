import type { ReactNode } from "react";
import { formatPercent, formatRupiah } from "@/lib/format";
import type { RankRow } from "@/lib/ranking-core";
import type { SupplierRank } from "@/lib/supplier-ranking-core";
import { compactRp } from "@/components/dashboard-charts";
import { CountUp } from "@/components/count-up";

/** Palet per kategori. Seluruh kelas ditulis utuh agar terdeteksi Tailwind (tidak boleh disusun dinamis). */
export type ThemeKey = "sky" | "emerald" | "amber" | "violet" | "rose" | "teal" | "indigo" | "fuchsia" | "orange" | "cyan";
export interface Theme { band: string; tile: string; chip: string; bar: string; text: string; soft: string; border: string; badge: string }

export const THEME: Record<ThemeKey, Theme> = {
  sky:     { band: "from-sky-500 to-blue-600",      tile: "from-sky-500 to-blue-600",       chip: "bg-sky-100 text-sky-700",         bar: "bg-gradient-to-r from-sky-400 to-blue-600",      text: "text-sky-700",     soft: "bg-sky-50",     border: "border-sky-200",     badge: "bg-sky-600 text-white" },
  emerald: { band: "from-emerald-500 to-teal-600",  tile: "from-emerald-500 to-teal-600",   chip: "bg-emerald-100 text-emerald-700", bar: "bg-gradient-to-r from-emerald-400 to-teal-600",  text: "text-emerald-700", soft: "bg-emerald-50", border: "border-emerald-200", badge: "bg-emerald-600 text-white" },
  amber:   { band: "from-amber-400 to-orange-500",  tile: "from-amber-400 to-orange-500",   chip: "bg-amber-100 text-amber-800",     bar: "bg-gradient-to-r from-amber-300 to-orange-500",  text: "text-amber-700",   soft: "bg-amber-50",   border: "border-amber-200",   badge: "bg-amber-500 text-white" },
  violet:  { band: "from-violet-500 to-purple-600", tile: "from-violet-500 to-purple-600",  chip: "bg-violet-100 text-violet-700",   bar: "bg-gradient-to-r from-violet-400 to-purple-600", text: "text-violet-700",  soft: "bg-violet-50",  border: "border-violet-200",  badge: "bg-violet-600 text-white" },
  rose:    { band: "from-rose-500 to-pink-600",     tile: "from-rose-500 to-pink-600",      chip: "bg-rose-100 text-rose-700",       bar: "bg-gradient-to-r from-rose-400 to-pink-600",     text: "text-rose-700",    soft: "bg-rose-50",    border: "border-rose-200",    badge: "bg-rose-600 text-white" },
  teal:    { band: "from-teal-500 to-cyan-600",     tile: "from-teal-500 to-cyan-600",      chip: "bg-teal-100 text-teal-700",       bar: "bg-gradient-to-r from-teal-400 to-cyan-600",     text: "text-teal-700",    soft: "bg-teal-50",    border: "border-teal-200",    badge: "bg-teal-600 text-white" },
  indigo:  { band: "from-indigo-500 to-blue-700",   tile: "from-indigo-500 to-blue-700",    chip: "bg-indigo-100 text-indigo-700",   bar: "bg-gradient-to-r from-indigo-400 to-blue-700",   text: "text-indigo-700",  soft: "bg-indigo-50",  border: "border-indigo-200",  badge: "bg-indigo-600 text-white" },
  fuchsia: { band: "from-fuchsia-500 to-pink-600",  tile: "from-fuchsia-500 to-pink-600",   chip: "bg-fuchsia-100 text-fuchsia-700", bar: "bg-gradient-to-r from-fuchsia-400 to-pink-600",  text: "text-fuchsia-700", soft: "bg-fuchsia-50", border: "border-fuchsia-200", badge: "bg-fuchsia-600 text-white" },
  orange:  { band: "from-orange-500 to-red-500",    tile: "from-orange-500 to-red-500",     chip: "bg-orange-100 text-orange-700",   bar: "bg-gradient-to-r from-orange-400 to-red-500",    text: "text-orange-700",  soft: "bg-orange-50",  border: "border-orange-200",  badge: "bg-orange-500 text-white" },
  cyan:    { band: "from-cyan-500 to-sky-600",      tile: "from-cyan-500 to-sky-600",       chip: "bg-cyan-100 text-cyan-700",       bar: "bg-gradient-to-r from-cyan-400 to-sky-600",      text: "text-cyan-700",    soft: "bg-cyan-50",    border: "border-cyan-200",    badge: "bg-cyan-600 text-white" },
};

/** Ubin KPI berwarna (gradien) — satu warna berbeda untuk tiap indikator. */
export function KpiTile({ icon: Icon, label, value, hint, theme, count }: {
  icon: React.ComponentType<{ size?: number; "aria-hidden"?: boolean }>; label: string; value: string; hint?: string; theme: ThemeKey;
  /** Bila diisi, angka dihitung naik (count-up) saat tampil; `value` tetap menjadi teks cadangan/aksesibilitas. */
  count?: { n: number; kind: "rupiah" | "percent" | "int" };
}) {
  const t = THEME[theme];
  return (
    <div className={`card-lift pop-in relative overflow-hidden rounded-2xl bg-gradient-to-br ${t.tile} p-5 text-white shadow-lift`}>
      <span aria-hidden className="float-slow pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/15" />
      <span aria-hidden className="pointer-events-none absolute -bottom-8 right-6 h-20 w-20 rounded-full bg-white/10" />
      <div className="relative flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-white/90">{label}</p>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/20"><Icon size={18} aria-hidden /></span>
      </div>
      <p className="relative mt-3 break-words font-display text-2xl font-bold tabular-nums">{count ? <CountUp to={count.n} kind={count.kind} fallback={value} /> : value}</p>
      {hint && <p className="relative mt-1 text-xs text-white/80">{hint}</p>}
    </div>
  );
}

/** Ubin kecil berwarna lembut (indikator sekunder). */
export function MiniStat({ icon: Icon, label, value, theme }: {
  icon: React.ComponentType<{ size?: number; "aria-hidden"?: boolean }>; label: string; value: string; theme: ThemeKey;
}) {
  const t = THEME[theme];
  return (
    <div className={`card-lift pop-in flex items-center gap-3 rounded-xl border ${t.border} ${t.soft} px-4 py-3`}>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${t.chip}`}><Icon size={18} aria-hidden /></span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-600">{label}</p>
        <p className={`truncate font-display text-lg font-bold tabular-nums ${t.text}`}>{value}</p>
      </div>
    </div>
  );
}

/** Kartu berpita warna (judul kategori) untuk peringkat. */
export function BandCard({ theme, icon: Icon, title, subtitle, children }: {
  theme: ThemeKey; icon: React.ComponentType<{ size?: number; "aria-hidden"?: boolean }>; title: string; subtitle?: string; children: ReactNode;
}) {
  const t = THEME[theme];
  return (
    <section className={`card-lift pop-in overflow-hidden rounded-2xl border ${t.border} bg-white shadow-card`}>
      <header className={`flex items-center gap-3 bg-gradient-to-r ${t.band} px-5 py-3.5 text-white`}>
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/20"><Icon size={18} aria-hidden /></span>
        <div className="min-w-0">
          <h2 className="font-display text-base font-bold leading-tight">{title}</h2>
          {subtitle && <p className="text-xs text-white/85">{subtitle}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

function RankItem({ r, n, theme }: { r: RankRow; n: number; theme: ThemeKey }) {
  const t = THEME[theme];
  const pct = Math.max(0, Math.min(100, r.pctPagu));
  return (
    <li className="grid grid-cols-[1.75rem_1fr_auto] items-start gap-x-3">
      <span className={`mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${n <= 3 ? t.badge : t.chip}`}>{n}</span>
      <div className="min-w-0">
        <p className="break-words text-sm font-medium leading-snug text-slate-900">{r.code && <span className="mr-1 text-xs text-slate-500">{r.code}</span>}{r.name}</p>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100" role="presentation"><div className={`bar-grow h-full rounded-full ${t.bar}`} style={{ width: `${pct}%` }} /></div>
        <p className="mt-1 text-xs text-slate-500">
          Realisasi periode <b className="text-slate-700">{formatRupiah(r.realPeriod)}</b> · kumulatif {compactRp(r.realCum)} dari pagu {compactRp(r.pagu)}
          {r.pctKas !== null ? ` · ${formatPercent(r.pctKas)} dari target kas` : ""}
        </p>
      </div>
      <p className={`text-right font-display text-lg font-bold tabular-nums ${t.text}`}>{formatPercent(r.pctPagu)}</p>
    </li>
  );
}

/** Peringkat realisasi & capaian (%): 5 teratas, sisanya dapat dibuka. Urutan sudah ditentukan pemanggil. */
export function RankBody({ rows, theme, top = 5 }: { rows: RankRow[]; theme: ThemeKey; top?: number }) {
  if (rows.length === 0) return <p className="p-5 text-sm text-slate-600">Belum ada data pagu untuk diperingkatkan.</p>;
  return (
    <div className="p-5">
      <ol className="space-y-3.5">{rows.slice(0, top).map((r, i) => <RankItem key={r.key} r={r} n={i + 1} theme={theme} />)}</ol>
      {rows.length > top && (
        <details className="mt-4 border-t border-slate-100 pt-3">
          <summary className={`cursor-pointer text-sm font-semibold ${THEME[theme].text}`}>Lihat semua ({rows.length})</summary>
          <ol className="mt-3 max-h-80 space-y-3.5 overflow-y-auto pr-1">{rows.slice(top).map((r, i) => <RankItem key={r.key} r={r} n={top + i + 1} theme={theme} />)}</ol>
        </details>
      )}
    </div>
  );
}

const MEDAL = ["from-amber-300 to-yellow-500 text-amber-950", "from-slate-300 to-slate-400 text-slate-900", "from-orange-300 to-amber-600 text-orange-950"];
const BARS: ThemeKey[] = ["violet", "fuchsia", "indigo", "rose", "teal", "orange", "sky", "emerald", "amber", "cyan"];

/** Peringkat penyedia menurut nominal transaksi, tertinggi → terendah; warna batang berganti per baris. */
export function SupplierList({ rows }: { rows: SupplierRank[] }) {
  if (rows.length === 0) return <p className="p-5 text-sm text-slate-600">Belum ada transaksi realisasi pada periode ini.</p>;
  const max = rows[0]!.total || 1;
  const total = rows.reduce((a, r) => a + r.total, 0);
  return (
    <div className="p-5">
      <p className="mb-3 text-xs text-slate-500">{rows.length} penyedia · total transaksi <b className="text-slate-700">{formatRupiah(total)}</b></p>
      <ol className="max-h-[30rem] space-y-3 overflow-y-auto pr-1">
        {rows.map((r, i) => {
          const th = THEME[BARS[i % BARS.length]!];
          return (
            <li key={r.key} className="grid grid-cols-[2rem_1fr_auto] items-start gap-x-3">
              {i < 3
                ? <span className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br text-sm font-extrabold shadow ${MEDAL[i]}`}>{i + 1}</span>
                : <span className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${th.chip}`}>{i + 1}</span>}
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold leading-snug text-slate-900">{r.name}</p>
                <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-slate-100" role="presentation"><div className={`bar-grow h-full rounded-full ${th.bar}`} style={{ width: `${Math.max(2, (r.total / max) * 100)}%`, animationDelay: `${Math.min(i, 12) * 0.05}s` }} /></div>
                <p className="mt-1 text-xs text-slate-500">{r.count} transaksi · terbesar {compactRp(r.largest)} · {formatPercent(r.share)} dari total</p>
              </div>
              <p className={`text-right font-display text-base font-bold tabular-nums ${th.text}`}>{formatRupiah(r.total)}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
