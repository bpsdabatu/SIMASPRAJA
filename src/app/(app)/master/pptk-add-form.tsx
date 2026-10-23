"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { addPptkAction, type PptkImportState } from "./pptk-actions";

/** Tambah satu PPTK. Akun yang sama muncul di Pengguna & Peran; kata sandi sementara acak hanya tampil sekali. */
export function PptkAddForm() {
  const [state, action] = useActionState<PptkImportState, FormData>(addPptkAction, {});
  const c = state.created?.[0];
  return (
    <div className="space-y-3">
      <form action={action} key={c?.username ?? "form"} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Username" htmlFor="ap-username" hint="Huruf kecil/angka/titik (3–32)."><Input id="ap-username" name="username" required maxLength={32} autoCapitalize="none" spellCheck={false} placeholder="nama.belakang" /></Field>
        <Field label="Nama lengkap (dengan gelar)" htmlFor="ap-name"><Input id="ap-name" name="fullName" required maxLength={150} /></Field>
        <Field label="NIP" htmlFor="ap-nip"><Input id="ap-nip" name="nip" maxLength={30} inputMode="numeric" /></Field>
        <Field label="Jabatan" htmlFor="ap-pos"><Input id="ap-pos" name="position" maxLength={150} /></Field>
        <div className="sm:col-span-2 lg:col-span-4"><SubmitButton pendingText="Membuat...">Tambah PPTK</SubmitButton></div>
      </form>
      {state.error && <Alert>{state.error}</Alert>}
      {c && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-semibold">PPTK @{c.username} dibuat dan sudah tampil di daftar PPTK serta Pengguna &amp; Peran.</p>
          <p className="mt-1">Kata sandi sementara (hanya tampil sekali): <span className="select-all rounded bg-white px-2 py-0.5 font-mono font-semibold">{c.password}</span></p>
          <p className="mt-1 text-xs">Sampaikan melalui jalur aman; wajib diganti saat masuk pertama.</p>
        </div>
      )}
    </div>
  );
}
