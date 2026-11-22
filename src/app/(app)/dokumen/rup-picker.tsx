"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { formatRupiah } from "@/lib/format";
import { mapJenisPengadaan, mapMetodePemilihan } from "@/lib/rup-import-core";
import { cn } from "@/lib/utils";

interface Rup {
  id: string; rup_code: string; package_name: string | null; pagu: number | string | null; jenis_pengadaan: string | null;
  metode_pemilihan: string | null; sumber_dana: string | null; lokasi: string | null; satuan_kerja: string | null; waktu_pekerjaan: string | null;
}

/** Mengisi kolom formulir (tak terkendali) berdasarkan id; hanya bila elemen ada. */
function setField(id: string, value: string) {
  const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
  if (!el) return;
  if (el instanceof HTMLSelectElement) { if ([...el.options].some((o) => o.value === value)) el.value = value; return; }
  el.value = value;
}

/**
 * Cari RUP (data unggahan SiRUP) berdasarkan Kode RUP atau nama paket.
 *  - mode "create": mengisi Judul dan mengirim rupId (server mengisi awal isi DPP dari RUP).
 *  - mode "fill": mengisi Kode RUP, nama paket, jenis/metode, sumber dana, lokasi pada formulir DPP yang sedang disunting.
 * Pagu RUP dikirim ke editor rincian lewat peristiwa "rup-picked" untuk pembandingan HPS.
 */
export function RupPicker({ mode, className }: { mode: "create" | "fill"; className?: string }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Rup[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [picked, setPicked] = useState<Rup | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); setErr(""); return; }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await fetch(`/dokumen/rup?q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal, cache: "no-store" });
        const j = (await r.json()) as { results?: Rup[]; error?: string };
        setResults(j.results ?? []); setErr(r.ok ? "" : j.error ?? "Pencarian gagal"); setOpen(true);
      } catch (e) { if ((e as Error).name !== "AbortError") setErr("Pencarian gagal. Periksa koneksi."); }
      finally { setBusy(false); }
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const pick = (r: Rup) => {
    setPicked(r); setOpen(false); setQ("");
    const pagu = r.pagu !== null ? Number(r.pagu) : null;
    window.dispatchEvent(new CustomEvent("rup-picked", { detail: { pagu } }));
    if (mode === "create") { setField("title", r.package_name ?? ""); return; }
    setField("f_kode_rup", r.rup_code);
    setField("f_perihal", r.package_name ?? "");
    setField("f_jenis_pengadaan", mapJenisPengadaan(r.jenis_pengadaan ?? ""));
    setField("f_metode_pemilihan", mapMetodePemilihan(r.metode_pemilihan ?? ""));
    if (r.sumber_dana) setField("f_sumber_dana", r.sumber_dana);
    if (r.lokasi) setField("f_lokasi", r.lokasi);
  };
  const clear = () => { setPicked(null); window.dispatchEvent(new CustomEvent("rup-picked", { detail: { pagu: null } })); };

  return (
    <div ref={box} className={cn("space-y-2", className)}>
      {mode === "create" && <input type="hidden" name="rupId" value={picked?.id ?? ""} />}
      <label htmlFor={`rup-q-${mode}`} className="text-sm font-medium text-slate-700">{mode === "create" ? "Cari paket dari RUP (SiRUP)" : "Isi dari RUP (SiRUP)"} <span className="font-normal text-slate-500">— ketik Kode RUP atau nama paket</span></label>
      <div className="relative">
        <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input id={`rup-q-${mode}`} value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => results.length && setOpen(true)} autoComplete="off" placeholder="mis. 62049211 atau belanja alat tulis kantor" className="pl-9" />
        {open && (
          <ul role="listbox" className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lift">
            {busy && <li className="px-3 py-2 text-xs text-slate-500">Mencari…</li>}
            {err && <li className="px-3 py-2 text-xs text-red-700">{err}</li>}
            {!busy && !err && results.length === 0 && <li className="px-3 py-2 text-xs text-slate-500">Tidak ada RUP yang cocok. Unggah data RUP dari SiRUP terlebih dahulu, atau isi manual.</li>}
            {results.map((r) => (
              <li key={r.id} role="option" aria-selected="false">
                <button type="button" onClick={() => pick(r)} className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-navy-50">
                  <span className="text-sm font-medium text-slate-900">{r.package_name ?? "(tanpa nama)"}</span>
                  <span className="text-xs text-slate-500">Kode RUP {r.rup_code}{r.pagu !== null ? ` · Pagu ${formatRupiah(r.pagu)}` : ""}{r.metode_pemilihan ? ` · ${r.metode_pemilihan}` : ""}{r.jenis_pengadaan ? ` · ${r.jenis_pengadaan}` : ""}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {picked && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          <span>RUP terpilih: <strong>{picked.rup_code}</strong> — {picked.package_name}{picked.pagu !== null ? ` (pagu ${formatRupiah(picked.pagu)})` : ""}. {mode === "fill" ? "Isian di bawah telah diisi; periksa dan sesuaikan." : "Isian DPP akan terisi awal dari RUP."}</span>
          <button type="button" onClick={clear} className="ml-auto inline-flex items-center gap-1 rounded border border-emerald-300 bg-white px-2 py-0.5 font-medium hover:bg-emerald-100"><X size={12} aria-hidden /> Lepas</button>
        </p>
      )}
    </div>
  );
}
