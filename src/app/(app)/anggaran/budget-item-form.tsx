"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import type { BudgetTree } from "@/lib/lookups";
import { addItemAction } from "./actions";

/**
 * Formulir tambah butir anggaran bertingkat. Pilihan disaring berjenjang (Program → Kegiatan → Sub Kegiatan) dan rekening
 * belanja dapat dicari berdasarkan kode/nama. Yang dikirim tetap ID master yang sama dengan formulir lama (addItemAction),
 * sehingga validasi, RLS, dan pelindung database tidak berubah.
 */
export function BudgetItemForm({ versionId, tree }: { versionId: string; tree: BudgetTree }) {
  const [program, setProgram] = useState("");
  const [activity, setActivity] = useState("");
  const [sub, setSub] = useState("");
  const [account, setAccount] = useState("");
  const [acctQ, setAcctQ] = useState("");

  const activities = useMemo(() => tree.activities.filter((a) => !program || a.programId === program), [tree, program]);
  const subs = useMemo(() => tree.subs.filter((s) => (activity ? s.activityId === activity : !program || activities.some((a) => a.id === s.activityId))), [tree, activity, program, activities]);
  const needle = acctQ.trim().toLowerCase();
  const accounts = useMemo(
    () => tree.accounts.filter((a) => !needle || `${a.code} ${a.name}`.toLowerCase().includes(needle) || a.id === account).slice(0, 300),
    [tree, needle, account],
  );

  const chosenSub = tree.subs.find((s) => s.id === sub);
  const chosenAct = tree.activities.find((a) => a.id === (chosenSub?.activityId ?? activity));
  const chosenProg = tree.programs.find((p) => p.id === (chosenAct?.programId ?? program));
  const chosenAcct = tree.accounts.find((a) => a.id === account);

  const pickProgram = (v: string) => { setProgram(v); setActivity(""); setSub(""); };
  const pickActivity = (v: string) => {
    setActivity(v); setSub("");
    const a = tree.activities.find((x) => x.id === v);
    if (a && !program) setProgram(a.programId);
  };
  const pickSub = (v: string) => {
    setSub(v);
    const s = tree.subs.find((x) => x.id === v);
    const a = s && tree.activities.find((x) => x.id === s.activityId);
    if (s) setActivity(s.activityId);
    if (a) setProgram(a.programId);
  };

  const empty = tree.subs.length === 0 || tree.accounts.length === 0 || tree.funding.length === 0;

  return (
    <form action={addItemAction} className="grid gap-4 border-t border-slate-100 p-5 sm:grid-cols-2">
      <input type="hidden" name="versionId" value={versionId} />

      <Field label="1. Program" htmlFor="bi-program">
        <Select id="bi-program" value={program} onChange={(e) => pickProgram(e.target.value)}>
          <option value="">Semua program ({tree.programs.length})</option>
          {tree.programs.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
        </Select>
      </Field>
      <Field label="2. Kegiatan" htmlFor="bi-activity">
        <Select id="bi-activity" value={activity} onChange={(e) => pickActivity(e.target.value)}>
          <option value="">Semua kegiatan ({activities.length})</option>
          {activities.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
        </Select>
      </Field>
      <Field label="3. Sub kegiatan" htmlFor="bi-sub" className="sm:col-span-2">
        <Select id="bi-sub" name="subActivity" required value={sub} onChange={(e) => pickSub(e.target.value)}>
          <option value="" disabled>Pilih sub kegiatan ({subs.length} tersedia)</option>
          {subs.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
        </Select>
      </Field>

      {chosenSub && (
        <p className="animate-fade-up flex flex-wrap items-center gap-1 rounded-lg bg-navy-50 px-3 py-2 text-xs text-navy-800 sm:col-span-2">
          <span className="font-semibold">{chosenProg?.code}</span><ChevronRight size={12} aria-hidden />
          <span className="font-semibold">{chosenAct?.code}</span><ChevronRight size={12} aria-hidden />
          <span className="font-semibold">{chosenSub.code}</span>
          <span className="text-navy-700">· {chosenSub.name}</span>
        </p>
      )}

      <Field label="4. Rekening belanja (kode rekening)" htmlFor="bi-account" className="sm:col-span-2" hint={chosenAcct ? `Terpilih: ${chosenAcct.code} — ${chosenAcct.name}` : `${tree.accounts.length} rekening tersedia. Ketik untuk menyaring kode atau nama.`}>
        <div className="relative mb-2">
          <Search size={14} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input value={acctQ} onChange={(e) => setAcctQ(e.target.value)} placeholder="Cari kode atau nama rekening…" aria-label="Cari rekening belanja" className="pl-8" />
        </div>
        <Select id="bi-account" name="account" required value={account} onChange={(e) => setAccount(e.target.value)}>
          <option value="" disabled>{accounts.length === 0 ? "Tidak ada rekening yang cocok" : `Pilih rekening (${accounts.length}${accounts.length === 300 ? "+" : ""} ditampilkan)`}</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
        </Select>
      </Field>

      <Field label="5. Sumber dana" htmlFor="bi-funding">
        <Select id="bi-funding" name="funding" required defaultValue="">
          <option value="" disabled>Pilih sumber dana</option>
          {tree.funding.map((f) => <option key={f.id} value={f.id}>{f.name}{f.code && f.code !== f.name ? ` (${f.code})` : ""}</option>)}
        </Select>
      </Field>
      <Field label="6. PPTK penanggung jawab" htmlFor="bi-pptk" hint={tree.pptk.length === 0 ? "Belum ada akun PPTK. Buat di Data Master › PPTK." : undefined}>
        <Select id="bi-pptk" name="pptk" defaultValue="">
          <option value="">— Belum ditugaskan —</option>
          {tree.pptk.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </Select>
      </Field>

      <Field label="Uraian (opsional)" htmlFor="bi-desc" className="sm:col-span-2"><Textarea id="bi-desc" name="description" maxLength={500} rows={2} /></Field>
      <Field label="Pagu (Rp)" htmlFor="bi-pagu"><Input id="bi-pagu" name="pagu" type="number" min={0} step="0.01" required inputMode="decimal" /></Field>
      <div className="flex items-end"><SubmitButton pendingText="Menyimpan..." disabled={empty}>Simpan butir</SubmitButton></div>
      {empty && (
        <p className="text-sm text-amber-700 sm:col-span-2">Lengkapi dulu <Link href="/master" className="font-semibold underline">Data Master</Link> (sub kegiatan, rekening, dan sumber dana) — di sana tersedia tombol “Muat data bawaan”.</p>
      )}
    </form>
  );
}
