import type React from "react";
import { cn } from "@/lib/utils";

/** Grafik ringan berbasis SVG (dirender di server; tanpa pustaka tambahan, tanpa JavaScript klien). */

const compact = new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 });
export const compactRp = (n: number) => `Rp ${compact.format(n)}`;

/** Cincin capaian (persentase 0–100). */
export function ProgressRing({ value, size = 132, track = "rgba(255,255,255,.14)", from = "#f4e8c4", to = "#cfa54a", label }: {
  value: number | null; size?: number; track?: string; from?: string; to?: string; label?: string;
}) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const r = 52, c = 2 * Math.PI * r;
  const id = `ring-${size}-${from.slice(1)}`;
  return (
    <svg viewBox="0 0 132 132" width={size} height={size} role="img" aria-label={label ?? `Capaian ${v.toFixed(1)} persen`}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor={from} /><stop offset="100%" stopColor={to} /></linearGradient></defs>
      <circle cx="66" cy="66" r={r} fill="none" stroke={track} strokeWidth="12" />
      <circle cx="66" cy="66" r={r} fill="none" stroke={`url(#${id})`} strokeWidth="12" strokeLinecap="round" className="ring-draw"
        style={{ "--len": (v / 100) * c, "--c": c } as React.CSSProperties}
        strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 66 66)" />
      <text x="66" y="70" textAnchor="middle" fontSize="22" fontWeight="700" fill="currentColor">{value === null ? "-" : `${v.toFixed(1).replace(".", ",")}%`}</text>
    </svg>
  );
}

export interface Part { label: string; value: number; color: string; hex: string }

/** Donat komposisi; bagian bernilai 0 dilewati. */
export function Donut({ parts, center, size = 168 }: { parts: Part[]; center: { top: string; bottom: string }; size?: number }) {
  const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0);
  const r = 62, c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg viewBox="0 0 168 168" width={size} height={size} role="img" aria-label={`Komposisi: ${parts.map((p) => `${p.label} ${total ? ((p.value / total) * 100).toFixed(1) : 0}%`).join(", ")}`}>
      <circle cx="84" cy="84" r={r} fill="none" stroke="#e2e8f0" strokeWidth="22" />
      {total > 0 && parts.filter((p) => p.value > 0).map((p) => {
        const len = (p.value / total) * c;
        const el = <circle key={p.label} cx="84" cy="84" r={r} fill="none" stroke={p.hex} strokeWidth="22" className="ring-draw" style={{ "--len": Math.max(0, len - 1.5), "--c": c, animationDelay: `${parts.indexOf(p) * 0.12}s` } as React.CSSProperties} strokeDasharray={`${Math.max(0, len - 1.5)} ${c}`} strokeDashoffset={-acc} transform="rotate(-90 84 84)" />;
        acc += len;
        return el;
      })}
      <text x="84" y="80" textAnchor="middle" fontSize="11" fill="#64748b">{center.top}</text>
      <text x="84" y="100" textAnchor="middle" fontSize="17" fontWeight="700" fill="#0a2140">{center.bottom}</text>
    </svg>
  );
}

export function Legend({ parts }: { parts: Part[] }) {
  const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0);
  return (
    <ul className="space-y-2 text-sm">
      {parts.map((p) => (
        <li key={p.label} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-slate-700"><span className={cn("h-3 w-3 rounded-sm", p.color)} aria-hidden />{p.label}</span>
          <span className="tabular-nums text-slate-900"><b>{compactRp(p.value)}</b> <span className="text-xs text-slate-500">({total > 0 ? ((Math.max(0, p.value) / total) * 100).toFixed(1).replace(".", ",") : "0,0"}%)</span></span>
        </li>
      ))}
    </ul>
  );
}

export interface QBar { label: string; kas: number; real: number }

/** Batang berpasangan per triwulan: target kas vs realisasi. */
export function QuarterBars({ data }: { data: QBar[] }) {
  const W = 560, H = 250, L = 52, R = 12, T = 16, B = 34;
  const max = Math.max(1, ...data.flatMap((d) => [d.kas, d.real]));
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const gw = (W - L - R) / data.length;
  const bw = Math.min(34, gw / 3);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Target kas dan realisasi per triwulan: ${data.map((d) => `${d.label} kas ${compactRp(d.kas)}, realisasi ${compactRp(d.real)}`).join("; ")}`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(max * t)} y2={y(max * t)} stroke="#e2e8f0" strokeDasharray={t === 0 ? undefined : "3 4"} />
          <text x={L - 8} y={y(max * t) + 4} textAnchor="end" fontSize="10" fill="#64748b">{compact.format(max * t)}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const cx = L + gw * i + gw / 2;
        return (
          <g key={d.label}>
            <rect x={cx - bw - 3} y={y(d.kas)} width={bw} height={Math.max(0, H - B - y(d.kas))} rx="4" fill="#6366f1" className="svg-bar" style={{ animationDelay: `${i * 0.1}s` }}><title>{`${d.label} — target kas ${compactRp(d.kas)}`}</title></rect>
            <rect x={cx + 3} y={y(d.real)} width={bw} height={Math.max(0, H - B - y(d.real))} rx="4" fill="#10b981" className="svg-bar" style={{ animationDelay: `${i * 0.1 + 0.08}s` }}><title>{`${d.label} — realisasi ${compactRp(d.real)}`}</title></rect>
            <text x={cx - bw / 2 - 3} y={y(d.kas) - 5} textAnchor="middle" fontSize="9.5" fill="#4338ca">{d.kas > 0 ? compact.format(d.kas) : ""}</text>
            <text x={cx + bw / 2 + 3} y={y(d.real) - 5} textAnchor="middle" fontSize="9.5" fill="#047857">{d.real > 0 ? compact.format(d.real) : ""}</text>
            <text x={cx} y={H - 12} textAnchor="middle" fontSize="11" fontWeight="600" fill="#334155">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

