import { computeTotals, parseItems, parsePpn, type DocItem } from "@/lib/document-items";
import { mapJenisPengadaan, mapMetodePemilihan } from "@/lib/rup-import-core";

export interface DocField {
  key: string; label: string; kind?: "text" | "textarea" | "date" | "select"; required?: boolean;
  options?: string[]; hint?: string; section?: string;
  /** "computed": dihitung server (tidak diisi manual); "editor": diisi di editor rincian barang/jasa. */
  render?: "computed" | "editor";
}
export interface DocType { label: string; creatorRoles: string[]; fields: DocField[]; hasItems?: boolean; basis?: string }
export type DocContent = Record<string, unknown> & { items?: DocItem[] };

const BASE: DocField[] = [
  { key: "nomor", label: "Nomor" },
  { key: "tanggal", label: "Tanggal", kind: "date" },
  { key: "perihal", label: "Perihal", required: true },
  { key: "isi", label: "Isi / uraian", kind: "textarea" },
  { key: "ppn_persen", label: "Tarif PPN (%)", render: "editor" },
  { key: "hps", label: "Perkiraan biaya (termasuk PPN)", render: "computed" },
  { key: "lampiran", label: "Lampiran", kind: "textarea" },
];

const JENIS_PENGADAAN = ["Barang", "Pekerjaan Konstruksi", "Jasa Konsultansi", "Jasa Lainnya"];
const CARA = ["Melalui Penyedia", "Swakelola"];
const METODE = ["E-purchasing (Katalog Elektronik)", "Pengadaan Langsung", "Penunjukan Langsung", "Tender Cepat", "Tender / Seleksi", "Swakelola"];
const JENIS_KONTRAK = ["Bukti pembelian / kuitansi", "Surat Pesanan (e-purchasing)", "Surat Perintah Kerja (SPK)", "Surat Perjanjian"];

/**
 * Dokumen Persiapan Pengadaan (DPP) untuk pengadaan melalui penyedia memuat penetapan spesifikasi teknis/KAK, Harga Perkiraan Sendiri (HPS),
 * rancangan kontrak, serta uang muka/jaminan/garansi/penyesuaian harga (Perpres 16/2018 jo. Perpres 12/2021 jo. Perpres 46/2025, bab persiapan
 * pengadaan melalui penyedia). Bidang di bawah mengikuti informasi minimal tersebut; templat resmi instansi dapat menggantikannya kemudian.
 */
export const DPP_BASIS = "Perpres 16/2018 sebagaimana diubah terakhir dengan Perpres 46/2025 (persiapan pengadaan melalui penyedia: spesifikasi teknis/KAK, HPS, rancangan kontrak, uang muka dan jaminan).";

export const DOC_TYPES: Record<string, DocType> = {
  nota_dinas_pptk: { label: "Nota Dinas PPTK", creatorRoles: ["pptk"], fields: BASE, hasItems: true },
  nota_dinas_ppk: { label: "Nota Dinas PPK", creatorRoles: ["ppk"], fields: BASE, hasItems: true },
  dpp: {
    label: "Dokumen Persiapan Pengadaan (DPP)", creatorRoles: ["pptk"], hasItems: true, basis: DPP_BASIS,
    fields: [
      { section: "A. Identitas paket pengadaan", key: "nomor", label: "Nomor dokumen" },
      { key: "tanggal", label: "Tanggal", kind: "date" },
      { key: "perihal", label: "Nama paket pengadaan", required: true },
      { key: "kode_rup", label: "Kode RUP (SiRUP)" },
      { key: "jenis_pengadaan", label: "Jenis pengadaan", kind: "select", options: JENIS_PENGADAAN },
      { key: "cara_pengadaan", label: "Cara pengadaan", kind: "select", options: CARA },
      { key: "metode_pemilihan", label: "Metode pemilihan", kind: "select", options: METODE, hint: "E-purchasing wajib bila barang/jasa tersedia di Katalog Elektronik." },
      { key: "sumber_dana", label: "Sumber dana", hint: "mis. APBD Kota Batu TA 2026" },
      { key: "lokasi", label: "Tempat penyerahan / lokasi pekerjaan" },
      { key: "waktu", label: "Jangka waktu pelaksanaan", hint: "mis. 14 (empat belas) hari kalender" },

      { section: "B. Spesifikasi teknis / Kerangka Acuan Kerja (KAK)", key: "latar_belakang", label: "Latar belakang, maksud, dan tujuan", kind: "textarea" },
      { key: "isi", label: "Uraian spesifikasi teknis / lingkup pekerjaan", kind: "textarea" },
      { key: "spek_mutu", label: "Mutu (merek, standar/SNI, komposisi, fungsi, kinerja)", kind: "textarea" },
      { key: "spek_layanan", label: "Tingkat layanan, purna jual, garansi, dan pemeliharaan", kind: "textarea" },
      { key: "pdn", label: "Produk dalam negeri (TKDN/BMP), UMK-K, dan produk ramah lingkungan", kind: "textarea" },

      { section: "C. Harga Perkiraan Sendiri (HPS)", key: "ppn_persen", label: "Tarif PPN (%)", render: "editor" },
      { key: "hps", label: "Total HPS (termasuk PPN)", render: "computed" },
      { key: "sumber_hps", label: "Sumber data dan cara penyusunan HPS", kind: "textarea", hint: "mis. harga Katalog Elektronik, toko daring, survei harga pasar setempat, harga kontrak sebelumnya." },

      { section: "D. Rancangan kontrak, uang muka, dan jaminan", key: "jenis_kontrak", label: "Bentuk kontrak", kind: "select", options: JENIS_KONTRAK },
      { key: "cara_bayar", label: "Cara pembayaran", hint: "mis. sekaligus setelah serah terima / termin" },
      { key: "uang_muka", label: "Uang muka dan jaminan uang muka" },
      { key: "jaminan", label: "Jaminan pelaksanaan, jaminan pemeliharaan, sertifikat garansi, penyesuaian harga", kind: "textarea" },
      { key: "lampiran", label: "Lampiran (spesifikasi/gambar, hasil survei harga, tangkapan layar katalog)", kind: "textarea" },
    ],
  },
  berita_acara_reviu: { label: "Berita Acara Reviu", creatorRoles: [], fields: BASE },
};

