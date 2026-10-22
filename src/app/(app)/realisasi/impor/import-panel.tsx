"use client";

import { startTransition, useActionState, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, ScanSearch, Upload } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { LiveFilter } from "@/components/live-filter";
import { formatAmount, formatRupiah } from "@/lib/format";
import type { RealizationImportState, RowStatus } from "@/lib/realization-import-core";
import { importRealizationAction } from "./actions";

const TONE: Record<RowStatus, { label: string; cls: string }> = {
  baru: { label: "Akan diimpor", cls: "bg-emerald-100 text-emerald-800" },
  ada: { label: "Sudah ada", cls: "bg-slate-100 text-slate-600" },
  mirip: { label: "Mirip", cls: "bg-amber-100 text-amber-800" },
  galat: { label: "Galat", cls: "bg-red-100 text-red-700" },
};
const STAGE_BAR: Record<string, string> = { murni: "bg-sky-500", pergeseran: "bg-amber-500", perubahan: "bg-violet-500" };
const dmy = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");

export function RealizationImportPanel({ canCreateMethods }: { canCreateMethods: boolean }) {
  const [state, dispatch, pending] = useActionState<RealizationImportState, FormData>(importRealizationAction, { phase: "idle" });
  const ref = useRef<HTMLFormElement>(null);
  const [intent, setIntent] = useState<"preview" | "apply">("preview");
  const [methodPick, setMethodPick] = useState<Record<string, string>>({});
  const [show, setShow] = useState<"semua" | RowStatus>("semua");

  const run = (which: "preview" | "apply") => {
    if (!ref.current) return;
    const fd = new FormData(ref.current);
    fd.set("intent", which);
    fd.set("methodMap", JSON.stringify(methodPick));
    setIntent(which);
    startTransition(() => dispatch(fd));
  };

  const c = state.counts;
  const canApply = state.phase === "preview" && (c?.baru ?? 0) > 0;
  const rows = useMemo(() => (state.rows ?? []).filter((r) => show === "semua" || r.status === show), [state.rows, show]);
  const totalStage = (state.byStage ?? []).reduce((a, s) => a + s.amount, 0) || 1;

  return (
    <div className="space-y-5">
      <form ref={ref} onSubmit={(e) => { e.preventDefault(); run("preview"); }} encType="multipart/form-data" className="grid gap-4 sm:grid-cols-2">
        <Field label="Berkas laporan realisasi (.xlsx atau .csv)" htmlFor="ri-file" className="sm:col-span-2">
          <Input id="ri-file" name="file" type="file" accept=".xlsx,.csv,.txt" required className="h-auto py-2" />
        </Field>
        <Field label="Tahapan ditentukan oleh tanggal" htmlFor="ri-basis" hint="Tahapan = DPA yang berlaku pada tanggal tersebut (mis. sebelum 16 Mar 2026 = Murni).">
          <Select id="ri-basis" name="basis" defaultValue="transaksi">
            <option value="transaksi">Tanggal transaksi (disarankan)</option>
            <option value="sp2d">Tanggal SP2D (bila ada, jika tidak tanggal transaksi)</option>
          </Select>
        </Field>
        <div className="space-y-2 pt-6 text-sm text-slate-700">
          <label className="flex items-start gap-2"><input type="checkbox" name="includeSimilar" value="true" className="mt-0.5 h-4 w-4 rounded border-slate-300" /> Tetap impor yang mirip transaksi yang sudah ada (butir, tanggal, nilai sama)</label>
          <label className="flex items-start gap-2"><input type="checkbox" name="onlyValid" value="true" className="mt-0.5 h-4 w-4 rounded border-slate-300" /> Impor baris valid saja (lewati baris bermasalah; dapat diunggah ulang setelah diperbaiki)</label>
        </div>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <button type="submit" disabled={pending} className="inline-flex h-10 items-center gap-2 rounded-lg border border-navy-300 bg-white px-4 text-sm font-semibold text-navy-800 transition hover:bg-navy-50 disabled:opacity-60">
            {pending && intent === "preview" ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <ScanSearch size={15} aria-hidden />} Periksa dulu
          </button>
          <button type="button" disabled={pending || !canApply} onClick={() => run("apply")} title={canApply ? undefined : "Jalankan “Periksa dulu” terlebih dahulu"}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-gold-500 px-4 text-sm font-semibold text-navy-950 shadow-sm transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-50">
            {pending && intent === "apply" ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Upload size={15} aria-hidden />} Impor{canApply ? ` ${c!.baru} transaksi` : ""}
          </button>
          <a href="/realisasi/impor/template" className={buttonVariants({ variant: "outline", size: "sm" }) + " h-10"}><FileSpreadsheet size={14} aria-hidden /> Templat Excel</a>
        </div>
      </form>

      {state.phase === "error" && state.error && <Alert>{state.error}</Alert>}
      {state.phase === "preview" && state.error && <Alert tone="amber">{state.error}</Alert>}
      {state.phase === "done" && state.applied && (
        <Alert tone={state.applied.gagal.length ? "amber" : "green"}>
          <p className="flex items-center gap-2 font-semibold"><CheckCircle2 size={16} aria-hidden /> {state.applied.imported} transaksi diimpor ({formatRupiah(state.applied.amount)}){state.applied.skipped ? `, ${state.applied.skipped} dilewati (sudah ada)` : ""}.</p>
          {state.applied.gagal.length > 0 && <p className="mt-1">{state.applied.gagal.length} gagal: {state.applied.gagal.slice(0, 4).join("; ")}{state.applied.gagal.length > 4 ? " …" : ""}</p>}
          <p className="mt-1 text-xs">Berikutnya: <Link href="/anggaran-kas" className="font-semibold underline">sesuaikan Anggaran Kas dengan realisasi</Link> bila terjadi pergantian tahapan.</p>
        </Alert>
      )}

      {c && state.byStage && (
        <div className="animate-fade-up space-y-4">
          {state.reconcile && (
            <p className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${state.reconcile.ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
              {state.reconcile.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />}
              <span>{state.reconcile.notes.join(" ")}</span>
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {state.byStage.map((s) => (
              <div key={s.versionId} className="card-lift pop-in rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{s.label}</p>
                <p className="mt-1 font-display text-lg font-bold tabular-nums text-navy-900">{formatRupiah(s.amount)}</p>
                <p className="text-xs text-slate-500">{s.count} transaksi · DPA {dmy(s.dpaDate)}</p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`bar-grow h-full rounded-full ${STAGE_BAR[s.stage] ?? "bg-slate-500"}`} style={{ width: `${Math.max(3, (s.amount / totalStage) * 100)}%` }} /></div>
              </div>
            ))}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <p className="font-semibold">Ringkasan</p>
              <div className="mt-1 flex flex-wrap gap-1.5">{(Object.keys(TONE) as RowStatus[]).filter((k) => c[k] > 0).map((k) => <span key={k} className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE[k].cls}`}>{TONE[k].label}: {c[k]}</span>)}</div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600">
            <p className="font-semibold text-slate-700">Tanggal DPA yang dipakai menentukan tahapan</p>
            <ul className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
              {(state.versions ?? []).map((v) => <li key={v.label}>{v.label}: <b>{dmy(v.dpaDate)}</b>{v.status === "draft" ? " (draf)" : ""}</li>)}
            </ul>
            <p className="mt-1">Tanggal DPA Perubahan dapat diisi di <Link href="/anggaran" className="font-semibold text-navy-700 underline">Input Anggaran</Link> saat sudah ditetapkan; transaksi setelah tanggal itu otomatis masuk Perubahan.</p>
          </div>

          {(state.straddle ?? 0) > 0 && (
            <p className="flex items-start gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900"><AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden /><span>{state.straddle} transaksi berbeda tahapan antara tanggal transaksi dan tanggal SP2D (lintas DPA). Tahapan mengikuti tanggal yang Anda pilih di atas; lihat kolom Catatan.</span></p>
          )}

          {(state.methods ?? []).length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-sm font-semibold text-slate-700">Metode pengadaan</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {state.methods!.map((m) => {
                  const cur = methodPick[m.fileName] ?? m.resolvedId ?? "";
                  const needs = !cur;
                  return (
                    <label key={m.fileName} className="text-xs text-slate-600">
                      <span className="font-medium text-slate-800">{m.fileName}</span> · {m.count} transaksi · {formatRupiah(m.amount)}
                      <Select value={cur} onChange={(e) => setMethodPick((p) => ({ ...p, [m.fileName]: e.target.value }))} className={needs ? "mt-1 border-amber-400" : "mt-1"}>
                        <option value="">— Kosongkan —</option>
                        {state.methodOptions!.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                        {canCreateMethods && <option value="__buat__">+ Buat metode “{m.fileName}”</option>}
                      </Select>
                      {needs && m.candidates.length > 1 && <span className="text-amber-700">Beberapa tipe cocok; pilih yang sesuai.</span>}
                    </label>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-slate-500">Pilihan dikirim saat “Periksa dulu” / “Impor”. Metode boleh dikosongkan.</p>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {(["semua", "baru", "galat", "mirip", "ada"] as const).map((k) => (
                <button key={k} type="button" onClick={() => setShow(k)} className={`rounded-full border px-3 py-1 text-xs font-medium transition ${show === k ? "border-navy-700 bg-navy-700 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
                  {k === "semua" ? `Semua (${state.rows?.length ?? 0})` : `${TONE[k].label} (${c[k]})`}
                </button>
              ))}
              <LiveFilter tableId="tbl-impor-real" placeholder="Saring cepat…" />
            </div>
            <div className="max-h-[32rem] overflow-auto rounded-lg border border-slate-200">
              <table id="tbl-impor-real" className="table-base">
                <thead className="sticky top-0 z-10"><tr><th>No</th><th>Status</th><th>Tahapan</th><th>Tgl Transaksi</th><th>Tgl SP2D</th><th>Sub kegiatan / belanja</th><th>PPTK</th><th className="text-right">Nominal</th><th>Catatan</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.index} data-s={`${r.no} ${r.desc} ${r.sub} ${r.account} ${r.pptk} ${r.stageLabel ?? ""} ${r.message}`.toLowerCase()} className={r.status === "galat" ? "bg-red-50/60" : undefined}>
                      <td className="tabular-nums text-slate-500">{r.no}</td>
                      <td><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[r.status].cls}`}>{TONE[r.status].label}</span></td>
                      <td className="whitespace-nowrap text-xs font-medium">{r.stageLabel ?? "—"}</td>
                      <td className="whitespace-nowrap tabular-nums">{dmy(r.txDate)}</td>
                      <td className="whitespace-nowrap tabular-nums">{dmy(r.sp2dDate)}</td>
                      <td className="max-w-[22rem] text-xs"><span className="block truncate" title={r.sub}>{r.sub}</span><span className="block truncate text-slate-500" title={r.account}>{r.account}</span>{r.desc && <span className="block truncate text-slate-400" title={r.desc}>{r.desc}</span>}</td>
                      <td className="text-xs">{r.pptk || "—"}</td>
                      <td className="num font-medium">{formatAmount(r.amount)}</td>
                      <td className="text-xs text-slate-600">{r.message}{r.notes.map((n) => <span key={n} className="block text-sky-700">• {n}</span>)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {state.truncated && <p className="text-xs text-slate-500">Menampilkan {state.rows?.length} baris pertama; seluruh baris tetap diproses.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
