import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <p className="font-display text-5xl font-bold text-navy-700">404</p>
      <h1 className="mt-2 text-lg font-semibold text-slate-900">Halaman tidak ditemukan</h1>
      <p className="mt-1 text-sm text-slate-600">Alamat yang Anda buka tidak ada atau sudah dipindahkan.</p>
      <Link href="/dashboard" className="mt-4 inline-flex h-10 items-center rounded-lg bg-navy-700 px-4 text-sm font-semibold text-white hover:bg-navy-800">Ke Dasbor</Link>
    </main>
  );
}