/** Membangun isi dokumen dari formulir. Rincian barang/jasa divalidasi dan total dihitung ULANG di server. */
export function parseDocContent(fd: FormData, type: string): { content: DocContent; errors: string[] } {
  const def = DOC_TYPES[type];
  const content: DocContent = {};
  const errors: string[] = [];
  for (const f of def?.fields ?? []) {
    if (f.render === "computed") continue;
    let v = String(fd.get(`f_${f.key}`) ?? "").trim().slice(0, f.kind === "textarea" ? 5000 : 300);
    if (f.kind === "select" && !(f.options ?? []).includes(v)) v = "";
    content[f.key] = v;
  }
  if (def?.hasItems) {
    const r = parseItems(String(fd.get("items_json") ?? ""));
    errors.push(...r.errors);
    const ppn = parsePpn(fd.get("f_ppn_persen"));
    const t = computeTotals(r.items, ppn);
    content.items = r.items;
    const rp = Number(String(fd.get("rup_pagu") ?? "").trim());
    content.rup_pagu = Number.isFinite(rp) && rp > 0 && rp < 1e13 ? String(rp) : "";
    content.ppn_persen = String(ppn);
    content.subtotal = String(t.subtotal);
    content.ppn = String(t.ppn);
    // Tanpa rincian: pertahankan HPS manual dari revisi lama (dokumen sebelum fitur rincian).
    content.hps = r.items.length ? String(t.total) : String(fd.get("hps_lama") ?? "").trim().slice(0, 300);
  }
  return { content, errors };
}

/** Kompatibel dengan pemanggil lama. */
export const contentFrom = (fd: FormData, type: string): DocContent => parseDocContent(fd, type).content;

/** Izin penyusun dokumen yang benar-benar ada di database (pemilik dokumen & RLS menjadi penentu akhir). */
export const DOC_AUTHOR_PERMISSIONS = ["document.create_pptk", "document.create_ppk"] as const;
export const canAuthorDocuments = (permissions: ReadonlySet<string>) => DOC_AUTHOR_PERMISSIONS.some((p) => permissions.has(p));

export interface RupSource {
  rup_code: string; package_name: string | null; pagu: number | string | null; jenis_pengadaan: string | null; metode_pemilihan: string | null;
  cara_pengadaan: string | null; sumber_dana: string | null; lokasi: string | null;
}
/** Isi awal DPP dari data RUP (SiRUP). Nilai yang tak dikenali dikosongkan (tidak ditebak); pengguna memeriksa dan menyesuaikan. */
export function contentFromRup(r: RupSource): DocContent {
  const swakelola = /swakelola/i.test(r.cara_pengadaan ?? "") || /swakelola/i.test(r.metode_pemilihan ?? "");
  const pagu = Number(r.pagu);
  return {
    kode_rup: r.rup_code, perihal: r.package_name ?? "",
    jenis_pengadaan: mapJenisPengadaan(r.jenis_pengadaan ?? ""), metode_pemilihan: mapMetodePemilihan(r.metode_pemilihan ?? ""),
    cara_pengadaan: swakelola ? "Swakelola" : "Melalui Penyedia",
    sumber_dana: r.sumber_dana ?? "", lokasi: r.lokasi ?? "", rup_pagu: Number.isFinite(pagu) && pagu > 0 ? String(pagu) : "",
  };
}
