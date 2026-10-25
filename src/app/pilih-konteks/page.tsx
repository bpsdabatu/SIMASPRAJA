import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CalendarRange } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { userClient } from "@/lib/supabase/server";
import { Card, Alert } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Flash } from "@/components/ui/page";
import { SubmitButton } from "@/components/ui/submit-button";
import { Logo } from "@/components/brand/logo";
import { createContextAction, logoutAction } from "@/app/actions";
import { ContextForm, type ContextOption } from "./context-form";

export const metadata: Metadata = { title: "Pilih Konteks Anggaran" };

export default async function PilihKonteksPage({ searchParams }: { searchParams: Promise<{ info?: string; ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  if (user.mustChangePassword) redirect("/ganti-password");

  const canCreate = user.permissions.has("budget.edit");
  const supabase = await userClient();
  const { data } = await supabase.rpc("list_budget_contexts");
  const options: ContextOption[] = (data ?? []).map(
    (r: { fiscal_year: number; stage_code: string; stage_name: string; status: string }) => ({
      year: r.fiscal_year,
      stage: r.stage_code,
      stageName: r.stage_name,
      status: r.status,
    }),
  );

  return (
    <main className="bg-hero flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-5 flex justify-center"><div className="rounded-xl bg-white px-4 py-2 shadow-lift"><Logo variant="mark" size={44} /></div></div>
        <Card className="p-6 sm:p-8">
          <div className="mb-6 flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gold-50 text-gold-700">
              <CalendarRange size={20} aria-hidden />
            </span>
            <div>
              <h1 className="text-xl font-bold text-navy-900">Pilih konteks anggaran</h1>
              <p className="mt-1 text-sm text-slate-600">
                Halo, {user.fullName}. Seluruh modul, laporan, grafik, dan formulir akan memakai tahun dan tahapan yang Anda pilih.
              </p>
            </div>
          </div>

          <Flash ok={sp.ok} err={sp.err} />
          {sp.info === "konteks" && (
            <Alert tone="amber">
              Tahun/tahapan anggaran yang Anda pilih saat masuk belum tersedia. Pilih yang tersedia di bawah ini{canCreate ? ", atau buat yang baru" : "; bila kosong, minta administrator membuatnya"}.
            </Alert>
          )}
          {options.length === 0 ? (
            <Alert tone="amber">
              Belum ada versi anggaran yang tersedia untuk Anda. Hubungi administrator untuk membuat atau mengaktifkan
              versi anggaran.
            </Alert>
          ) : (
            <ContextForm options={options} />
          )}

          {canCreate && (
            <details className="mt-5 rounded-lg border border-slate-200 bg-slate-50" open={options.length === 0}>
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-navy-800 [&::-webkit-details-marker]:hidden">+ Buat tahun &amp; tahapan anggaran (Admin)</summary>
              <form action={createContextAction} className="grid gap-3 border-t border-slate-200 p-4 sm:grid-cols-2">
                <Field label="Tahun anggaran" htmlFor="new-year"><Input id="new-year" name="year" type="number" min={2000} max={2100} defaultValue={new Date().getFullYear()} required /></Field>
                <Field label="Tahapan" htmlFor="new-stage">
                  <select id="new-stage" name="stage" required className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm">
                    <option value="murni">Murni</option><option value="pergeseran">Pergeseran</option><option value="perubahan">Perubahan</option>
                  </select>
                </Field>
                <p className="text-xs text-slate-500 sm:col-span-2">Dibuat sebagai versi draf dan langsung dibuka. Bila kombinasi sudah ada, hanya dibuka. Aktifkan versinya di menu Input Anggaran agar dapat dipakai pengguna lain.</p>
                <div className="sm:col-span-2"><SubmitButton pendingText="Membuat...">Buat dan buka</SubmitButton></div>
              </form>
            </details>
          )}

          <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4 text-sm">
            <Link href="/dashboard" className="inline-flex items-center gap-1 text-slate-500 hover:text-navy-700"><ArrowLeft size={14} aria-hidden /> Kembali</Link>
            <form action={logoutAction}>
              <button className="text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline">Keluar</button>
            </form>
          </div>
        </Card>
      </div>
    </main>
  );
}
