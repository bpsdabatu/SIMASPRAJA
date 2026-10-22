/** Ditampilkan seketika saat berpindah menu (sementara server menyiapkan halaman), sehingga aplikasi terasa langsung responsif. */
export default function Loading() {
  const bar = "rounded-lg bg-slate-200/80";
  return (
    <div className="mx-auto max-w-7xl space-y-5" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Memuat halaman…</span>
      <div className="space-y-2">
        <div className={`h-3 w-32 ${bar} animate-pulse`} />
        <div className={`h-8 w-64 ${bar} animate-pulse`} />
        <div className={`h-3 w-96 max-w-full ${bar} animate-pulse`} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
            <div className={`h-3 w-20 ${bar} animate-pulse`} />
            <div className={`mt-3 h-6 w-36 ${bar} animate-pulse`} style={{ animationDelay: `${i * 0.1}s` }} />
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
        <div className="border-b border-slate-100 p-4"><div className={`h-4 w-48 ${bar} animate-pulse`} /></div>
        <div className="space-y-3 p-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex gap-4">
              <div className={`h-4 w-24 ${bar} animate-pulse`} style={{ animationDelay: `${i * 0.08}s` }} />
              <div className={`h-4 flex-1 ${bar} animate-pulse`} style={{ animationDelay: `${i * 0.08}s` }} />
              <div className={`h-4 w-28 ${bar} animate-pulse`} style={{ animationDelay: `${i * 0.08}s` }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
