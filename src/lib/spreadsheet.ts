import "server-only";
import ExcelJS from "exceljs";
import { parseCsv } from "@/lib/csv";
import { getPrintSettings } from "@/lib/print-settings-server";
import { MARGINS, PAPERS, type PrintSettings } from "@/lib/print-settings";

/** Pembaca/penulis tabel untuk impor-ekspor Excel (.xlsx) dan CSV. Hanya dipakai di server. */

export const MAX_UPLOAD_BYTES = 2_000_000;

/** Nilai sel ExcelJS -> teks polos (angka, tanggal, formula, teks kaya, hyperlink). */
function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join("").trim();
    if ("result" in o) return cellText(o.result as ExcelJS.CellValue);
    if (typeof o.text === "string") return o.text.trim();
    if (typeof o.hyperlink === "string") return o.hyperlink;
  }
  return "";
}

export type ReadResult = { ok: true; rows: string[][] } | { ok: false; error: string };

/** Membaca lembar pertama .xlsx atau isi .csv/.txt menjadi baris-baris teks (baris kosong dibuang). */
export async function readTable(file: File): Promise<ReadResult> {
  if (file.size === 0) return { ok: false, error: "Berkas kosong." };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "Berkas terlalu besar (maksimal 2 MB)." };
  const name = file.name.toLowerCase();
  if (name.endsWith(".xls")) return { ok: false, error: "Format .xls lama tidak didukung. Simpan ulang sebagai .xlsx atau .csv." };
  if (name.endsWith(".xlsx")) {
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load((await file.arrayBuffer()) as ExcelJS.Buffer);
      const ws = wb.worksheets[0];
      if (!ws) return { ok: false, error: "Berkas Excel tidak memiliki lembar kerja." };
      const rows: string[][] = [];
      const width = Math.min(ws.columnCount, 60);
      ws.eachRow({ includeEmpty: false }, (row) => {
        const cells: string[] = [];
        for (let c = 1; c <= width; c++) cells.push(cellText(row.getCell(c).value));
        if (cells.some((x) => x !== "")) rows.push(cells);
      });
      return { ok: true, rows };
    } catch {
      return { ok: false, error: "Berkas Excel tidak dapat dibaca. Pastikan formatnya .xlsx yang valid." };
    }
  }
  if (name.endsWith(".csv") || name.endsWith(".txt") || file.type.startsWith("text/")) {
    return { ok: true, rows: parseCsv(await file.text()) };
  }
  return { ok: false, error: "Jenis berkas tidak didukung. Gunakan .xlsx atau .csv." };
}

/** Kunci kolom dibakukan: huruf kecil, spasi/tanda baca -> garis bawah. */
export { normHeader } from "@/lib/header";

export interface SheetSpec {
  name: string;
  header: string[];
  rows: (string | number | null)[][];
  /** Lebar kolom (karakter); default otomatis. */
  widths?: number[];
  /** Indeks kolom (0-based) berformat rupiah. */
  moneyCols?: number[];
  /** Judul di atas tabel (opsional). */
  title?: string[];
}

const ARIAL = "Arial";

/** Membuat berkas .xlsx (font Arial, header tebal, angka sebagai angka). */
export async function buildXlsx(sheets: SheetSpec[], print?: PrintSettings): Promise<Buffer> {
  const ps = print ?? (await getPrintSettings());
  const wb = new ExcelJS.Workbook();
  wb.creator = "SIMASPRAJA";
  wb.created = new Date();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    for (const t of s.title ?? []) {
      const r = ws.addRow([t]);
      r.font = { name: ARIAL, size: 11, bold: true };
    }
    if (s.title?.length) ws.addRow([]);
    const head = ws.addRow(s.header);
    head.font = { name: ARIAL, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF143D6B" } };
    head.alignment = { vertical: "middle", wrapText: true };
    const headerRowNo = head.number;
    for (const r of s.rows) {
      const row = ws.addRow(r.map((v) => (v === null ? "" : v)));
      row.font = { name: ARIAL, size: 10 };
    }
    s.header.forEach((h, i) => {
      const col = ws.getColumn(i + 1);
      col.width = s.widths?.[i] ?? Math.min(48, Math.max(12, h.length + 4));
      if (s.moneyCols?.includes(i)) col.numFmt = '#,##0.00;[Red]-#,##0.00';
    });
    ws.views = [{ state: "frozen", ySplit: headerRowNo }];
    // Pengaturan halaman cetak (kertas, orientasi, margin) mengikuti Pengaturan Cetak; lebar muat 1 halaman, header berulang.
    const mg = MARGINS[ps.margin];
    ws.pageSetup = {
      paperSize: PAPERS[ps.paper].xlsx, orientation: ps.orientation, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: mg.h / 25.4, right: mg.h / 25.4, top: mg.v / 25.4, bottom: mg.v / 25.4, header: 0.3, footer: 0.3 },
      printTitlesRow: `${headerRowNo}:${headerRowNo}`,
    };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const xlsxHeaders = (filename: string) => ({
  "Content-Type": XLSX_MIME,
  "Content-Disposition": `attachment; filename="${filename}"`,
  "Cache-Control": "no-store",
});

export type WorkbookResult = { ok: true; sheets: { name: string; rows: string[][] }[] } | { ok: false; error: string };

/** Membaca SEMUA lembar kerja .xlsx (untuk impor satu berkas berisi banyak sheet). */
export async function readWorkbook(file: File): Promise<WorkbookResult> {
  if (file.size === 0) return { ok: false, error: "Berkas kosong." };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "Berkas terlalu besar (maksimal 2 MB)." };
  if (!file.name.toLowerCase().endsWith(".xlsx")) return { ok: false, error: "Impor beberapa sheet hanya untuk berkas .xlsx." };
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await file.arrayBuffer()) as ExcelJS.Buffer);
    const sheets = wb.worksheets.map((ws) => {
      const rows: string[][] = [];
      const width = Math.min(ws.columnCount, 60);
      ws.eachRow({ includeEmpty: false }, (row) => {
        const cells: string[] = [];
        for (let c = 1; c <= width; c++) cells.push(cellText(row.getCell(c).value));
        if (cells.some((x) => x !== "")) rows.push(cells);
      });
      return { name: ws.name, rows };
    });
    return { ok: true, sheets };
  } catch {
    return { ok: false, error: "Berkas Excel tidak dapat dibaca. Pastikan formatnya .xlsx yang valid." };
  }
}
