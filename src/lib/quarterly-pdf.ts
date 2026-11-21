import PDFDocument from "pdfkit";
import { dateID, pct, rp, QUARTER_LABEL, type Line, type QuarterReport } from "@/lib/quarterly-core";
import { DEFAULT_PRINT, MARGINS, mmToPt, pageSizeMm, type PrintSettings } from "@/lib/print-settings";

/** PDF laporan triwulanan (kertas/orientasi/margin mengikuti Pengaturan Cetak; bawaan A4 landscape). Font Helvetica = metrik setara Arial (font standar PDF, tanpa berkas font tertanam). */
const NAVY = "#0a2140", BLUE = "#143d6b", GOLD = "#c29d4d", GREY = "#64748b", LINE = "#cbd5e1", SOFT = "#eff4fa";
const STATUS_COLOR: Record<string, string> = { "Sesuai target": "#047857", "Perlu perhatian": "#b45309", "Di bawah target": "#b91c1c", "Belum ada target kas": "#64748b" };

export function buildQuarterPdf(r: QuarterReport, print: PrintSettings = DEFAULT_PRINT): Promise<Buffer> {
  const [pw, ph] = pageSizeMm(print);
  const M = Math.round(mmToPt(Math.max(MARGINS[print.margin].h, MARGINS[print.margin].v)));
  const doc = new PDFDocument({ size: [mmToPt(pw), mmToPt(ph)], margin: M, bufferPages: true, info: { Title: `Laporan Capaian ${r.label} TA ${r.year}`, Author: "SIMASPRAJA" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));
  const W = doc.page.width - M * 2, BOTTOM = doc.page.height - M - 18;
  const F = (bold = false) => doc.font(bold ? "Helvetica-Bold" : "Helvetica");
  const ensure = (h: number) => { if (doc.y + h > BOTTOM) doc.addPage(); };

  // ---- Kop ----
  F(true).fontSize(10).fillColor(BLUE).text(r.org.toUpperCase() || "ORGANISASI PERANGKAT DAERAH", { align: "center" });
  F(true).fontSize(14).fillColor(NAVY).text("LAPORAN CAPAIAN KINERJA PELAKSANAAN DAN REALISASI KEGIATAN DAN ANGGARAN", { align: "center" });
  F().fontSize(10).fillColor("#334155").text(`${r.label.toUpperCase()} — TAHUN ANGGARAN ${r.year} — ${r.stageLabel.toUpperCase()}`, { align: "center" });
  F().fontSize(9).fillColor(GREY).text(`Periode ${dateID(r.start)} s.d. ${dateID(r.end)}  |  Cakupan: ${r.pptkFilter ? `PPTK ${r.pptkFilter}` : "seluruh PPTK"}`, { align: "center" });
  doc.moveDown(0.3);
  doc.moveTo(M, doc.y).lineTo(M + W, doc.y).lineWidth(1.5).strokeColor(NAVY).stroke();
  doc.moveDown(0.6);

  // ---- KPI ----
  const t = r.totals;
  const kpis: [string, string, string][] = [
    ["Pagu", rp(t.pagu), ""],
    ["Target kas s.d. triwulan", rp(t.kasCum), t.pagu ? `${pct(Math.round((t.kasCum / t.pagu) * 10000) / 100)} dari pagu` : ""],
    [`Realisasi ${r.label}`, rp(t.realTw), `target triwulan ${rp(t.kasTw)}`],
    ["Realisasi kumulatif", rp(t.realCum), `${pct(t.pctPagu)} dari pagu`],
    ["Capaian terhadap kas", pct(t.pctKas), t.status],
  ];
  const gap = 8, bw = (W - gap * 4) / 5, y0 = doc.y;
  kpis.forEach(([label, val, sub], i) => {
    const x = M + i * (bw + gap);
    doc.roundedRect(x, y0, bw, 58, 4).fillAndStroke(SOFT, LINE);
    F().fontSize(8).fillColor(GREY).text(label, x + 8, y0 + 7, { width: bw - 16 });
    F(true).fontSize(i === 4 ? 15 : 11.5).fillColor(NAVY).text(val, x + 8, y0 + 20, { width: bw - 16 });
    F().fontSize(7.5).fillColor(i === 4 ? STATUS_COLOR[t.status]! : GREY).text(sub, x + 8, y0 + 43, { width: bw - 16 });
  });
  doc.y = y0 + 70;

  // ---- Grafik per triwulan (target kas vs realisasi) ----
  F(true).fontSize(10).fillColor(NAVY).text("Target Anggaran Kas dan Realisasi per Triwulan", M, doc.y);
  const cy = doc.y + 6, ch = 92, cw = Math.min(360, Math.round(W * 0.5)), base = cy + ch;
  const maxV = Math.max(1, ...r.perQuarter.flatMap((p) => [p.kas, p.real]));
  doc.moveTo(M, base).lineTo(M + cw, base).lineWidth(0.7).strokeColor(LINE).stroke();
  r.perQuarter.forEach((p, i) => {
    const step = (cw - 8) / 4, bwid = Math.min(26, Math.floor((step - 12) / 2)), gx = M + 8 + i * step + (step - 2 * bwid - 3) / 2;
    const hk = (p.kas / maxV) * (ch - 18), hr = (p.real / maxV) * (ch - 18);
    doc.rect(gx, base - hk, bwid, hk).fill(BLUE);
    doc.rect(gx + bwid + 3, base - hr, bwid, hr).fill(GOLD);
    F(i + 1 === r.quarter).fontSize(8).fillColor(i + 1 === r.quarter ? NAVY : GREY).text(`TW ${["I", "II", "III", "IV"][i]}`, gx - 4, base + 3, { width: bwid * 2 + 14, align: "center" });
  });
  doc.rect(M + cw + 14, cy + 6, 8, 8).fill(BLUE); F().fontSize(8).fillColor("#334155").text("Target kas", M + cw + 26, cy + 5);
  doc.rect(M + cw + 14, cy + 22, 8, 8).fill(GOLD); F().fontSize(8).fillColor("#334155").text("Realisasi sah", M + cw + 26, cy + 21);

  // Bilah capaian
  const bx = M + cw + 150, bwFull = Math.max(90, W - cw - 150);
  const bar = (label: string, v: number | null, yy: number, color: string) => {
    F().fontSize(8).fillColor("#334155").text(label, bx, yy, { width: bwFull });
    doc.roundedRect(bx, yy + 11, bwFull, 9, 3).fill("#e2e8f0");
    const w = Math.min(100, Math.max(0, v ?? 0)) / 100 * bwFull;
    if (w > 0) doc.roundedRect(bx, yy + 11, w, 9, 3).fill(color);
    F(true).fontSize(8).fillColor(NAVY).text(pct(v), bx, yy + 22, { width: bwFull });
  };
  bar("Realisasi kumulatif terhadap pagu", t.pctPagu, cy, BLUE);
  bar("Realisasi kumulatif terhadap target kas", t.pctKas, cy + 40, STATUS_COLOR[t.status]!);
  doc.y = base + 22;

  // ---- Analisis ----
  ensure(40);
  F(true).fontSize(11).fillColor(NAVY).text("Analisis Singkat", M, doc.y);
  doc.moveDown(0.2);
  F(true).fontSize(9).fillColor("#0f172a").text(r.analysis.headline, M, doc.y, { width: W });
  doc.moveDown(0.3);
  const bullets = (items: string[], size = 8.8) => items.forEach((s) => {
    const h = F().fontSize(size).heightOfString(s, { width: W - 14 });
    ensure(h + 4);
    const yy = doc.y;
    doc.circle(M + 3, yy + 5, 1.6).fill(GOLD);
    F().fontSize(size).fillColor("#1e293b").text(s, M + 12, yy, { width: W - 14 });
    doc.moveDown(0.25);
  });
  bullets(r.analysis.findings);
  if (r.analysis.recommendations.length) {
    ensure(30); doc.moveDown(0.2);
    F(true).fontSize(10).fillColor(NAVY).text("Rekomendasi", M, doc.y); doc.moveDown(0.2);
    bullets(r.analysis.recommendations);
  }

  // ---- Tabel generik ----
  type Col = { h: string; w: number; align?: "left" | "right" };
  const table = (title: string, cols: Col[], rows: { cells: string[]; bold?: boolean; fill?: string; color?: string; colorCol?: number }[]) => {
    doc.addPage();
    F(true).fontSize(11).fillColor(NAVY).text(title, M, doc.y); doc.moveDown(0.4);
    const total = cols.reduce((a, c) => a + c.w, 0);
    const scale = W / total;
    const cw2 = cols.map((c) => c.w * scale);
    const header = () => {
      const yy = doc.y, hh = 22;
      doc.rect(M, yy, W, hh).fill(BLUE);
      let x = M;
      cols.forEach((c, i) => { F(true).fontSize(7.5).fillColor("#fff").text(c.h, x + 3, yy + 5, { width: cw2[i]! - 6, align: c.align ?? "left" }); x += cw2[i]!; });
      doc.y = yy + hh;
    };
    header();
    for (const row of rows) {
      const hs = row.cells.map((c, i) => F(row.bold).fontSize(7.5).heightOfString(c, { width: cw2[i]! - 6 }));
      const rh = Math.max(14, Math.max(...hs) + 6);
      if (doc.y + rh > BOTTOM) { doc.addPage(); header(); }
      const yy = doc.y;
      if (row.fill) doc.rect(M, yy, W, rh).fill(row.fill);
      let x = M;
      row.cells.forEach((c, i) => {
        F(row.bold || i === row.colorCol).fontSize(7.5).fillColor(i === row.colorCol && row.color ? row.color : "#0f172a").text(c, x + 3, yy + 3, { width: cw2[i]! - 6, align: cols[i]!.align ?? "left" });
        x += cw2[i]!;
      });
      doc.moveTo(M, yy + rh).lineTo(M + W, yy + rh).lineWidth(0.4).strokeColor(LINE).stroke();
      doc.y = yy + rh;
    }
  };

  const money = (n: number) => rp(n).replace("Rp ", "");
  const colsLine: Col[] = [
    { h: "Kode", w: 70 }, { h: "Uraian", w: 150 }, { h: "Pagu", w: 62, align: "right" }, { h: "Target kas s.d. TW", w: 62, align: "right" },
    { h: `Realisasi ${r.label}`, w: 62, align: "right" }, { h: "Realisasi kumulatif", w: 62, align: "right" }, { h: "% pagu", w: 36, align: "right" },
    { h: "% kas", w: 36, align: "right" }, { h: "Sisa pagu", w: 62, align: "right" }, { h: "Status", w: 58 },
  ];
  const lineRow = (l: Line) => ({
    cells: [`${"  ".repeat(l.level)}${l.code}`, l.name, money(l.m.pagu), money(l.m.kasCum), money(l.m.realTw), money(l.m.realCum), pct(l.m.pctPagu), pct(l.m.pctKas), money(l.m.sisa), l.m.status],
    bold: l.level < 2, fill: l.level === 0 ? "#dbe6f3" : l.level === 1 ? SOFT : undefined, color: STATUS_COLOR[l.m.status], colorCol: 9,
  });
  table(`Capaian per Program, Kegiatan, dan Sub Kegiatan (Rp)`, colsLine, [
    ...r.lines.map(lineRow),
    { cells: ["", "JUMLAH", money(t.pagu), money(t.kasCum), money(t.realTw), money(t.realCum), pct(t.pctPagu), pct(t.pctKas), money(t.sisa), t.status], bold: true, fill: "#e2e8f0", color: STATUS_COLOR[t.status], colorCol: 9 },
  ]);

  if (!r.pptkFilter && r.byPptk.length > 0) {
    table("Capaian per PPTK (Rp)", [
      { h: "PPTK", w: 150 }, { h: "Butir", w: 30, align: "right" }, { h: "Pagu", w: 66, align: "right" }, { h: "Target kas s.d. TW", w: 66, align: "right" },
      { h: `Realisasi ${r.label}`, w: 66, align: "right" }, { h: "Realisasi kumulatif", w: 66, align: "right" }, { h: "% pagu", w: 38, align: "right" }, { h: "% kas", w: 38, align: "right" }, { h: "Status", w: 62 },
    ], r.byPptk.map((p) => ({ cells: [p.name, String(p.items), money(p.m.pagu), money(p.m.kasCum), money(p.m.realTw), money(p.m.realCum), pct(p.m.pctPagu), pct(p.m.pctKas), p.m.status], color: STATUS_COLOR[p.m.status], colorCol: 8 })));
  }

  // ---- Catatan & tanda tangan ----
  ensure(150);
  if (doc.y > BOTTOM - 150) doc.addPage();
  doc.moveDown(0.8);
  F(true).fontSize(9).fillColor(NAVY).text("Catatan Metodologi dan Keterbatasan Data", M, doc.y); doc.moveDown(0.2);
  bullets(r.analysis.notes, 7.8);
  ensure(110);
  doc.moveDown(0.6);
  const sy = doc.y;
  F().fontSize(8.5).fillColor("#0f172a").text(`${dateID(r.today)}`, M, sy, { width: W, align: "right" });
  const sw = W / 3;
  ["Mengetahui,", r.pptkFilter ? `PPTK ${r.pptkFilter}` : "Pejabat Penatausahaan Keuangan", "Penyusun Laporan"].forEach((role, i) => {
    const x = M + i * sw;
    F().fontSize(8.5).text(role, x, sy + 16, { width: sw, align: "center" });
    doc.moveTo(x + 30, sy + 74).lineTo(x + sw - 30, sy + 74).lineWidth(0.5).strokeColor("#334155").stroke();
    F().fontSize(7.5).fillColor(GREY).text("NIP. ...............................", x, sy + 77, { width: sw, align: "center" });
  });

  // ---- Footer ----
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const fy = doc.page.height - M + 4;
    const prev = doc.page.margins.bottom; doc.page.margins.bottom = 0;
    F().fontSize(7).fillColor(GREY).text(`Dicetak dari SIMASPRAJA, ${new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "long", timeStyle: "short", hour12: false }).format(r.generatedAt)} WIB — ${QUARTER_LABEL[r.quarter]} TA ${r.year}`, M, fy, { width: W - 80, lineBreak: false });
    F().fontSize(7).fillColor(GREY).text(`Halaman ${i + 1} dari ${range.count}`, M + W - 80, fy, { width: 80, align: "right", lineBreak: false });
    doc.page.margins.bottom = prev;
  }
  doc.end();
  return done;
}
