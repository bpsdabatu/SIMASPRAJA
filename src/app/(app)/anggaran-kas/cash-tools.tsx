"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { CheckCircle2, FileSpreadsheet, Loader2, Repeat2, ScanSearch, Upload } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import type { AdjustStatus, CashAdjustState, CashImportState, CashRowStatus } from "@/lib/cash-import-core";
import { formatAmount } from "@/lib/format";
import { adjustCashAction, importCashAction } from "./actions";

const IMP: Record<CashRowStatus, { label: string; cls: string }> = {
  simpan: { label: "Disimpan", cls: "bg-emerald-100 text-emerald-800" },
  sama: { label: "Sama", cls: "bg-slate-100 text-slate-600" },
  kosong: { label: "Kosong", cls: "bg-slate-100 text-slate-600" },
  dikunci: { label: "Dikunci", cls: "bg-sky-100 text-sky-800" },
  galat: { label: "Galat", cls: "bg-red-100 text-red-700" },
};
const ADJ: Record<AdjustStatus, { label: string; cls: string }> = {
  salin: { label: "Disalin", cls: "bg-emerald-100 text-emerald-800" },
  kurangi: { label: "Dikecilkan", cls: "bg-amber-100 text-amber-800" },
  tambah: { label: "Ditambah", cls: "bg-teal-100 text-teal-800" },
  baru: { label: "Butir baru", cls: "bg-violet-100 text-violet-800" },
  realisasi: { label: "Dari realisasi", cls: "bg-indigo-100 text-indigo-800" },
  melebihi: { label: "Melebihi pagu", cls: "bg-red-100 text-red-700" },
  terisi: { label: "Dilindungi", cls: "bg-slate-100 text-slate-600" },
  dikunci: { label: "Dikunci", cls: "bg-sky-100 text-sky-800" },
  tanpa_sumber: { label: "Tanpa sumber", cls: "bg-slate-100 text-slate-600" },
};

const Btn = ({ onClick, pending, busy, disabled, children, tone, type = "button", title }: {
  onClick?: () => void; pending: boolean; busy: boolean; disabled?: boolean; children: React.ReactNode; tone: "outline" | "accent"; type?: "button" | "submit"; title?: string;
}) => (
  <button type={type} onClick={onClick} disabled={pending || disabled} title={title}
    className={`inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${tone === "accent" ? "bg-gold-500 text-navy-950 shadow-sm hover:bg-gold-400" : "border border-navy-300 bg-white text-navy-800 hover:bg-navy-50"}`}>
    {pending && busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : null}{children}
  </button>
);

