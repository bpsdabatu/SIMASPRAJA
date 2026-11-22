import { Badge, Card, CardHeader } from "@/components/ui/card";
import { TableWrap } from "@/components/ui/page";
import { formatRupiah } from "@/lib/format";
import { TX_STATUS } from "@/lib/status";
import type { ItemBalance } from "@/lib/doc-balance";

const dateID = (d: string) => (/^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10).split("-").reverse().join("-") : d);

/** Realisasi yang sudah diakui (SP2D bertanggal) dan sisa anggaran butir ini, serta riwayat transaksinya (paket berulang). */
export function BalanceCard({ b }: { b: ItemBalance }) {
  const cell = (label: string, value: number, tone?: string, hint?: string) => (
    <div><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt><dd className={`mt-0.5 text-base font-semibold tabular-nums ${tone ?? "text-slate-900"}`}>{formatRupiah(value)}</dd>{hint && <p className="text-[11px] text-slate-500">{hint}</p>}</div>
  );
  const kali = b.history.length;
  return (
    <Card>
      <CardHeader title="Realisasi dan sisa anggaran butir ini" description={kali > 0 ? `Butir ini sudah memiliki ${kali} transaksi pada Input Realisasi (paket berulang). Hanya yang ber-SP2D bertanggal diakui sebagai realisasi.` : "Belum ada transaksi realisasi pada butir ini."} />
      <dl className="grid gap-4 p-5 sm:grid-cols-3 lg:grid-cols-6">
        {cell("Pagu", b.pagu)}
        {cell("Realisasi diakui", b.diakui, undefined, "SP2D bertanggal")}
        {cell("Menunggu SP2D", b.pending, undefined, "sudah dibayar/diproses")}
        {cell("Komitmen kontrak", b.komitmen)}
        {cell("Sisa anggaran", b.sisa, b.sisa < 0 ? "text-red-700" : "text-emerald-700", "pagu − diakui")}
        {cell("Sisa tersedia", b.tersedia, b.tersedia < 0 ? "text-red-700" : "text-emerald-700", "setelah menunggu SP2D")}
      </dl>
      {b.history.length > 0 && (
        <TableWrap>
          <table className="table-base">
            <thead><tr><th>Tanggal</th><th>Uraian</th><th>Penyedia</th><th>Status</th><th className="text-right">Nilai</th><th className="text-right">Diakui</th><th>SP2D</th></tr></thead>
            <tbody>
              {b.history.map((t) => {
                const st = TX_STATUS[t.status] ?? { label: t.status, tone: "slate" as const };
                return (
                  <tr key={t.id}>
                    <td className="whitespace-nowrap">{dateID(t.date)}</td><td className="max-w-xs text-[13px]">{t.description}</td><td className="text-[13px]">{t.supplier ?? "—"}</td>
                    <td><Badge tone={st.tone}>{st.label}</Badge></td>
                    <td className="text-right tabular-nums">{formatRupiah(t.total)}</td>
                    <td className={`text-right tabular-nums ${t.diakui > 0 ? "font-medium text-emerald-700" : "text-slate-400"}`}>{t.diakui > 0 ? formatRupiah(t.diakui) : "—"}</td>
                    <td className="text-[13px]">{t.sp2d.length ? t.sp2d.map((s) => `${s.number || "—"}${s.date ? ` (${dateID(s.date)})` : " (belum bertanggal)"}`).join("; ") : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}
