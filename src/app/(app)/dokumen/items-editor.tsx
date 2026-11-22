"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { Input, Select } from "@/components/ui/input";
import { classifyRefUrl, computeTotals, DEFAULT_PPN, lineTotal, parsePpn, REF_KINDS, UNIT_SUGGESTIONS, type DocItem, type Limit, type RefKind } from "@/lib/document-items";
import { formatRupiah } from "@/lib/format";

interface Row { nama: string; spesifikasi: string; volume: string; satuan: string; harga: string; refKind: RefKind; refUrl: string; refTanggal: string; refHarga: string; refCatatan: string }
const blank = (): Row => ({ nama: "", spesifikasi: "", volume: "1", satuan: "", harga: "", refKind: "katalog", refUrl: "", refTanggal: "", refHarga: "", refCatatan: "" });
const fromItem = (i: DocItem): Row => ({ nama: i.nama, spesifikasi: i.spesifikasi, volume: String(i.volume), satuan: i.satuan, harga: String(i.harga), refKind: i.refKind, refUrl: i.refUrl, refTanggal: i.refTanggal, refHarga: i.refHarga === null ? "" : String(i.refHarga), refCatatan: i.refCatatan });
const n = (v: string) => { const x = Number(String(v).replace(",", ".")); return Number.isFinite(x) ? x : 0; };

/**
 * Editor rincian kebutuhan barang/jasa + referensi harga. Hanya mengirim dua kolom formulir: items_json dan f_ppn_persen.
 * Jumlah/total di sini hanya tampilan; server menghitung ulang dan memvalidasi.
 */
