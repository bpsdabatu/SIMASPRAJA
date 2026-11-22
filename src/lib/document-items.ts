/**
 * Rincian kebutuhan barang/jasa pada dokumen pengadaan (Nota Dinas, DPP): nama, spesifikasi, volume, satuan, harga satuan,
 * jumlah, serta REFERENSI HARGA (tautan Katalog Elektronik InaProc / toko daring / sumber lain) sebagai dasar penyusunan HPS.
 * Murni (tanpa server-only) agar dipakai server (validasi & hitung ulang) dan klien (editor), serta mudah diuji.
 * Jumlah, subtotal, PPN, dan total SELALU dihitung ulang di server; nilai dari browser tidak dipercaya.
 */
export const REF_KINDS = {
  katalog: "Katalog Elektronik InaProc",
  toko: "Toko daring",
  survei: "Survei / penawaran penyedia",
  kontrak: "Harga kontrak sebelumnya",
  lainnya: "Lainnya",
} as const;
export type RefKind = keyof typeof REF_KINDS;

export interface DocItem {
  nama: string; spesifikasi: string; volume: number; satuan: string; harga: number; jumlah: number;
  refKind: RefKind; refUrl: string; refTanggal: string; refHarga: number | null; refCatatan: string;
}

export const MAX_ITEMS = 200;
export const DEFAULT_PPN = 11;
export const UNIT_SUGGESTIONS = ["Unit", "Buah", "Paket", "Set", "Rim", "Lembar", "Dus", "Botol", "Kg", "Liter", "m²", "Orang", "Orang/Bulan", "Bulan", "Hari", "Kali", "Kegiatan", "Lot"];

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const lineTotal = (volume: number, harga: number) => round2(volume * harga);

const KATALOG_HOSTS = ["inaproc.id", "lkpp.go.id"];
const TOKO_HOSTS = ["tokopedia.com", "shopee.co.id", "blibli.com", "bukalapak.com", "lazada.co.id", "tiktok.com", "olx.co.id", "bhinneka.com", "jakmall.com", "ralali.com", "mitra10.com", "ruparupa.com", "indomaret.co.id", "klikindomaret.com", "erafone.com", "iboxindonesia.com", "officemart.co.id", "gramedia.com", "mirota.com"];

/** Tautan http(s) yang aman; null bila tidak valid (mis. javascript:, data:, berkredensial). */
export function safeHttpUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password) return null;
    return u;
  } catch { return null; }
}

const hostIs = (host: string, list: string[]) => list.some((d) => host === d || host.endsWith(`.${d}`));
/** Menebak jenis sumber dari alamat tautan (untuk peringatan di editor). */
export function classifyRefUrl(raw: string): "katalog" | "toko" | null {
  const u = safeHttpUrl(raw);
  if (!u) return null;
  const h = u.hostname.toLowerCase();
  return hostIs(h, KATALOG_HOSTS) ? "katalog" : hostIs(h, TOKO_HOSTS) ? "toko" : null;
}

export interface ItemParse { items: DocItem[]; errors: string[] }

const num = (v: unknown): number => (typeof v === "number" ? v : Number(String(v ?? "").replace(",", ".")));
const txt = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/** Validasi & normalisasi daftar item dari JSON (data dari browser tidak dipercaya). */
export function parseItems(raw: unknown): ItemParse {
  const errors: string[] = [];
  let arr: unknown;
  try { arr = typeof raw === "string" ? (raw.trim() ? JSON.parse(raw) : []) : raw; } catch { return { items: [], errors: ["Format rincian barang/jasa tidak valid."] }; }
  if (!Array.isArray(arr)) return { items: [], errors: ["Format rincian barang/jasa tidak valid."] };
  if (arr.length > MAX_ITEMS) errors.push(`Maksimal ${MAX_ITEMS} baris barang/jasa.`);
  const items: DocItem[] = [];
  arr.slice(0, MAX_ITEMS).forEach((r, i) => {
    const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    const nama = txt(o.nama, 200);
    const empty = !nama && !txt(o.spesifikasi, 10) && !txt(o.satuan, 10) && !txt(o.volume, 10) && !txt(o.harga, 10) && !txt(o.refUrl, 10);
    if (empty) return; // baris kosong diabaikan
    const at = `Baris ${i + 1}`;
    const volume = num(o.volume), harga = num(o.harga);
    const satuan = txt(o.satuan, 30);
    if (!nama) errors.push(`${at}: nama barang/jasa wajib diisi.`);
    if (!Number.isFinite(volume) || volume <= 0 || volume > 1e9) errors.push(`${at}: volume harus lebih dari 0.`);
    if (!satuan) errors.push(`${at}: satuan wajib diisi.`);
    if (!Number.isFinite(harga) || harga < 0 || harga > 1e13) errors.push(`${at}: harga satuan tidak valid.`);
    const refKind: RefKind = typeof o.refKind === "string" && o.refKind in REF_KINDS ? (o.refKind as RefKind) : "katalog";
    const urlRaw = txt(o.refUrl, 500);
    if (urlRaw && !safeHttpUrl(urlRaw)) errors.push(`${at}: tautan referensi harus berupa alamat http(s) yang valid.`);
    const refTanggal = txt(o.refTanggal, 10);
    if (refTanggal && !/^\d{4}-\d{2}-\d{2}$/.test(refTanggal)) errors.push(`${at}: tanggal akses referensi tidak valid.`);
    const rh = txt(o.refHarga, 30);
    const refHarga = rh === "" ? null : num(rh);
    if (refHarga !== null && (!Number.isFinite(refHarga) || refHarga < 0 || refHarga > 1e13)) errors.push(`${at}: harga referensi tidak valid.`);
    const v = Number.isFinite(volume) ? volume : 0, h = Number.isFinite(harga) ? harga : 0;
    items.push({
      nama, spesifikasi: txt(o.spesifikasi, 1000), volume: v, satuan, harga: h, jumlah: lineTotal(v, h),
      refKind, refUrl: urlRaw && safeHttpUrl(urlRaw) ? urlRaw : "", refTanggal,
      refHarga: refHarga !== null && Number.isFinite(refHarga) ? refHarga : null, refCatatan: txt(o.refCatatan, 300),
    });
  });
  return { items, errors };
}

export interface Totals { subtotal: number; ppnPersen: number; ppn: number; total: number }
export function parsePpn(raw: unknown): number {
  const n = num(raw);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : DEFAULT_PPN;
}
/** Total HPS = jumlah seluruh rincian + PPN (HPS ditetapkan termasuk PPN). */
export function computeTotals(items: Pick<DocItem, "jumlah">[], ppnPersen: number): Totals {
  const subtotal = round2(items.reduce((s, i) => s + i.jumlah, 0));
  const ppn = round2((subtotal * ppnPersen) / 100);
  return { subtotal, ppnPersen, ppn, total: round2(subtotal + ppn) };
}
