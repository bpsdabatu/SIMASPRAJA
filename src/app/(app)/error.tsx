"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

/** Penangan galat tak terduga pada halaman aplikasi: pesan jelas + coba lagi, bukan halaman galat generik. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("[halaman]", error.digest ?? "", error.message); }, [error]);
  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-red-200 bg-red-50 p-6 text-center shadow-card" role="alert">
      <AlertTriangle className="mx-auto text-red-600" size={32} aria-hidden />
      <h1 className="mt-3 font-display text-lg font-bold text-red-900">Halaman belum dapat dimuat</h1>
      <p className="mt-2 text-sm text-red-900/90">Terjadi kendala saat menyiapkan halaman ini. Data Anda tidak berubah. Coba lagi; bila berulang, kemungkinan koneksi ke basis data terputus, migrasi SQL terbaru belum dijalankan, atau konfigurasi server belum lengkap.</p>
      {error.digest && <p className="mt-2 text-xs text-red-800/80">Kode bantuan: <span className="font-mono">{error.digest}</span> (sebutkan ke administrator)</p>}
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={reset} className="inline-flex h-10 items-center gap-2 rounded-lg bg-navy-700 px-4 text-sm font-semibold text-white hover:bg-navy-800"><RotateCw size={15} aria-hidden /> Coba lagi</button>
        <Link href="/dashboard" className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">Ke Dasbor</Link>
      </div>
    </div>
  );
}
