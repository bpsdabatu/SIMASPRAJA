"use client";

import { useActionState } from "react";
import { CheckCircle2, Loader2, Upload } from "lucide-react";
import { Alert } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { importRupAction, type RupImportState } from "./rup-actions";

/** Unggah data RUP dari SiRUP (Excel/CSV) agar penyusunan dokumen tinggal mencari Kode RUP / nama paket. */
export function RupImportPanel({ year, count, lastImport }: { year: number; count: number; lastImport: string | null }) {
  const [res, action, pending] = useActionState<RupImportState, FormData>(importRupAction, {});
  return (
    <form action={action} className="space-y-3 p-5">
      <p className="text-sm text-slate-600">
        Data RUP tahun anggaran <strong>{year}</strong>: <strong>{count.toLocaleString("id-ID")}</strong> paket{lastImport ? ` (unggahan terakhir ${lastImport})` : ""}.
        Unggah hasil unduhan/ekspor daftar paket penyedia dari SiRUP (.xlsx atau .csv). Kolom dikenali dari judulnya: <em>Kode RUP, Nama Paket, Pagu, Metode Pemilihan, Jenis Pengadaan, Sumber Dana, Lokasi, Satuan Kerja, Waktu Pemilihan/Pekerjaan</em> (hanya Kode RUP dan Nama Paket yang wajib).
        Unggahan hanya menambah atau memperbarui per Kode RUP; tidak ada data yang dihapus.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Input type="file" name="file" accept=".xlsx,.csv,.txt" required className="max-w-sm" aria-label="Berkas RUP SiRUP" />
        <Button type="submit" variant="primary" disabled={pending}>{pending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Upload size={16} aria-hidden />} Unggah RUP</Button>
      </div>
      {res.phase === "error" && <Alert tone="red">{res.error}</Alert>}
      {res.phase === "done" && (
        <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <p className="flex items-center gap-2 font-semibold"><CheckCircle2 size={16} aria-hidden /> {res.total?.toLocaleString("id-ID")} paket diproses: {res.added?.toLocaleString("id-ID")} baru, {res.updated?.toLocaleString("id-ID")} diperbarui.</p>
          <p className="mt-1 text-xs">{res.withPagu?.toLocaleString("id-ID")} paket memiliki pagu.{res.skipped ? ` ${res.skipped} baris dilewati (tanpa Kode RUP/Nama Paket).` : ""}{res.duplicates ? ` ${res.duplicates} Kode RUP ganda pada berkas (dipakai yang terakhir).` : ""}{res.ignoredColumns?.length ? ` Kolom tidak dipakai: ${res.ignoredColumns.join(", ")}.` : ""}</p>
        </div>
      )}
    </form>
  );
}
