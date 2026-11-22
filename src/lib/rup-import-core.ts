import { normHeader } from "@/lib/header";

/**
 * Pembaca berkas unduhan/ekspor RUP dari SiRUP (Excel/CSV). Murni (tanpa akses database) agar dapat diuji.
 * Kolom dikenali dari JUDUL (urutan bebas, alias beragam karena tampilan SiRUP berbeda per jenis daftar/tahun):
 *   Kode RUP / ID · Nama Paket / Paket · Pagu (Rp.) · Metode Pemilihan · Jenis Pengadaan · Penyedia/Swakelola · Sumber Dana ·
 *   Lokasi · Satuan Kerja · Nama Kegiatan · Waktu/Awal Pemilihan · Waktu/Awal Pekerjaan.
 * Hanya Kode RUP dan Nama Paket yang wajib.
 */
export interface RupRow {
  code: string; name: string; pagu: number | null; jenis: string; metode: string; cara: string; sumber: string;
  lokasi: string; satker: string; kegiatan: string; waktuPemilihan: string; waktuPekerjaan: string;
}
type Key = keyof RupRow;

const ALIASES: Record<Key, string[]> = {
  code: ["kode_rup", "id_rup", "kode_paket", "kode", "id", "rup"],
  name: ["nama_paket", "nama_paket_pekerjaan", "nama_pekerjaan", "paket", "nama"],
  pagu: ["pagu_rp", "pagu_rup", "pagu_paket", "total_pagu", "nilai_pagu", "pagu"],
  jenis: ["jenis_pengadaan", "jenis"],
  metode: ["metode_pemilihan_penyedia", "metode_pemilihan", "metode_pengadaan", "metode"],
  cara: ["penyedia_swakelola", "penyedia_atau_swakelola", "cara_pengadaan"],
  sumber: ["sumber_dana", "sumber"],
  lokasi: ["lokasi_pekerjaan", "lokasi"],
  satker: ["satuan_kerja", "nama_satker", "satker"],
  kegiatan: ["nama_sub_kegiatan", "sub_kegiatan", "nama_kegiatan", "kegiatan"],
  waktuPemilihan: ["waktu_pemilihan", "awal_pemilihan", "jadwal_pemilihan", "tanggal_awal_pemilihan"],
  waktuPekerjaan: ["waktu_pekerjaan", "awal_pekerjaan", "jadwal_pelaksanaan", "pelaksanaan_pekerjaan"],
};

export const MAX_RUP_ROWS = 5000;

/** "4.587.000.000", "223,865,000", "1.234,56", "Rp 15.159.400", "15159400.5" -> angka; tak valid -> null. */
export function parseMoney(raw: string): number | null {
  let s = String(raw ?? "").replace(/rp\.?/gi, "").replace(/\s+/g, "").trim();
  if (!s || !/\d/.test(s)) return null;
  const dot = s.lastIndexOf("."), com = s.lastIndexOf(",");
  if (dot >= 0 && com >= 0) {
    const decSep = dot > com ? "." : ",";
    s = s.split(decSep === "." ? "," : ".").join("").replace(decSep, ".");
  } else if (dot >= 0 || com >= 0) {
    const sep = dot >= 0 ? "." : ",";
    const parts = s.split(sep);
    // ribuan bila semua kelompok setelah pemisah pertama bertiga digit (mis. 4.587.000.000 / 223,865,000)
    s = parts.length > 2 || (parts.length === 2 && /^\d{3}$/.test(parts[1]!) && parts[0]!.length <= 3 && parts[0] !== "0") ? parts.join("") : parts.join(".");
  }
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n < 1e13 ? Math.round(n * 100) / 100 : null;
}

/** Kode RUP: biasanya 5–10 digit. Angka dari Excel ("60696228.0", "6.0696228E7") dinormalkan. */
export function normalizeRupCode(raw: string): string | null {
  const s = String(raw ?? "").trim().replace(/\s+/g, "");
  if (!s) return null;
  if (/^\d+(\.0+)?$/.test(s)) return s.replace(/\.0+$/, "");
  if (/^\d(\.\d+)?e\+?\d+$/i.test(s)) { const n = Number(s); return Number.isFinite(n) ? String(Math.round(n)) : null; }
  return /^[A-Za-z0-9._\-/]{3,60}$/.test(s) ? s : null;
}

