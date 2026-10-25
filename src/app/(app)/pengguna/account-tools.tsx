"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Copy, Eye, EyeOff, Loader2, ShieldCheck, Wand2, XCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { diagnoseAccountsAction, type DiagnoseState } from "./actions";

/** Kolom kata sandi sementara dengan tombol "Buat acak" (memenuhi kebijakan: huruf besar, kecil, angka, simbol; dibuat di browser). */
export function PasswordInput({ id, name = "password", required = true }: { id: string; name?: string; required?: boolean }) {
  const [v, setV] = useState("");
  const gen = () => {
    const U = "ABCDEFGHJKLMNPQRSTUVWXYZ", L = "abcdefghijkmnopqrstuvwxyz", D = "23456789", S = "!@#$%*?-_";
    const rnd = (n: number) => { const a = new Uint32Array(1); let x: number; do { crypto.getRandomValues(a); x = a[0]!; } while (x >= Math.floor(4294967296 / n) * n); return x % n; };
    const pick = (s: string) => s[rnd(s.length)]!;
    const chars = [pick(U), pick(U), pick(L), pick(L), pick(L), pick(D), pick(D), pick(S), ...Array.from({ length: 6 }, () => pick(U + L + D))];
    for (let i = chars.length - 1; i > 0; i--) { const j = rnd(i + 1); [chars[i], chars[j]] = [chars[j]!, chars[i]!]; }
    setV(chars.join(""));
  };
  return (
    <div className="flex gap-2">
      <Input id={id} name={name} type="text" required={required} minLength={required ? 10 : undefined} maxLength={128} autoComplete="off" spellCheck={false} value={v} onChange={(e) => setV(e.target.value)} />
      <button type="button" onClick={gen} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-navy-300 bg-white px-3 text-sm font-semibold text-navy-800 hover:bg-navy-50"><Wand2 size={14} aria-hidden /> Buat acak</button>
    </div>
  );
}

/** Uji kesiapan pembuatan akun (variabel server, kunci service_role, tabel, dan akun uji yang langsung dihapus). */
export function AccountDiagnostics() {
  const [state, action, pending] = useActionState<DiagnoseState, FormData>(async (prev) => diagnoseAccountsAction(prev), {});
  return (
    <div className="space-y-3 border-t border-slate-100 p-5">
      <p className="text-sm text-slate-600">Jika “Tambah pengguna” gagal, klik tombol ini untuk melihat penyebabnya (konfigurasi server, kunci Supabase, atau tabel). Pengujian membuat lalu langsung menghapus satu akun uji; tidak ada data tersisa.</p>
      <form action={action}>
        <button type="submit" disabled={pending} className="inline-flex h-10 items-center gap-2 rounded-lg border border-navy-300 bg-white px-4 text-sm font-semibold text-navy-800 hover:bg-navy-50 disabled:opacity-60">
          {pending ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <ShieldCheck size={15} aria-hidden />} Periksa kesiapan akun
        </button>
      </form>
      {state.results && (
        <ul className="space-y-2">
          {state.results.map((r) => (
            <li key={r.label} className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${r.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"}`}>
              {r.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden /> : <XCircle size={16} className="mt-0.5 shrink-0" aria-hidden />}
              <span><span className="font-semibold">{r.label}.</span> {r.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Kata sandi sementara: disembunyikan, dapat ditampilkan dan disalin oleh admin. */
export function SecretCell({ value }: { value: string }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard tidak tersedia */ } };
  return (
    <span className="inline-flex items-center gap-1.5">
      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px] tracking-wide">{show ? value : "••••••••••"}</code>
      <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"} className="rounded p-1 text-slate-500 hover:bg-slate-100">{show ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}</button>
      <button type="button" onClick={copy} aria-label="Salin kata sandi" className="rounded p-1 text-slate-500 hover:bg-slate-100"><Copy size={14} aria-hidden /></button>
      {copied && <span className="text-[11px] font-medium text-emerald-700">Tersalin</span>}
    </span>
  );
}
