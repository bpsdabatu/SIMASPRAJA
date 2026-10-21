"use client";

import { useEffect, useRef, useState } from "react";
import { formatInteger, formatPercent, formatRupiah } from "@/lib/format";

const fmt = { rupiah: formatRupiah, percent: formatPercent, int: formatInteger } as const;

/** Angka menghitung naik saat tampil. Teks akhir selalu persis hasil format resmi (tidak ada pembulatan tersisa); reduced-motion langsung tampil akhir. */
export function CountUp({ to, kind, fallback, ms = 900 }: { to: number; kind: keyof typeof fmt; fallback: string; ms?: number }) {
  const [v, setV] = useState<number | null>(null);
  const raf = useRef(0);
  useEffect(() => {
    if (!Number.isFinite(to) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setV(to); return; }
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setV(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf.current = requestAnimationFrame(tick); else setV(to);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [to, ms]);
  return <span aria-label={fallback}>{v === null ? fallback : fmt[kind](v)}</span>;
}