export type RupParse =
  | { ok: true; rows: RupRow[]; skipped: number; duplicates: number; foundColumns: Key[]; ignoredColumns: string[] }
  | { ok: false; error: string };

export function parseRupTable(table: string[][]): RupParse {
  if (table.length === 0) return { ok: false, error: "Berkas kosong." };
  // cari baris judul pada 25 baris pertama (judul laporan/filter SiRUP sering berada di atas tabel)
  let headerAt = -1; let map = new Map<Key, number>();
  for (let r = 0; r < Math.min(25, table.length); r++) {
    const heads = table[r]!.map((c) => normHeader(String(c)));
    const m = new Map<Key, number>();
    (Object.keys(ALIASES) as Key[]).forEach((k) => {
      for (const a of ALIASES[k]) { const i = heads.indexOf(a); if (i >= 0) { m.set(k, i); break; } }
    });
    if (m.has("code") && m.has("name")) { headerAt = r; map = m; break; }
  }
  if (headerAt < 0) return { ok: false, error: "Judul kolom tidak dikenali. Pastikan ada kolom “Kode RUP” dan “Nama Paket” (contoh: unduhan/ekspor daftar paket penyedia dari SiRUP)." };

  const used = new Set(map.values());
  const ignoredColumns = table[headerAt]!.filter((c, i) => c.trim() && !used.has(i) && !/^(no|nomor)$/i.test(c.trim())).map((c) => c.trim()).slice(0, 12);
  const get = (row: string[], k: Key) => (map.has(k) ? String(row[map.get(k)!] ?? "").trim() : "");
  const byCode = new Map<string, RupRow>();
  let skipped = 0, duplicates = 0;
  for (const row of table.slice(headerAt + 1)) {
    if (!row.some((c) => String(c).trim())) continue;
    const code = normalizeRupCode(get(row, "code"));
    const name = get(row, "name").replace(/\s+/g, " ").slice(0, 300);
    if (!code || !name) { skipped++; continue; }
    if (byCode.has(code)) duplicates++;
    byCode.set(code, {
      code, name, pagu: parseMoney(get(row, "pagu")), jenis: get(row, "jenis").slice(0, 100), metode: get(row, "metode").slice(0, 100), cara: get(row, "cara").slice(0, 60),
      sumber: get(row, "sumber").slice(0, 100), lokasi: get(row, "lokasi").slice(0, 300), satker: get(row, "satker").slice(0, 200), kegiatan: get(row, "kegiatan").slice(0, 300),
      waktuPemilihan: get(row, "waktuPemilihan").slice(0, 60), waktuPekerjaan: get(row, "waktuPekerjaan").slice(0, 60),
    });
    if (byCode.size > MAX_RUP_ROWS) return { ok: false, error: `Maksimal ${MAX_RUP_ROWS.toLocaleString("id-ID")} paket per unggahan. Pecah berkas atau saring menurut satuan kerja.` };
  }
  if (byCode.size === 0) return { ok: false, error: "Tidak ada baris paket yang valid (Kode RUP dan Nama Paket harus terisi)." };
  return { ok: true, rows: [...byCode.values()], skipped, duplicates, foundColumns: [...map.keys()], ignoredColumns };
}

/** Pemetaan nilai RUP ke pilihan isian DPP (nilai yang tidak dikenal dibiarkan kosong, bukan ditebak). */
export function mapJenisPengadaan(v: string): string {
  const s = v.toLowerCase();
  if (/konstruksi/.test(s)) return "Pekerjaan Konstruksi";
  if (/konsultansi|konsultasi/.test(s)) return "Jasa Konsultansi";
  if (/jasa/.test(s)) return "Jasa Lainnya";
  if (/barang/.test(s)) return "Barang";
  return "";
}
export function mapMetodePemilihan(v: string): string {
  const s = v.toLowerCase();
  if (/e-?\s?purchasing|e-?\s?katalog|katalog/.test(s)) return "E-purchasing (Katalog Elektronik)";
  if (/pengadaan langsung/.test(s)) return "Pengadaan Langsung";
  if (/penunjukan langsung/.test(s)) return "Penunjukan Langsung";
  if (/tender cepat/.test(s)) return "Tender Cepat";
  if (/tender|seleksi/.test(s)) return "Tender / Seleksi";
  if (/swakelola/.test(s)) return "Swakelola";
  return "";
}