export function ItemsEditor({ defaultItems, defaultPpn, limits, rupPagu: rupPaguInit, legacyHps }: { defaultItems: DocItem[]; defaultPpn: string; limits: Limit[]; rupPagu: number | null; legacyHps?: string }) {
  const [rows, setRows] = useState<Row[]>(defaultItems.length ? defaultItems.map(fromItem) : [blank()]);
  const [ppn, setPpn] = useState(defaultPpn || String(DEFAULT_PPN));
  const [rupPagu, setRupPagu] = useState<number | null>(rupPaguInit);
  // Pemilih RUP (SiRUP) mengirim pagu RUP terpilih lewat peristiwa jendela.
  useEffect(() => {
    const h = (e: Event) => { const v = Number((e as CustomEvent<{ pagu?: number | null }>).detail?.pagu); setRupPagu(Number.isFinite(v) && v > 0 ? v : null); };
    window.addEventListener("rup-picked", h);
    return () => window.removeEventListener("rup-picked", h);
  }, []);
  const set = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const items = useMemo(() => rows.map((r) => ({ jumlah: lineTotal(n(r.volume), n(r.harga)) })), [rows]);
  const totals = computeTotals(items, parsePpn(ppn));
  const json = JSON.stringify(rows);
  const all: Limit[] = [...limits, ...(rupPagu ? [{ label: "Pagu RUP (SiRUP)", value: rupPagu }] : [])];
  const exceeded = all.filter((l) => totals.total > l.value);

  return (
    <div className="space-y-4 sm:col-span-2">
      <input type="hidden" name="items_json" value={json} />
      <input type="hidden" name="f_ppn_persen" value={ppn} />
      <input type="hidden" name="rup_pagu" value={rupPagu ?? ""} />
      {legacyHps && <input type="hidden" name="hps_lama" value={legacyHps} />}
      <datalist id="unit-list">{UNIT_SUGGESTIONS.map((u) => <option key={u} value={u} />)}</datalist>

      <div>
        <h3 className="text-sm font-semibold text-navy-800">Rincian kebutuhan barang/jasa dan referensi harga</h3>
        <p className="text-xs text-slate-500">Isi nama, spesifikasi, volume, satuan, dan harga satuan. Lengkapi referensi harga dari tautan Katalog Elektronik InaProc atau toko daring sebagai dasar HPS. Jumlah dihitung otomatis.</p>
        {legacyHps && <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">HPS yang diisi sebelumnya: {legacyHps}. Akan dipertahankan sampai rincian di bawah diisi.</p>}
      </div>

      {rows.map((r, i) => {
        const kind = classifyRefUrl(r.refUrl);
        const mismatch = r.refUrl && kind && ((r.refKind === "katalog" && kind !== "katalog") || (r.refKind === "toko" && kind !== "toko"));
        const unknownCatalog = r.refUrl && r.refKind === "katalog" && !kind;
        const diff = n(r.refHarga) > 0 && n(r.harga) > 0 ? ((n(r.harga) - n(r.refHarga)) / n(r.refHarga)) * 100 : null;
        return (
          <fieldset key={i} className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
            <legend className="px-1 text-xs font-semibold text-slate-600">Barang/Jasa #{i + 1}</legend>
            <div className="grid gap-3 sm:grid-cols-6">
              <label className="text-xs font-medium text-slate-700 sm:col-span-3">Nama barang/jasa *<Input value={r.nama} onChange={(e) => set(i, { nama: e.target.value })} maxLength={200} aria-label={`Nama barang/jasa ${i + 1}`} /></label>
              <label className="text-xs font-medium text-slate-700 sm:col-span-3">Spesifikasi<Input value={r.spesifikasi} onChange={(e) => set(i, { spesifikasi: e.target.value })} maxLength={1000} placeholder="merek, tipe, ukuran, standar" /></label>
              <label className="text-xs font-medium text-slate-700">Volume *<Input type="number" inputMode="decimal" min="0" step="any" value={r.volume} onChange={(e) => set(i, { volume: e.target.value })} /></label>
              <label className="text-xs font-medium text-slate-700">Satuan *<Input list="unit-list" value={r.satuan} onChange={(e) => set(i, { satuan: e.target.value })} maxLength={30} /></label>
              <label className="text-xs font-medium text-slate-700 sm:col-span-2">Harga satuan (Rp) *<Input type="number" inputMode="decimal" min="0" step="any" value={r.harga} onChange={(e) => set(i, { harga: e.target.value })} /></label>
              <div className="text-xs font-medium text-slate-700 sm:col-span-2">Jumlah (otomatis)<div className="mt-1.5 flex h-10 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold tabular-nums text-slate-900">{formatRupiah(items[i]!.jumlah)}</div></div>

              <div className="grid gap-3 border-t border-slate-200 pt-3 sm:col-span-6 sm:grid-cols-6">
                <p className="text-xs font-semibold text-navy-800 sm:col-span-6">Referensi harga</p>
                <label className="text-xs font-medium text-slate-700 sm:col-span-2">Sumber
                  <Select value={r.refKind} onChange={(e) => set(i, { refKind: e.target.value as RefKind })}>{Object.entries(REF_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></label>
                <label className="text-xs font-medium text-slate-700 sm:col-span-4">Tautan produk (Katalog InaProc / toko daring)
                  <Input type="url" value={r.refUrl} onChange={(e) => set(i, { refUrl: e.target.value })} maxLength={500} placeholder="https://katalog.inaproc.id/..." /></label>
                <label className="text-xs font-medium text-slate-700 sm:col-span-2">Tanggal akses<Input type="date" value={r.refTanggal} onChange={(e) => set(i, { refTanggal: e.target.value })} /></label>
                <label className="text-xs font-medium text-slate-700 sm:col-span-2">Harga referensi per satuan (Rp)<Input type="number" inputMode="decimal" min="0" step="any" value={r.refHarga} onChange={(e) => set(i, { refHarga: e.target.value })} /></label>
                <label className="text-xs font-medium text-slate-700 sm:col-span-2">Catatan (penyedia/toko, merek)<Input value={r.refCatatan} onChange={(e) => set(i, { refCatatan: e.target.value })} maxLength={300} /></label>
                <div className="flex flex-wrap items-center gap-2 text-xs sm:col-span-6">
                  {r.refUrl && <a href={r.refUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-navy-700 underline"><ExternalLink size={12} aria-hidden /> Buka tautan</a>}
                  {kind && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-800">Terdeteksi: {kind === "katalog" ? "Katalog InaProc" : "Toko daring"}</span>}
                  {mismatch && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">Alamat tautan tidak sesuai dengan sumber yang dipilih</span>}
                  {unknownCatalog && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">Alamat bukan inaproc.id / lkpp.go.id; pastikan ini tautan katalog resmi</span>}
                  {diff !== null && <span className={`rounded-full px-2 py-0.5 ${Math.abs(diff) > 10 ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-700"}`}>Harga satuan {diff >= 0 ? "+" : ""}{diff.toFixed(1)}% dari referensi</span>}
                  {n(r.refHarga) > 0 && <button type="button" onClick={() => set(i, { harga: r.refHarga })} className="rounded border border-navy-300 bg-white px-2 py-0.5 font-medium text-navy-800 hover:bg-navy-50">Pakai harga referensi sebagai harga satuan</button>}
                  <button type="button" onClick={() => setRows((x) => (x.length > 1 ? x.filter((_, k) => k !== i) : [blank()]))} className="ml-auto inline-flex items-center gap-1 rounded border border-red-200 bg-white px-2 py-0.5 font-medium text-red-700 hover:bg-red-50"><Trash2 size={12} aria-hidden /> Hapus baris</button>
                </div>
              </div>
            </div>
          </fieldset>
        );
      })}

      <button type="button" onClick={() => setRows((x) => [...x, blank()])} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-navy-300 bg-white px-3 text-sm font-semibold text-navy-800 hover:bg-navy-50" disabled={rows.length >= 200}><Plus size={14} aria-hidden /> Tambah barang/jasa</button>

      <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm sm:max-w-md sm:ml-auto">
        <div className="flex justify-between"><span className="text-slate-600">Subtotal</span><span className="tabular-nums">{formatRupiah(totals.subtotal)}</span></div>
        <div className="flex items-center justify-between gap-3"><label className="flex items-center gap-2 text-slate-600">PPN (%) <Input className="h-8 w-20" type="number" inputMode="decimal" min="0" max="100" step="any" value={ppn} onChange={(e) => setPpn(e.target.value)} /></label><span className="tabular-nums">{formatRupiah(totals.ppn)}</span></div>
        <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold"><span>Total HPS (termasuk PPN)</span><span className="tabular-nums">{formatRupiah(totals.total)}</span></div>
        {all.map((l) => <div key={l.label} className={`flex justify-between text-xs ${totals.total > l.value ? "text-red-700" : "text-slate-500"}`}><span>{l.label}</span><span className="tabular-nums">{formatRupiah(l.value)}</span></div>)}
        {exceeded.map((l) => <p key={l.label} className="rounded bg-red-50 px-2 py-1 text-xs text-red-800">Total HPS melebihi {l.label.toLowerCase()} sebesar {formatRupiah(totals.total - l.value)}. HPS tidak boleh melebihi anggaran yang tersedia.</p>)}
      </div>
    </div>
  );
}
