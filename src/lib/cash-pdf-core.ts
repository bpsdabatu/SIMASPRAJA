import { parseLoose } from "@/lib/cash-core";

/**
 * Pembaca tabel Anggaran Kas dari TEKS PDF (murni, dapat diuji). Hanya untuk PDF berteks (bukan hasil pindai/foto).
 * Per baris: cari kode rekening belanja (5.x.xx.xx.xxx.xxxxx), kode sub kegiatan terakhir yang terlihat di atasnya (x.xx.xx.x.xx.xxxx),
 * lalu deretan angka di AKHIR baris:
 *   4 angka  = TW I–IV                         12 angka = Jan–Des
 *   5 angka  = pagu + TW I–IV  (atau TW I–IV + total bila angka terakhir = jumlah keempat TW)
 *   6 angka  = pagu + TW I–IV + total          13 angka = pagu + Jan–Des
 * Hasil dinormalkan ke tabel dengan kolom kode_sub_kegiatan, kode_rekening, [pagu], tw1..tw4 agar memakai pemeriksaan impor yang sama
 * (termasuk pagu harus sama dengan Input Anggaran). Baris yang polanya tidak dikenal dilaporkan, bukan ditebak.
 */
const SUB_RE = /\b\d\.\d{2}\.\d{2}\.\d\.\d{2}\.\d{4}\b/;
const ACC_RE = /\b5\.\d\.\d{2}\.\d{2}\.\d{2,3}\.\d{4,5}\b/;
const NUM_RE = /^(?:\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?|-)$/;

export interface PdfCashParse { table: string[][]; problems: string[]; found: number }

const fmt = (n: number) => String(Math.round(n * 100) / 100);

export function parseCashPdfLines(lines: string[]): PdfCashParse {
  const body: string[][] = [];
  const problems: string[] = [];
  let sub = "";
  let anyPagu = false;
  const parsed: { sub: string; acc: string; pagu: string; tw: number[] }[] = [];

  lines.forEach((raw, idx) => {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) return;
    const acc = ACC_RE.exec(line);
    if (!acc) {
      const sm = SUB_RE.exec(line);
      if (sm) sub = sm[0];
      return;
    }
    const sm = SUB_RE.exec(line.slice(0, acc.index));
    if (sm) sub = sm[0];
    const toks = line.slice(acc.index + acc[0].length).trim().split(" ");
    const nums: string[] = [];
    for (let i = toks.length - 1; i >= 0 && NUM_RE.test(toks[i]!); i--) nums.unshift(toks[i]!);
    const label = `baris PDF ${idx + 1} (${acc[0]})`;
    if (!sub) { problems.push(`${label}: kode sub kegiatan tidak ditemukan di atas baris ini`); return; }
    const v = nums.map((n) => parseLoose(n === "-" ? "0" : n));
    if (v.some((x) => !Number.isFinite(x))) { problems.push(`${label}: ada angka yang tidak terbaca`); return; }
    let pagu: number | null = null, tw: number[] | null = null;
    const quarter = (m: number[]) => [0, 1, 2, 3].map((q) => m[q * 3]! + m[q * 3 + 1]! + m[q * 3 + 2]!);
    const near = (a: number, b: number) => Math.abs(a - b) < 0.005;
    switch (v.length) {
      case 4: tw = v; break;
      case 5: if (near(v[4]!, v[0]! + v[1]! + v[2]! + v[3]!)) tw = v.slice(0, 4); else { pagu = v[0]!; tw = v.slice(1); } break;
      case 6: pagu = v[0]!; tw = v.slice(1, 5); break;
      case 12: tw = quarter(v); break;
      case 13: pagu = v[0]!; tw = quarter(v.slice(1)); break;
      default: problems.push(`${label}: ditemukan ${v.length} angka di akhir baris; pola yang dikenal 4, 5, 6, 12, atau 13 angka`); return;
    }
    if (pagu !== null) anyPagu = true;
    parsed.push({ sub, acc: acc[0], pagu: pagu === null ? "" : fmt(pagu), tw: tw! });
  });

  const header = anyPagu ? ["kode_sub_kegiatan", "kode_rekening", "pagu", "tw1", "tw2", "tw3", "tw4"] : ["kode_sub_kegiatan", "kode_rekening", "tw1", "tw2", "tw3", "tw4"];
  for (const p of parsed) body.push(anyPagu ? [p.sub, p.acc, p.pagu, ...p.tw.map(fmt)] : [p.sub, p.acc, ...p.tw.map(fmt)]);
  if (parsed.length === 0 && problems.length === 0) problems.push("Tidak ada baris anggaran kas yang dikenali pada PDF. Pastikan PDF berteks (bukan hasil pindai) dan memuat kode rekening belanja; atau gunakan Excel/CSV.");
  return { table: [header, ...body], problems, found: parsed.length };
}
