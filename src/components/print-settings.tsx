"use client";

import { useEffect, useState } from "react";
import { Printer, SlidersHorizontal } from "lucide-react";
import { Field, Select } from "@/components/ui/input";
import {
  DEFAULT_PRINT, MARGINS, ORIENTATIONS, PAPERS, PRINT_COOKIE, PRINT_STYLE_ID, pageCss, parsePrintSettings, serializePrintSettings,
  type MarginKey, type Orientation, type PaperKey, type PrintSettings,
} from "@/lib/print-settings";
import { cn } from "@/lib/utils";

function readCookie(): PrintSettings {
  const m = document.cookie.split("; ").find((c) => c.startsWith(`${PRINT_COOKIE}=`));
  return parsePrintSettings(m ? decodeURIComponent(m.slice(PRINT_COOKIE.length + 1)) : null);
}

/** Simpan ke cookie (dibaca server untuk PDF/Excel) dan terapkan langsung ke @page cetak browser. */
export function applyPrintSettings(s: PrintSettings) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${PRINT_COOKIE}=${encodeURIComponent(serializePrintSettings(s))}; path=/; max-age=31536000; SameSite=Lax${secure}`;
  let el = document.getElementById(PRINT_STYLE_ID);
  if (!el) { el = document.createElement("style"); el.id = PRINT_STYLE_ID; document.head.appendChild(el); }
  el.textContent = pageCss(s);
}

export function usePrintSettings() {
  const [s, setS] = useState<PrintSettings>(DEFAULT_PRINT);
  useEffect(() => { setS(readCookie()); }, []);
  const update = (patch: Partial<PrintSettings>) => { const n = { ...s, ...patch }; setS(n); applyPrintSettings(n); };
  return [s, update] as const;
}

/** Menu pengaturan cetak (kertas, orientasi, margin). Berlaku untuk cetak, PDF, dan Excel di seluruh aplikasi. */
export function PrintSettingsMenu({ className, label = "Pengaturan cetak", iconOnly = false }: { className?: string; label?: string; iconOnly?: boolean }) {
  const [s, update] = usePrintSettings();
  return (
    <details className={cn("no-print group relative", className)}>
      <summary
        className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:border-navy-300 hover:text-navy-700 [&::-webkit-details-marker]:hidden"
        title="Atur jenis kertas dan orientasi cetak" aria-label={label}
      >
        <SlidersHorizontal size={16} aria-hidden />
        {!iconOnly && <span className="hidden sm:inline">{label}</span>}
      </summary>
      <div className="absolute right-0 z-40 mt-2 w-72 space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-lift">
        <p className="text-sm font-semibold text-navy-800">Pengaturan Cetak</p>
        <Field label="Jenis kertas" htmlFor="ps-paper">
          <Select id="ps-paper" value={s.paper} onChange={(e) => update({ paper: e.target.value as PaperKey })}>
            {Object.entries(PAPERS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
          </Select>
        </Field>
        <Field label="Orientasi (layout)" htmlFor="ps-orient">
          <Select id="ps-orient" value={s.orientation} onChange={(e) => update({ orientation: e.target.value as Orientation })}>
            {Object.entries(ORIENTATIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Margin" htmlFor="ps-margin">
          <Select id="ps-margin" value={s.margin} onChange={(e) => update({ margin: e.target.value as MarginKey })}>
            {Object.entries(MARGINS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          </Select>
        </Field>
        <p className="text-xs leading-relaxed text-slate-500">
          Tersimpan otomatis di perangkat ini dan berlaku untuk cetak halaman, unduhan PDF, serta pengaturan halaman berkas Excel.
          Tabel lebar (mis. laporan triwulan) lebih rapi pada orientasi lanskap.
        </p>
      </div>
    </details>
  );
}

export function PrintIcon() { return <Printer size={16} aria-hidden />; }
