"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Search } from "lucide-react";
import { TW_LABEL, allocation, cents, parseAmount, parseLoose, quarterSums, quartersToMonths, spreadQuarters } from "@/lib/cash-core";
import { cashStatusAction, deleteCashPlanAction, saveCashPlansBulkAction } from "./actions";

export type PlanStatus = "none" | "draft" | "submitted" | "returned" | "final";

export interface GridRow {
  itemId: string; planId: string | null;
  subCode: string; subName: string; account: string; desc: string; pptk: string;
  pagu: number; months: number[]; status: PlanStatus; rev: number; reason: string | null;
  /** Butir ini milik PPTK yang sedang login. */
  mine: boolean;
}

const STATUS: Record<PlanStatus, { label: string; cls: string }> = {
  none: { label: "Belum disusun", cls: "bg-slate-100 text-slate-700" },
  draft: { label: "Draf", cls: "bg-amber-100 text-amber-800" },
  submitted: { label: "Diajukan", cls: "bg-sky-100 text-sky-800" },
  returned: { label: "Dikembalikan", cls: "bg-red-100 text-red-700" },
  final: { label: "Final", cls: "bg-emerald-100 text-emerald-700" },
};

const nf0 = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rp = (n: number) => `Rp ${nf2.format(n)}`;
const short = (n: number) => (n ? nf0.format(n) : "—");
const toRaw = (v: number) => (v ? String(v) : "");

