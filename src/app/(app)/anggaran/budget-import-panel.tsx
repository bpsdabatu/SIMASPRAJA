"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { CheckCircle2, FileSpreadsheet, Loader2, ScanSearch, Upload } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import type { BudgetImportState, RowStatus } from "@/lib/budget-import-core";
import { formatAmount } from "@/lib/format";
import { importBudgetAction } from "./actions";

export interface VersionOpt { id: string; label: string }

const TONE: Record<RowStatus, { label: string; cls: string }> = {
  baru: { label: "Baru", cls: "bg-emerald-100 text-emerald-800" },
  ubah: { label: "Disesuaikan", cls: "bg-amber-100 text-amber-800" },
  sama: { label: "Sama", cls: "bg-slate-100 text-slate-600" },
  lewati: { label: "Dilewati", cls: "bg-slate-100 text-slate-600" },
  galat: { label: "Galat", cls: "bg-red-100 text-red-700" },
};

/**
 * Panel impor/penyesuaian anggaran: pilih tahun + tahapan tujuan → unggah Excel/CSV → "Periksa dulu" (pratinjau baru/disesuaikan/sama/galat)
 * → "Terapkan". Berkas dikirim ulang dan divalidasi ulang di server pada tahap terapkan; klien tidak pernah dipercaya.
 */
