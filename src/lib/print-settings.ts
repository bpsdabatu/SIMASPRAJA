/**
 * Pengaturan cetak (jenis kertas, orientasi, margin) — berlaku untuk SEMUA keluaran: cetak browser (@page), PDF, dan Excel.
 * Disimpan di cookie (per perangkat/pengguna) agar server dapat membacanya saat membuat PDF/Excel. Murni (tanpa server-only).
 */
export type PaperKey = "a4" | "f4" | "legal" | "letter" | "a3";
export type Orientation = "portrait" | "landscape";
export type MarginKey = "narrow" | "normal" | "wide";
export interface PrintSettings { paper: PaperKey; orientation: Orientation; margin: MarginKey }

/** w/h dalam mm (posisi potret). `xlsx` = kode ukuran kertas Excel (ExcelJS pageSetup.paperSize). */
export const PAPERS: Record<PaperKey, { label: string; w: number; h: number; xlsx: number }> = {
  a4: { label: "A4 (210 × 297 mm)", w: 210, h: 297, xlsx: 9 },
  f4: { label: "F4 / Folio (215 × 330 mm)", w: 215, h: 330, xlsx: 14 },
  legal: { label: "Legal (216 × 356 mm)", w: 216, h: 356, xlsx: 5 },
  letter: { label: "Letter (216 × 279 mm)", w: 216, h: 279, xlsx: 1 },
  a3: { label: "A3 (297 × 420 mm)", w: 297, h: 420, xlsx: 8 },
};
/** [atas-bawah, kiri-kanan] dalam mm. */
export const MARGINS: Record<MarginKey, { label: string; v: number; h: number }> = {
  narrow: { label: "Sempit (8 mm)", v: 8, h: 8 },
  normal: { label: "Normal (14 × 12 mm)", v: 14, h: 12 },
  wide: { label: "Lebar (20 mm)", v: 20, h: 20 },
};
export const ORIENTATIONS: Record<Orientation, string> = { portrait: "Potret (tegak)", landscape: "Lanskap (mendatar)" };

/** Bawaan = perilaku aplikasi sebelumnya: A4 lanskap, margin normal. */
export const DEFAULT_PRINT: PrintSettings = { paper: "a4", orientation: "landscape", margin: "normal" };
export const PRINT_COOKIE = "simaspraja_print";
export const PRINT_STYLE_ID = "print-page-style";

const isPaper = (v: string): v is PaperKey => v in PAPERS;
const isMargin = (v: string): v is MarginKey => v in MARGINS;
const isOrientation = (v: string): v is Orientation => v === "portrait" || v === "landscape";

/** Format cookie: "a4.landscape.normal". Nilai tak valid -> bawaan (tidak pernah melempar). */
export function parsePrintSettings(raw: string | null | undefined): PrintSettings {
  const [p, o, m] = String(raw ?? "").split(".");
  return {
    paper: p && isPaper(p) ? p : DEFAULT_PRINT.paper,
    orientation: o && isOrientation(o) ? o : DEFAULT_PRINT.orientation,
    margin: m && isMargin(m) ? m : DEFAULT_PRINT.margin,
  };
}
export const serializePrintSettings = (s: PrintSettings) => `${s.paper}.${s.orientation}.${s.margin}`;

/** Ukuran halaman [lebar, tinggi] mm sesuai orientasi. */
export function pageSizeMm(s: PrintSettings): [number, number] {
  const { w, h } = PAPERS[s.paper];
  return s.orientation === "landscape" ? [h, w] : [w, h];
}
export const mmToPt = (mm: number) => (mm * 72) / 25.4;

/** Aturan @page untuk cetak browser. */
export function pageCss(s: PrintSettings): string {
  const [w, h] = pageSizeMm(s);
  const m = MARGINS[s.margin];
  return `@page { size: ${w}mm ${h}mm; margin: ${m.v}mm ${m.h}mm; }`;
}
