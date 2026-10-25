import "server-only";
import { extractText, getDocumentProxy } from "unpdf";
import { parseCashPdfLines } from "@/lib/cash-pdf-core";
import { MAX_UPLOAD_BYTES, readTable, type ReadResult } from "@/lib/spreadsheet";

/** Pembaca berkas Anggaran Kas: Excel (.xlsx), CSV, atau PDF berteks. PDF diurai menjadi tabel baku (lihat cash-pdf-core). */
export async function readCashTable(file: File): Promise<ReadResult & { note?: string }> {
  if (!file.name.toLowerCase().endsWith(".pdf")) return readTable(file);
  if (file.size === 0) return { ok: false, error: "Berkas kosong." };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "Berkas terlalu besar (maksimal 2 MB)." };
  try {
    const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    const { text } = await extractText(pdf, { mergePages: false });
    const lines = (Array.isArray(text) ? text : [text]).flatMap((t) => t.split(/\r?\n/));
    const res = parseCashPdfLines(lines);
    if (res.problems.length && res.found === 0) return { ok: false, error: res.problems[0]! };
    if (res.problems.length) return { ok: false, error: `PDF memuat baris yang tidak dapat diurai (${res.problems.length}): ${res.problems.slice(0, 3).join("; ")}. Perbaiki PDF atau gunakan Excel/CSV.` };
    return { ok: true, rows: res.table, note: `PDF dibaca: ${res.found} baris anggaran kas. Periksa pratinjau dengan teliti sebelum menyimpan.` };
  } catch {
    return { ok: false, error: "PDF tidak dapat dibaca. Pastikan PDF berteks (bukan hasil pindai) dan tidak diproteksi sandi." };
  }
}
