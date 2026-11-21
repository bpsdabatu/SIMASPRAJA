import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { buildQuarterReport, type QItem } from "../src/lib/quarterly-core";
import { buildQuarterPdf } from "../src/lib/quarterly-pdf";
import { DEFAULT_PRINT, pageCss, pageSizeMm, parsePrintSettings, serializePrintSettings, type PrintSettings } from "../src/lib/print-settings";

vi.mock("server-only", () => ({}));

const item: QItem = {
  itemId: "i", programCode: "1", programName: "Program 1", activityCode: "1.1", activityName: "Kegiatan 1", subCode: "1.1.1", subName: "Sub 1",
  accountCode: "5.1", accountName: "Belanja", pptkId: "p1", pptk: "Ani", description: "", pagu: 1_000_000,
  kasMonths: Array(12).fill(100_000), kasStatus: "final", real: [{ date: "2026-02-10", amount: 200_000 }], pending: 0, komitmen: 0, hasTransaction: false,
};
const report = buildQuarterReport({ org: "Bagian Perekonomian", year: 2026, stageLabel: "Murni", quarter: 2, now: new Date("2026-05-10T00:00:00Z"), pptkFilter: null, items: [item] });

/** Ukuran halaman (pt) dari /MediaBox halaman pertama. */
const mediaBox = (buf: Buffer) => { const m = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(buf.toString("latin1")); return [Number(m![1]), Number(m![2])]; };
const pt = (mm: number) => (mm * 72) / 25.4;

describe("pengaturan cetak", () => {
  it("bawaan = A4 lanskap (perilaku lama) dan nilai tak valid jatuh ke bawaan", () => {
    expect(parsePrintSettings(undefined)).toEqual(DEFAULT_PRINT);
    expect(parsePrintSettings("zzz.foo.bar")).toEqual(DEFAULT_PRINT);
    expect(parsePrintSettings("<script>")).toEqual(DEFAULT_PRINT);
  });
  it("serialisasi bolak-balik", () => {
    const s: PrintSettings = { paper: "f4", orientation: "portrait", margin: "wide" };
    expect(parsePrintSettings(serializePrintSettings(s))).toEqual(s);
  });
  it("ukuran halaman menukar sisi pada lanskap & CSS @page", () => {
    expect(pageSizeMm({ paper: "f4", orientation: "portrait", margin: "normal" })).toEqual([215, 330]);
    expect(pageSizeMm({ paper: "f4", orientation: "landscape", margin: "normal" })).toEqual([330, 215]);
    expect(pageCss(DEFAULT_PRINT)).toBe("@page { size: 297mm 210mm; margin: 14mm 12mm; }");
  });
  it("PDF triwulan mengikuti kertas & orientasi", async () => {
    for (const s of [DEFAULT_PRINT, { paper: "a4", orientation: "portrait", margin: "normal" }, { paper: "f4", orientation: "portrait", margin: "wide" }, { paper: "legal", orientation: "landscape", margin: "narrow" }, { paper: "a3", orientation: "portrait", margin: "normal" }] as PrintSettings[]) {
      const [w, h] = pageSizeMm(s);
      const [bw, bh] = mediaBox(await buildQuarterPdf(report, s));
      expect(bw).toBeCloseTo(pt(w), 0);
      expect(bh).toBeCloseTo(pt(h), 0);
    }
  });
  it("Excel memuat pengaturan halaman (kertas, orientasi, header berulang)", async () => {
    const { buildXlsx } = await import("../src/lib/spreadsheet");
    const buf = await buildXlsx([{ name: "T", header: ["a", "b"], rows: [[1, 2]] }], { paper: "f4", orientation: "portrait", margin: "wide" });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    const ps = wb.worksheets[0]!.pageSetup;
    expect(ps.paperSize).toBe(14); expect(ps.orientation).toBe("portrait"); expect(ps.printTitlesRow).toBe("1:1");
  });
});
