export interface DocField { key: string; label: string; kind?: "text" | "textarea" | "date"; required?: boolean }
export interface DocType { label: string; creatorRoles: string[]; fields: DocField[] }

const BASE: DocField[] = [
  { key: "nomor", label: "Nomor" },
  { key: "tanggal", label: "Tanggal", kind: "date" },
  { key: "perihal", label: "Perihal", required: true },
  { key: "isi", label: "Isi / uraian", kind: "textarea" },
  { key: "lampiran", label: "Lampiran", kind: "textarea" },
];

/** Bidang dokumen sementara; templat resmi akan disesuaikan setelah berkas dari instansi diterima. */
export const DOC_TYPES: Record<string, DocType> = {
  nota_dinas_pptk: { label: "Nota Dinas PPTK", creatorRoles: ["pptk"], fields: BASE },
  nota_dinas_ppk: { label: "Nota Dinas PPK", creatorRoles: ["ppk"], fields: BASE },
  dpp: {
    label: "Dokumen Persiapan Pengadaan (DPP)", creatorRoles: ["pptk"],
    fields: [
      { key: "nomor", label: "Nomor" }, { key: "tanggal", label: "Tanggal", kind: "date" },
      { key: "perihal", label: "Nama paket pengadaan", required: true },
      { key: "hps", label: "Harga Perkiraan Sendiri (Rp)" },
      { key: "waktu", label: "Waktu pelaksanaan" },
      { key: "isi", label: "Spesifikasi / uraian kebutuhan", kind: "textarea" },
      { key: "lampiran", label: "Lampiran", kind: "textarea" },
    ],
  },
  berita_acara_reviu: { label: "Berita Acara Reviu", creatorRoles: [], fields: BASE },
};

export function contentFrom(fd: FormData, type: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of DOC_TYPES[type]?.fields ?? []) out[f.key] = String(fd.get(`f_${f.key}`) ?? "").trim().slice(0, f.kind === "textarea" ? 5000 : 300);
  return out;
}

/** Izin penyusun dokumen yang benar-benar ada di database (pemilik dokumen & RLS menjadi penentu akhir). */
export const DOC_AUTHOR_PERMISSIONS = ["document.create_pptk", "document.create_ppk"] as const;
export const canAuthorDocuments = (permissions: ReadonlySet<string>) => DOC_AUTHOR_PERMISSIONS.some((p) => permissions.has(p));
