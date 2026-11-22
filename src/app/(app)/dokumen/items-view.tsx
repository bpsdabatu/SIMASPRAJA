import { computeTotals, parsePpn, REF_KINDS, safeHttpUrl, type DocItem, type Limit } from "@/lib/document-items";
import { formatRupiah } from "@/lib/format";
import { TableWrap } from "@/components/ui/page";

const dateID = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split("-").reverse().join("-") : d || "—");

/** Tampilan baca/cetak: rincian barang/jasa, total HPS, dan tabel referensi harga (tautan dapat diklik; URL tercetak saat dicetak). */
export function ItemsView({ items, ppnPersen, limits }: { items: DocItem[]; ppnPersen: unknown; limits: Limit[] }) {
  if (items.length === 0) return <p className="px-5 py-4 text-sm text-slate-500">Belum ada rincian barang/jasa.</p>;
  const t = computeTotals(items, parsePpn(ppnPersen));
  const withRef = items.map((it, i) => ({ it, i })).filter(({ it }) => it.refUrl || it.refHarga !== null || it.refCatatan || it.refTanggal);
  return (
    <div className="space-y-5 p-5">
      <TableWrap>
        <table className="table-base">
          <thead><tr><th>No</th><th>Barang/Jasa</th><th>Spesifikasi</th><th className="text-right">Volume</th><th>Satuan</th><th className="text-right">Harga satuan</th><th className="text-right">Jumlah</th></tr></thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}><td>{i + 1}</td><td className="font-medium">{it.nama}</td><td className="text-[13px] text-slate-600">{it.spesifikasi || "—"}</td><td className="text-right tabular-nums">{it.volume.toLocaleString("id-ID")}</td><td>{it.satuan}</td><td className="text-right tabular-nums">{formatRupiah(it.harga)}</td><td className="text-right tabular-nums">{formatRupiah(it.jumlah)}</td></tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={6} className="text-right text-sm">Subtotal</td><td className="text-right tabular-nums">{formatRupiah(t.subtotal)}</td></tr>
            <tr><td colSpan={6} className="text-right text-sm">PPN {t.ppnPersen}%</td><td className="text-right tabular-nums">{formatRupiah(t.ppn)}</td></tr>
            <tr className="font-semibold"><td colSpan={6} className="text-right">Total HPS (termasuk PPN)</td><td className="text-right tabular-nums">{formatRupiah(t.total)}</td></tr>
            {limits.map((l) => <tr key={l.label} className={t.total > l.value ? "text-red-700" : "text-slate-500"}><td colSpan={6} className="text-right text-xs">{l.label}{t.total > l.value ? " — HPS MELEBIHI" : ""}</td><td className="text-right text-xs tabular-nums">{formatRupiah(l.value)}</td></tr>)}
          </tfoot>
        </table>
      </TableWrap>

      {withRef.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-navy-800">Referensi harga</h3>
          <TableWrap>
            <table className="table-base">
              <thead><tr><th>No</th><th>Barang/Jasa</th><th>Sumber</th><th>Tautan</th><th>Tanggal akses</th><th className="text-right">Harga referensi</th><th>Catatan</th></tr></thead>
              <tbody>
                {withRef.map(({ it, i }) => {
                  const u = it.refUrl ? safeHttpUrl(it.refUrl) : null;
                  return (
                    <tr key={i}>
                      <td>{i + 1}</td><td>{it.nama}</td><td className="whitespace-nowrap">{REF_KINDS[it.refKind]}</td>
                      <td className="max-w-[18rem] break-all text-[13px]">{u ? <a href={u.toString()} target="_blank" rel="noopener noreferrer" className="text-navy-700 underline">{u.hostname}{u.pathname.length > 1 ? "/…" : ""}<span className="hidden print:inline"> ({u.toString()})</span></a> : "—"}</td>
                      <td className="whitespace-nowrap">{dateID(it.refTanggal)}</td>
                      <td className="text-right tabular-nums">{it.refHarga !== null ? formatRupiah(it.refHarga) : "—"}</td>
                      <td className="text-[13px] text-slate-600">{it.refCatatan || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        </div>
      )}
    </div>
  );
}