export function BudgetImportPanel({ versions, defaultVersionId }: { versions: VersionOpt[]; defaultVersionId: string }) {
  const [state, dispatch, pending] = useActionState<BudgetImportState, FormData>(importBudgetAction, { phase: "idle" });
  const formRef = useRef<HTMLFormElement>(null);
  const [intent, setIntent] = useState<"preview" | "apply">("preview");

  // Dikirim manual (bukan <form action>) agar berkas yang dipilih tidak dikosongkan otomatis setelah pratinjau.
  const submit = (which: "preview" | "apply") => {
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    fd.set("intent", which);
    setIntent(which);
    startTransition(() => dispatch(fd));
  };

  const c = state.counts;
  const changes = (c?.baru ?? 0) + (c?.ubah ?? 0);
  const canApply = state.phase === "preview" && changes > 0;

  return (
    <div className="space-y-4 p-5">
      <p className="text-sm text-slate-600">
        Unggah anggaran awal <b>atau penyesuaian</b> (Pergeseran/Perubahan) ke tahun dan tahapan yang Anda pilih. Butir yang belum ada <b>ditambahkan</b>; butir yang sudah ada
        <b> disesuaikan pagunya</b> (tidak boleh di bawah realisasi); butir yang tidak ada di berkas <b>tidak disentuh</b>. Bila ada satu baris bermasalah, seluruh impor dibatalkan.
      </p>
      <div className="flex flex-wrap gap-2">
        <a href="/anggaran/template?format=xlsx" className={buttonVariants({ variant: "outline", size: "sm" })}><FileSpreadsheet size={14} aria-hidden /> Templat Excel (+ lembar Referensi kode)</a>
        <a href="/anggaran/template?format=csv" className={buttonVariants({ variant: "outline", size: "sm" })}><FileSpreadsheet size={14} aria-hidden /> Templat CSV</a>
      </div>
      <p className="text-xs text-slate-500">
        Kolom: <code className="rounded bg-slate-100 px-1">kode_sub_kegiatan; kode_rekening; sumber_dana; pptk; uraian; pagu</code> (opsional <code className="rounded bg-slate-100 px-1">tahun; tahapan</code> sebagai pengaman).
        <b> sumber_dana</b> boleh kode atau nama (PAD / DBH CHT); <b>pptk</b> boleh username atau nama lengkap. Format kolom kode sebagai Teks di Excel.
      </p>

      <form ref={formRef} onSubmit={(e) => { e.preventDefault(); submit("preview"); }} encType="multipart/form-data" className="grid gap-4 sm:grid-cols-2">
        <Field label="Versi tujuan (tahun anggaran + tahapan)" htmlFor="bi-target">
          <Select id="bi-target" name="targetVersion" defaultValue={defaultVersionId} required>
            {versions.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </Select>
        </Field>
        <Field label="Cara memproses" htmlFor="bi-mode">
          <Select id="bi-mode" name="mode" defaultValue="tambah_perbarui">
            <option value="tambah_perbarui">Tambah butir baru + sesuaikan pagu/PPTK butir yang sudah ada</option>
            <option value="tambah_saja">Hanya tambah butir baru (yang sudah ada dilewati)</option>
          </Select>
        </Field>
        <Field label="Berkas Excel (.xlsx) atau CSV" htmlFor="bi-file" className="sm:col-span-2">
          <Input id="bi-file" name="file" type="file" accept=".xlsx,.csv,text/csv,.txt" className="h-auto py-2" />
        </Field>
        <details className="sm:col-span-2">
          <summary className="cursor-pointer text-sm font-medium text-navy-700">atau tempel isi CSV</summary>
          <Textarea name="csv" rows={4} className="mt-2 font-mono text-xs" />
        </details>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <button type="submit" disabled={pending}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-navy-300 bg-white px-4 text-sm font-semibold text-navy-800 transition hover:bg-navy-50 disabled:opacity-60">
            {pending && intent === "preview" ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <ScanSearch size={15} aria-hidden />} Periksa dulu
          </button>
          <button type="button" disabled={pending || !canApply} onClick={() => submit("apply")}
            title={canApply ? undefined : "Jalankan “Periksa dulu” terlebih dahulu"}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-gold-500 px-4 text-sm font-semibold text-navy-950 shadow-sm transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-50">
            {pending && intent === "apply" ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Upload size={15} aria-hidden />}
            Terapkan{canApply ? ` (${changes} perubahan)` : ""}
          </button>
        </div>
      </form>

      {state.phase === "error" && state.error && <Alert>{state.error}</Alert>}
      {state.phase === "done" && state.applied && (
        <Alert tone={state.applied.gagal.length ? "amber" : "green"}>
          <p className="flex items-center gap-2 font-semibold"><CheckCircle2 size={16} aria-hidden /> {state.target}: {state.applied.baru} butir baru, {state.applied.ubah} butir disesuaikan.</p>
          {state.applied.gagal.length > 0 && <p className="mt-1">{state.applied.gagal.length} baris gagal (yang lain sudah tersimpan): {state.applied.gagal.slice(0, 4).join("; ")}{state.applied.gagal.length > 4 ? " …" : ""}</p>}
        </Alert>
      )}

      {c && state.rows && state.rows.length > 0 && (
        <div className="animate-fade-up space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-slate-700">{state.target}</span>
            {(Object.keys(TONE) as RowStatus[]).filter((k) => c[k] > 0).map((k) => (
              <span key={k} className={`rounded-full px-2.5 py-0.5 font-medium ${TONE[k].cls}`}>{TONE[k].label}: {c[k]}</span>
            ))}
          </div>
          <div className="max-h-[28rem] overflow-auto rounded-lg border border-slate-200">
            <table className="table-base">
              <thead className="sticky top-0 z-10"><tr><th>Baris</th><th>Status</th><th>Sub kegiatan</th><th>Rekening</th><th>Sumber dana</th><th>PPTK</th><th className="text-right">Pagu lama</th><th className="text-right">Pagu berkas</th><th>Keterangan</th></tr></thead>
              <tbody>
                {state.rows.map((r) => (
                  <tr key={r.line} className={r.status === "galat" ? "bg-red-50/60" : undefined}>
                    <td className="tabular-nums text-slate-500">{r.line}</td>
                    <td><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[r.status].cls}`}>{TONE[r.status].label}</span></td>
                    <td className="font-mono text-[12px]">{r.subCode}</td>
                    <td className="font-mono text-[12px]">{r.accountCode}</td>
                    <td>{r.funding}</td>
                    <td>{r.pptkText || "—"}</td>
                    <td className="num">{r.oldPagu === null ? "—" : formatAmount(r.oldPagu)}</td>
                    <td className={`num font-medium ${r.status === "ubah" ? "text-amber-700" : ""}`}>{formatAmount(r.pagu)}</td>
                    <td className="text-xs text-slate-600">{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {state.truncated && <p className="text-xs text-slate-500">Menampilkan 300 baris pertama; seluruh baris tetap diproses saat diterapkan.</p>}
        </div>
      )}
    </div>
  );
}
