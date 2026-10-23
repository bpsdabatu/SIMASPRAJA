/**
 * Inti hitung Anggaran Kas (murni, tanpa akses database; dipakai server & klien, dapat diuji).
 * Semua perhitungan uang dibulatkan ke sen agar tidak ada selisih floating point.
 */
export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"] as const;
export const TW_LABEL = ["TW I", "TW II", "TW III", "TW IV"] as const;

export const cents = (n: number) => Math.round(n * 100);
export const fromCents = (c: number) => c / 100;

export const sumMonths = (m: number[]) => fromCents(m.reduce((a, v) => a + cents(Number.isFinite(v) ? v : 0), 0));

/** Jumlah per triwulan [TW I..TW IV] dari 12 nilai bulanan. */
export function quarterSums(m: number[]): [number, number, number, number] {
  const q = [0, 0, 0, 0];
  for (let i = 0; i < 12; i++) q[Math.floor(i / 3)]! += cents(Number.isFinite(m[i]) ? (m[i] as number) : 0);
  return q.map(fromCents) as [number, number, number, number];
}

export type AllocState = "kosong" | "sebagian" | "penuh" | "lebih";
export interface Allocation { pagu: number; input: number; sisa: number; pct: number | null; state: AllocState }

/** Ringkasan: pagu, sudah diinput, sisa belum diinput (negatif = melebihi pagu). */
export function allocation(pagu: number, months: number[]): Allocation {
  const input = sumMonths(months);
  const sisa = fromCents(cents(pagu) - cents(input));
  const pct = pagu > 0 ? Math.round((input / pagu) * 10000) / 100 : null;
  const state: AllocState = cents(input) > cents(pagu) ? "lebih" : cents(input) === 0 ? "kosong" : sisa === 0 ? "penuh" : "sebagian";
  return { pagu, input, sisa, pct, state };
}

/** Bagi rata nilai total ke 12 bulan; sisa sen ditaruh pada bulan terakhir sehingga jumlahnya tepat. */
export function spreadEvenly(total: number): number[] {
  const c = Math.max(0, cents(total));
  const base = Math.floor(c / 12);
  const out = Array<number>(12).fill(base);
  out[11] = base + (c - base * 12);
  return out.map(fromCents);
}

/** Bagi rata nilai total ke 4 triwulan (tiap triwulan dibagi rata ke 3 bulannya). */
export function spreadByQuarter(total: number): number[] {
  const c = Math.max(0, cents(total));
  const perQ = Math.floor(c / 4);
  const qs = [perQ, perQ, perQ, c - perQ * 3];
  const out: number[] = [];
  for (const q of qs) {
    const b = Math.floor(q / 3);
    out.push(b, b, q - b * 2);
  }
  return out.map(fromCents);
}

/** Mengurai isian angka (titik/koma desimal). Kosong = 0. NaN bila tidak valid. */
export function parseAmount(raw: string): number {
  const t = raw.trim().replace(/\s/g, "");
  if (t === "") return 0;
  if (!/^\d+([.,]\d{1,2})?$/.test(t)) return NaN;
  return Number(t.replace(",", "."));
}

export interface RecapItem { pagu: number; months: number[] | null; status: string | null }
export interface RecapTotals { pagu: number; tw: [number, number, number, number]; total: number; sisa: number; count: number; filled: number }

/** Rekap seluruh butir: jumlah per triwulan, total kas, dan sisa yang belum diinput. */
export function recapTotals(items: RecapItem[]): RecapTotals {
  let pagu = 0, count = 0, filled = 0;
  const tw = [0, 0, 0, 0];
  for (const it of items) {
    pagu += cents(it.pagu); count++;
    if (it.months) {
      filled++;
      const q = quarterSums(it.months);
      for (let i = 0; i < 4; i++) tw[i]! += cents(q[i]!);
    }
  }
  const total = tw.reduce((a, b) => a + b, 0);
  return { pagu: fromCents(pagu), tw: tw.map(fromCents) as RecapTotals["tw"], total: fromCents(total), sisa: fromCents(pagu - total), count, filled };
}

/**
 * Mengurai angka tempelan dari Excel/CSV (lebih longgar daripada parseAmount):
 * menerima "Rp", spasi, format Indonesia (1.234.567,89) maupun Inggris (1,234,567.89). NaN bila tidak valid. Kosong = 0.
 */
export function parseLoose(raw: string): number {
  let t = raw.trim().replace(/^rp\.?\s*/i, "").replace(/\s/g, "");
  if (t === "" || t === "-") return 0;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(t)) t = t.replace(/,/g, "");
  return parseAmount(t);
}

/** Status baris anggaran kas pada tabel ringkas: kosong/sebagian/penuh/lebih terhadap pagu. */