function Btn({ intent, children, tone, disabled }: { intent: "draft" | "submit"; children: React.ReactNode; tone: "outline" | "accent"; disabled: boolean }) {
  const { pending } = useFormStatus();
  const cls = tone === "accent" ? "bg-gold-500 text-navy-950 hover:bg-gold-400" : "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50";
  return (
    <button type="submit" name="intent" value={intent} disabled={pending || disabled}
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${cls}`}>
      {pending && <Loader2 size={15} className="animate-spin" aria-hidden />}{children}
    </button>
  );
}

/**
 * Tabel Anggaran Kas ringkas: seluruh butir dalam satu tabel, hitung langsung (total/sisa/lebih pagu), tempel dari Excel,
 * bagi rata, Enter pindah baris, lalu "Simpan draf" atau "Simpan & ajukan" untuk SEMUA butir sekaligus.
 * Server tetap memeriksa ulang setiap butir (hak PPTK penugasan, total kas ≤ pagu).
 */
export function CashPlanGrid({ versionId, rows, canEdit, canSubmit, canFinalize }: {
  versionId: string; rows: GridRow[]; canEdit: boolean; canSubmit: boolean; canFinalize: boolean;
}) {
  const [raw, setRaw] = useState<Record<string, string[]>>(() => Object.fromEntries(rows.map((r) => [r.itemId, quarterSums(r.months).map(toRaw)])));
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "todo" | "dirty" | "locked">("all");
  const tableRef = useRef<HTMLTableElement>(null);

  const calc = useMemo(() => rows.map((r) => {
    const oldQ = quarterSums(r.months);
    const cells = raw[r.itemId] ?? oldQ.map(toRaw);
    const parsed = cells.map(parseAmount);
    const invalid = parsed.some((v) => Number.isNaN(v));
    const quarters = parsed.map((v) => (Number.isNaN(v) ? 0 : v));
    const months = quartersToMonths(quarters); // disimpan sebagai 12 periode (tiap triwulan dibagi 3)
    const a = allocation(r.pagu, months);
    const editable = canEdit && r.mine && (r.status === "none" || r.status === "draft" || r.status === "returned");
    const dirty = quarters.some((v, i) => cents(v) !== cents(oldQ[i] ?? 0));
    return { r, months, quarters, invalid, a, editable, dirty, over: a.state === "lebih" };
  }), [rows, raw, canEdit]);

  const dirtyRows = calc.filter((c) => c.editable && c.dirty);
  const blocked = dirtyRows.filter((c) => c.invalid || c.over);
  const hasPlan = (c: (typeof calc)[number]) => c.r.status === "draft" || c.r.status === "returned";
  const submitRows = calc.filter((c) => c.editable && (c.dirty || hasPlan(c) || c.r.pagu <= 0));
  const submitBlocked = submitRows.filter((c) => c.invalid || c.over);
  const draftPayload = JSON.stringify(dirtyRows.map((c) => ({ i: c.r.itemId, m: c.months, l: `${c.r.subCode} ${c.r.account}`.slice(0, 80) })));
  const submitPayload = JSON.stringify(submitRows.map((c) => ({ i: c.r.itemId, m: c.months, l: `${c.r.subCode} ${c.r.account}`.slice(0, 80) })));

  useEffect(() => {
    if (dirtyRows.length === 0) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirtyRows.length]);

  const needle = q.trim().toLowerCase();
  const visible = calc.filter((c) => {
    if (needle && ![c.r.subCode, c.r.subName, c.r.account, c.r.desc, c.r.pptk].some((x) => x.toLowerCase().includes(needle))) return false;
    if (filter === "todo") return c.editable && c.a.state !== "penuh";
    if (filter === "dirty") return c.editable && c.dirty;
    if (filter === "locked") return !c.editable;
    return true;
  });

  const setRow = (id: string, vals: number[]) => setRaw((s) => ({ ...s, [id]: vals.map(toRaw) }));
  const setCell = (id: string, i: number, v: string) => setRaw((s) => ({ ...s, [id]: (s[id] ?? []).map((x, k) => (k === i ? v : x)) }));

  const fillEmpty = () => setRaw((s) => {
    const next = { ...s };
    for (const c of visible) if (c.editable && c.a.state === "kosong" && c.r.pagu > 0) next[c.r.itemId] = spreadQuarters(c.r.pagu).map(toRaw);
    return next;
  });

  const focusCell = (row: number, col: number) => tableRef.current?.querySelector<HTMLInputElement>(`input[data-r="${row}"][data-c="${col}"]`)?.focus();

  /** Tempel blok dari Excel (tab/baris baru): mengisi triwulan berurutan dan baris berikutnya yang dapat diedit. */
  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>, vIdx: number, col: number) => {
    const text = e.clipboardData.getData("text");
    if (!/[\t\n]/.test(text.trim())) return; // satu nilai: perilaku bawaan
    e.preventDefault();
    const lines = text.replace(/\r/g, "").split("\n").filter((l, i, a) => l !== "" || i < a.length - 1);
    setRaw((s) => {
      const next = { ...s };
      lines.forEach((line, li) => {
        const target = visible[vIdx + li];
        if (!target || !target.editable) return;
        const cur = [...(next[target.r.itemId] ?? [])];
        line.split("\t").forEach((cell, ci) => {
          if (col + ci > 3) return;
          const v = parseLoose(cell);
          cur[col + ci] = Number.isNaN(v) ? cell.trim() : toRaw(v);
        });
        next[target.r.itemId] = cur;
      });
      return next;
    });
  };

  const totals = TW_LABEL.map((_, i) => calc.reduce((s, c) => s + cents(c.quarters[i] ?? 0), 0) / 100);
  const grand = totals.reduce((a, b) => a + cents(b), 0) / 100;
  const paguAll = calc.reduce((s, c) => s + cents(c.r.pagu), 0) / 100;
  const editableCount = calc.filter((c) => c.editable).length;

  const th = "whitespace-nowrap px-1.5 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-600";
  let lastSub = "";

  return (
    <div className="space-y-3">
      {/* Bilah alat */}
      <div className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-card backdrop-blur">
        <label className="relative">
          <span className="sr-only">Cari butir</span>
          <Search size={14} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari sub kegiatan / rekening…" className="h-9 w-56 rounded-lg border border-slate-300 bg-white pl-8 pr-2 text-sm focus:border-navy-600 focus:outline-none focus:ring-2 focus:ring-navy-200" />
        </label>
        <select aria-label="Saring butir" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm">
          <option value="all">Semua butir ({calc.length})</option>
          <option value="todo">Perlu diisi / belum penuh</option>
          <option value="dirty">Belum disimpan ({dirtyRows.length})</option>
          <option value="locked">Diajukan / final / bukan milik saya</option>
        </select>
        {canEdit && editableCount > 0 && (
          <>
            <button type="button" onClick={fillEmpty} className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50">Bagi rata 4 TW (yang kosong)</button>
          </>
        )}
        {canEdit && (
          <form action={saveCashPlansBulkAction} className="ml-auto flex flex-wrap items-center gap-2">
            <input type="hidden" name="versionId" value={versionId} />
            <input type="hidden" name="payload_draft" value={draftPayload} />
            <input type="hidden" name="payload_submit" value={submitPayload} />
            <Btn intent="draft" tone="outline" disabled={dirtyRows.length === 0 || blocked.length > 0}>Simpan draf{dirtyRows.length ? ` (${dirtyRows.length})` : ""}</Btn>
            {canSubmit && <Btn intent="submit" tone="accent" disabled={submitRows.length === 0 || submitBlocked.length > 0}>Simpan &amp; ajukan{submitRows.length ? ` (${submitRows.length})` : ""}</Btn>}
          </form>
        )}
      </div>
      {canEdit && blocked.length > 0 && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {blocked.length} butir belum bisa disimpan: ada isian tidak valid (gunakan angka) atau total kas melebihi pagu. Baris bermasalah ditandai merah.
        </p>
      )}
      {canEdit && (
        <p className="text-xs text-slate-500">
          Tips: Tab/Enter untuk berpindah sel · tempel (Ctrl+V) blok angka dari Excel (4 kolom triwulan) · ÷TW = bagi rata pagu ke 4 triwulan. Total kas boleh kurang dari pagu, tidak boleh melebihi pagu.
          {dirtyRows.length > 0 && <b className="ml-1 text-amber-700">{dirtyRows.length} butir belum disimpan.</b>}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
        <table ref={tableRef} className="w-full border-collapse text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="sticky left-0 z-10 min-w-[15rem] bg-slate-50 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600">Rekening / uraian</th>
              <th className={th}>Pagu</th>
              {TW_LABEL.map((m) => <th key={m} className={th}>{m}</th>)}
              <th className={th}>Total kas</th>
              <th className={th}>Sisa</th>
              <th className="px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600">Status / aksi</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-500">Tidak ada butir yang cocok.</td></tr>}
            {visible.map((c, vIdx) => {
              const { r, a } = c;
              const header = r.subCode !== lastSub ? (lastSub = r.subCode, true) : false;
              const rowTone = c.over || c.invalid ? "bg-red-50/70" : c.dirty && c.editable ? "bg-amber-50/60" : "";
              const st = STATUS[r.status];
              return (
                <Fragment key={r.itemId}>
                  {header && (
                    <tr className="bg-navy-50/70"><td colSpan={9} className="px-3 py-1.5 text-xs font-semibold text-navy-800"><span className="font-mono">{r.subCode}</span> — {r.subName}</td></tr>
                  )}
                  <tr className={`border-t border-slate-100 align-top ${rowTone}`}>
                    <td className={`sticky left-0 z-10 min-w-[15rem] max-w-[20rem] px-3 py-1.5 ${rowTone || "bg-white"}`}>
                      <p className="text-[13px] font-medium leading-snug text-slate-900">{r.account}</p>
                      {(r.desc || r.pptk) && <p className="text-[11px] leading-snug text-slate-500">{r.desc}{r.desc && r.pptk ? " · " : ""}{r.pptk ? `PPTK: ${r.pptk}` : "PPTK belum ditugaskan"}</p>}
                      {r.status === "returned" && r.reason && <p className="mt-0.5 rounded bg-red-100 px-1.5 py-0.5 text-[11px] text-red-800">Dikembalikan: {r.reason}</p>}
                      {c.invalid && <p role="alert" className="mt-0.5 text-[11px] font-medium text-red-700">Isian tidak valid (angka saja, maks. 2 desimal).</p>}
                      {c.over && <p role="alert" className="mt-0.5 text-[11px] font-medium text-red-700">Melebihi pagu {rp(Math.abs(a.sisa))}.</p>}
                    </td>
                    <td className="whitespace-nowrap px-1.5 py-1.5 text-right text-[13px] tabular-nums text-slate-900">{nf0.format(r.pagu)}</td>
                    {TW_LABEL.map((m, i) => (
                      <td key={m} className="px-0.5 py-1">
                        {c.editable ? (
                          <input
                            data-r={vIdx} data-c={i} aria-label={`${r.account} ${m}`} inputMode="decimal" autoComplete="off" placeholder="0" disabled={r.pagu <= 0}
                            value={raw[r.itemId]?.[i] ?? ""}
                            onChange={(e) => setCell(r.itemId, i, e.target.value)}
                            onPaste={(e) => onPaste(e, vIdx, i)}
                            onFocus={(e) => e.currentTarget.select()}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); focusCell(vIdx + (e.shiftKey ? -1 : 1), i); } }}
                            aria-invalid={Number.isNaN(parseAmount(raw[r.itemId]?.[i] ?? ""))}
                            className={`h-8 w-[8rem] rounded-md border px-1.5 text-right text-xs tabular-nums focus:outline-none focus:ring-2 disabled:bg-slate-100 ${Number.isNaN(parseAmount(raw[r.itemId]?.[i] ?? "")) ? "border-red-400 focus:ring-red-200" : "border-slate-300 bg-white focus:border-navy-600 focus:ring-navy-200"}`}
                          />
                        ) : (
                          <span className="block w-[8rem] px-1.5 text-right text-xs tabular-nums text-slate-700">{short(quarterSums(r.months)[i] ?? 0)}</span>
                        )}
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-1.5 py-1.5 text-right text-[13px] font-semibold tabular-nums text-navy-900">{nf0.format(a.input)}</td>
                    <td className={`whitespace-nowrap px-1.5 py-1.5 text-right text-[13px] tabular-nums ${c.over ? "font-bold text-red-700" : a.state === "penuh" ? "text-emerald-700" : "text-amber-700"}`}>{c.over ? `−${nf0.format(Math.abs(a.sisa))}` : nf0.format(a.sisa)}</td>
                    <td className="min-w-[9.5rem] px-2 py-1.5">
                      <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>{st.label}{r.rev > 1 ? ` · rev ${r.rev}` : ""}</span>
                      {c.editable && r.pagu > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          <button type="button" title="Bagi rata pagu ke 4 triwulan" onClick={() => setRow(r.itemId, spreadQuarters(r.pagu))} className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50">÷TW</button>
                          <button type="button" title="Kosongkan baris" onClick={() => setRow(r.itemId, Array(4).fill(0))} className="rounded px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100">✕</button>
                        </div>
                      )}
                      {r.planId && r.mine && canEdit && (r.status === "draft" || r.status === "returned") && (
                        <form action={deleteCashPlanAction} className="mt-1" onSubmit={(e) => { if (!window.confirm("Hapus draf anggaran kas butir ini? Isian triwulan akan dikosongkan.")) e.preventDefault(); }}>
                          <input type="hidden" name="versionId" value={versionId} /><input type="hidden" name="planId" value={r.planId} />
                          <button className="text-[11px] font-medium text-red-700 underline">Hapus draf</button>
                        </form>
                      )}
                      {canFinalize && r.planId && r.status === "submitted" && (
                        <div className="mt-1 space-y-1">
                          <form action={cashStatusAction} onSubmit={(e) => { if (!window.confirm("Finalisasi anggaran kas ini?")) e.preventDefault(); }}>
                            <input type="hidden" name="versionId" value={versionId} /><input type="hidden" name="planId" value={r.planId} /><input type="hidden" name="to" value="final" />
                            <button className="rounded bg-navy-700 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-navy-800">Finalisasi</button>
                          </form>
                          <form action={cashStatusAction} className="flex gap-1">
                            <input type="hidden" name="versionId" value={versionId} /><input type="hidden" name="planId" value={r.planId} /><input type="hidden" name="to" value="returned" />
                            <input name="reason" required maxLength={300} placeholder="Alasan" aria-label="Alasan pengembalian" className="h-6 w-20 rounded border border-slate-300 px-1 text-[11px]" />
                            <button className="rounded border border-slate-300 px-1.5 text-[11px] text-slate-700 hover:bg-slate-50">Kembalikan</button>
                          </form>
                        </div>
                      )}
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
          <tfoot className="bg-slate-50 font-semibold">
            <tr className="border-t-2 border-slate-300">
              <td className="sticky left-0 bg-slate-50 px-3 py-2 text-[13px] text-navy-900">TOTAL ({calc.length} butir)</td>
              <td className="whitespace-nowrap px-1.5 py-2 text-right text-[13px] tabular-nums">{nf0.format(paguAll)}</td>
              {totals.map((t, i) => <td key={i} className="whitespace-nowrap px-1.5 py-2 text-right text-xs tabular-nums">{short(t)}</td>)}
              <td className="whitespace-nowrap px-1.5 py-2 text-right text-[13px] tabular-nums text-navy-900">{nf0.format(grand)}</td>
              <td className={`whitespace-nowrap px-1.5 py-2 text-right text-[13px] tabular-nums ${grand > paguAll ? "text-red-700" : "text-amber-700"}`}>{nf0.format(paguAll - grand)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
