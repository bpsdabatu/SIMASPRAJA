"use client";

import { useState } from "react";
import { Search } from "lucide-react";

/** Penyaring instan: menyembunyikan baris `tr[data-s]` pada tabel `#tableId` yang teksnya tidak memuat kata kunci. Tanpa muat ulang halaman. */
export function LiveFilter({ tableId, placeholder = "Saring cepat…" }: { tableId: string; placeholder?: string }) {
  const [shown, setShown] = useState<number | null>(null);
  const apply = (q: string) => {
    const rows = document.querySelectorAll<HTMLElement>(`#${tableId} tbody tr[data-s]`);
    const needle = q.trim().toLowerCase();
    let n = 0;
    rows.forEach((r) => { const hit = !needle || (r.dataset.s ?? "").includes(needle); r.style.display = hit ? "" : "none"; if (hit) n++; });
    setShown(needle ? n : null);
  };
  return (
    <label className="no-print relative">
      <span className="sr-only">Saring baris tabel</span>
      <Search size={14} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
      <input onChange={(e) => apply(e.target.value)} placeholder={placeholder} className="h-9 w-48 rounded-lg border border-slate-300 bg-white pl-8 pr-2 text-sm focus:border-navy-600 focus:outline-none focus:ring-2 focus:ring-navy-200" />
      {shown !== null && <span className="ml-2 text-xs text-slate-500">{shown} baris</span>}
    </label>
  );
}