function Chips<K extends string>({ counts, map }: { counts: Record<K, number>; map: Record<K, { label: string; cls: string }> }) {
  return <>{(Object.keys(map) as K[]).filter((k) => counts[k] > 0).map((k) => <span key={k} className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${map[k].cls}`}>{map[k].label}: {counts[k]}</span>)}</>;
}

/** Impor kas: periksa dulu (pratinjau per baris) -> terapkan. Disimpan sebagai draf; server memvalidasi ulang seluruh berkas. */
export function CashImportPanel({ versionId, admin = false }: { versionId: string; admin?: boolean }) {
  const [state, dispatch, pending] = useActionState<CashImportState, FormData>(importCashAction, { phase: "idle" });
  const ref = useRef<HTMLFormElement>(null);
  const [intent, setIntent] = useState<"preview" | "apply">("preview");
  const run = (which: "preview" | "apply") => {
    if (!ref.current) return;
    const fd = new FormData(ref.current); fd.set("intent", which); setIntent(which);
    startTransition(() => dispatch(fd));
  };
  const n = state.counts?.simpan ?? 0;
  const canApply = state.phase === "preview" && n > 0;
  return (
    <div className="space-y-4 border-t border-slate-100 p-5">
      <p className="text-sm text-slate-600">
        Anggaran kas disusun <b>per triwulan</b> (kolom <code className="rounded bg-slate-100 px-1">tw1</code>–<code className="rounded bg-slate-100 px-1">tw4</code>; bila berkas berisi bulan, dijumlahkan per triwulan). Butir dikenali dari <code className="rounded bg-slate-100 px-1">id_butir</code> (templat)
        atau <code className="rounded bg-slate-100 px-1">kode_sub_kegiatan + kode_rekening</code> (+ sumber_dana/uraian/pptk bila ada butir kembar; kolom kode_program/kode_kegiatan dan pagu bila ada ikut diperiksa).
        {admin
          ? <> Sebagai <b>ADMIN</b>, setiap baris otomatis <b>didistribusikan ke PPTK penanggung jawab</b> butir tersebut (Program/Kegiatan/Sub Kegiatan/Belanja sesuai Input Anggaran); butir tanpa PPTK ditolak. </>
          : <> Hanya butir penugasan Anda. </>}
        Total tidak boleh melebihi pagu. Hasil berupa <b>draf</b>{admin ? " yang kemudian diperiksa dan diajukan PPTK" : ""}. Berkas PDF harus berteks (bukan hasil pindai) dan dibaca sebagai tabel kode rekening + angka; <b>periksa pratinjau dengan teliti</b>.
      </p>
      <div className="flex flex-wrap gap-2">
        <a href="/anggaran-kas/template?format=xlsx" className={buttonVariants({ variant: "outline", size: "sm" })}><FileSpreadsheet size={14} aria-hidden /> Templat triwulan (Excel)</a>
        <a href="/anggaran-kas/template?format=csv" className={buttonVariants({ variant: "outline", size: "sm" })}><FileSpreadsheet size={14} aria-hidden /> Templat triwulan (CSV)</a>
      </div>
      <form ref={ref} onSubmit={(e) => { e.preventDefault(); run("preview"); }} encType="multipart/form-data" className="space-y-3">
        <input type="hidden" name="versionId" value={versionId} />
        <Field label="Berkas Excel (.xlsx), CSV, atau PDF" htmlFor="kas-file"><Input id="kas-file" name="file" type="file" accept=".xlsx,.csv,.txt,.pdf" required className="h-auto py-2" /></Field>
        <div className="flex flex-wrap gap-2">
          <Btn type="submit" tone="outline" pending={pending} busy={intent === "preview"}><ScanSearch size={15} aria-hidden /> Periksa dulu</Btn>
          <Btn tone="accent" pending={pending} busy={intent === "apply"} disabled={!canApply} onClick={() => run("apply")} title={canApply ? undefined : "Jalankan “Periksa dulu” terlebih dahulu"}><Upload size={15} aria-hidden /> Simpan sebagai draf{canApply ? ` (${n})` : ""}</Btn>
        </div>
      </form>
      {state.note && <Alert tone="amber">{state.note}</Alert>}
      {state.phase === "error" && state.error && <Alert>{state.error}</Alert>}
      {state.phase === "done" && state.applied && (
        <Alert tone={state.applied.gagal.length ? "amber" : "green"}>
          <p className="flex items-center gap-2 font-semibold"><CheckCircle2 size={16} aria-hidden /> {state.applied.saved} anggaran kas tersimpan sebagai draf. Periksa lalu ajukan.</p>
          {state.applied.gagal.length > 0 && <p className="mt-1">{state.applied.gagal.length} gagal: {state.applied.gagal.slice(0, 4).join("; ")}</p>}
        </Alert>
      )}
      {state.counts && state.rows && state.rows.length > 0 && (
        <div className="animate-fade-up space-y-2">
          <div className="flex flex-wrap gap-2"><Chips counts={state.counts} map={IMP} /></div>
          <div className="max-h-96 overflow-auto rounded-lg border border-slate-200">
            <table className="table-base">
              <thead className="sticky top-0 z-10"><tr><th>Baris</th><th>Status</th><th>Butir</th><th className="text-right">Total kas</th><th className="text-right">Pagu</th><th>Keterangan</th></tr></thead>
              <tbody>{state.rows.map((r) => (
                <tr key={r.line} className={r.status === "galat" ? "bg-red-50/60" : undefined}>
                  <td className="tabular-nums text-slate-500">{r.line}</td>
                  <td><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${IMP[r.status].cls}`}>{IMP[r.status].label}</span></td>
                  <td className="font-mono text-[12px]">{r.label}</td>
                  <td className="num">{formatAmount(r.total)}</td>
                  <td className="num">{r.pagu === null ? "—" : formatAmount(r.pagu)}</td>
                  <td className="text-xs text-slate-600">{r.message}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export interface SourceOpt { id: string; label: string }

/** Penyesuaian kas akibat pergeseran/perubahan: salin dari tahapan sebelumnya lalu sesuaikan ke pagu baru (draf). */
export function CashAdjustPanel({ versionId, sources, defaultSource, admin = false }: { versionId: string; sources: SourceOpt[]; defaultSource: string; admin?: boolean }) {
  const [state, dispatch, pending] = useActionState<CashAdjustState, FormData>(adjustCashAction, { phase: "idle" });
  const ref = useRef<HTMLFormElement>(null);
  const [intent, setIntent] = useState<"preview" | "apply">("preview");
  const run = (which: "preview" | "apply") => {
    if (!ref.current) return;
    const fd = new FormData(ref.current); fd.set("intent", which); setIntent(which);
    startTransition(() => dispatch(fd));
  };
  const n = (state.counts?.salin ?? 0) + (state.counts?.kurangi ?? 0) + (state.counts?.tambah ?? 0) + (state.counts?.baru ?? 0) + (state.counts?.realisasi ?? 0);
  const canApply = state.phase === "preview" && n > 0;
  if (sources.length === 0) return <p className="border-t border-slate-100 p-5 text-sm text-slate-600">Belum ada tahapan lain pada tahun anggaran ini sebagai sumber salinan. Buat versi Pergeseran/Perubahan di Input Anggaran terlebih dahulu.</p>;
  return (
    <div className="space-y-4 border-t border-slate-100 p-5">
      <p className="text-sm text-slate-600">
        Setelah pagu berubah, anggaran kas disesuaikan <b>per butir (kode rekening)</b> dari tahapan sumber. <b>Pergeseran</b>: pagu hanya berpindah antar-rekening dalam sub kegiatan yang sama (boleh beberapa kali setahun; pilih versi pergeseran sebelumnya sebagai sumber).
        <b> Perubahan</b>: pagu dapat naik/turun; hanya butir yang pagunya berubah yang disesuaikan, butir yang pagunya tetap <b>kasnya tetap</b>. Hasil berupa <b>draf</b>{admin ? " untuk PPTK masing-masing" : ""} yang harus diajukan ulang. Isian yang sudah ada dilindungi.
      </p>
      <form ref={ref} onSubmit={(e) => { e.preventDefault(); run("preview"); }} className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="versionId" value={versionId} />
        <Field label="Salin dari tahapan" htmlFor="adj-src">
          <Select id="adj-src" name="sourceVersion" defaultValue={defaultSource}>{sources.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>
        </Field>
        <Field label="Cara menyesuaikan" htmlFor="adj-mode" className="sm:col-span-2" hint="Mode tahapan memakai tanggal DPA versi yang dibuka: perubahan kas ditempatkan pada triwulan DPA s.d. TW IV. Mode realisasi mengunci bulan sebelum bulan DPA ke realisasi nyata.">
          <Select id="adj-mode" name="mode" defaultValue="tahapan">
            <option value="tahapan">Sesuai tahapan: pagu tetap = kas tetap, pagu berubah = kas disesuaikan (disarankan)</option>
            <option value="realisasi">Sesuaikan dengan realisasi</option>
            <option value="salin">Salin kas tahapan sebelumnya, kecilkan bila pagu turun</option>
          </Select>
        </Field>
        <label className="flex items-end gap-2 pb-2 text-sm text-slate-700"><input type="checkbox" name="overwrite" value="true" className="h-4 w-4 rounded border-slate-300" /> Timpa isian yang sudah ada (draf/dikembalikan)</label>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Btn type="submit" tone="outline" pending={pending} busy={intent === "preview"}><ScanSearch size={15} aria-hidden /> Periksa dulu</Btn>
          <Btn tone="accent" pending={pending} busy={intent === "apply"} disabled={!canApply} onClick={() => run("apply")} title={canApply ? undefined : "Jalankan “Periksa dulu” terlebih dahulu"}><Repeat2 size={15} aria-hidden /> Salin &amp; sesuaikan{canApply ? ` (${n} butir)` : ""}</Btn>
        </div>
      </form>
      {state.phase === "error" && state.error && <Alert>{state.error}</Alert>}
      {state.phase === "done" && state.applied && (
        <Alert tone={state.applied.gagal.length ? "amber" : "green"}>
          <p className="flex items-center gap-2 font-semibold"><CheckCircle2 size={16} aria-hidden /> {state.applied.saved} butir disalin/disesuaikan sebagai draf. Periksa di tabel, lalu ajukan.</p>
          {state.applied.gagal.length > 0 && <p className="mt-1">{state.applied.gagal.length} gagal: {state.applied.gagal.slice(0, 4).join("; ")}</p>}
        </Alert>
      )}
      {state.warnings && state.warnings.length > 0 && <Alert tone="amber"><ul className="list-disc space-y-1 pl-5">{state.warnings.map((w) => <li key={w}>{w}</li>)}</ul></Alert>}
      {state.counts && state.rows && (
        <div className="animate-fade-up space-y-2">
          <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-slate-700">Sumber: {state.source}</span><Chips counts={state.counts} map={ADJ} />{(state.others ?? 0) > 0 && <span className="text-xs text-slate-500">{state.others} butir {admin ? "tanpa PPTK" : "milik PPTK lain"} tidak diproses</span>}</div>
          {state.rows.length > 0 && (
            <div className="max-h-96 overflow-auto rounded-lg border border-slate-200">
              <table className="table-base">
                <thead className="sticky top-0 z-10"><tr><th>Status</th><th>Butir</th><th className="text-right">Pagu lama</th><th className="text-right">Pagu baru</th><th className="text-right">Kas lama</th><th className="text-right">Kas hasil</th><th>Keterangan</th></tr></thead>
                <tbody>{state.rows.map((r) => (
                  <tr key={r.itemId}>
                    <td><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${ADJ[r.status].cls}`}>{ADJ[r.status].label}</span></td>
                    <td className="font-mono text-[12px]">{r.label}</td>
                    <td className="num">{r.oldPagu === null ? "—" : formatAmount(r.oldPagu)}</td>
                    <td className="num">{formatAmount(r.newPagu)}</td>
                    <td className="num">{formatAmount(r.oldTotal)}</td>
                    <td className="num font-medium">{r.months ? formatAmount(r.newTotal) : "—"}</td>
                    <td className="text-xs text-slate-600">{r.message}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
