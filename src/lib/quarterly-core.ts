/**
 * Inti perhitungan Laporan Capaian Triwulanan (murni; tanpa akses database) sehingga mudah diuji.
 *
 * Definisi (konsisten dengan docs/database.md):
 *  - Pagu            : budget_item_versions.pagu pada versi yang dibuka.
 *  - Target kas      : Anggaran Kas bulanan (cash_budget_periods) dijumlah per triwulan / kumulatif s.d. akhir triwulan.
 *  - Realisasi sah   : pembayaran dengan SP2D bertanggal dan tidak dibatalkan (v_eligible_realization), dikelompokkan menurut TANGGAL SP2D.
 *  - Komitmen kontrak dan transaksi menunggu SP2D tidak dihitung sebagai realisasi.
 */
export type Quarter = 1 | 2 | 3 | 4;

export interface QItem {
  itemId: string;
  programCode: string; programName: string;
  activityCode: string; activityName: string;
  subCode: string; subName: string;
  accountCode: string; accountName: string;
  pptkId: string | null; pptk: string; description: string;
  pagu: number;
  /** 12 nilai bulanan, atau null bila belum ada rencana kas. */
  kasMonths: number[] | null;
  kasStatus: string | null;
  /** date = tanggal SP2D (dasar realisasi sah); txDate = tanggal transaksi (opsional; bila kosong dianggap sama dengan date). */
  real: { date: string; amount: number; txDate?: string }[];
  pending: number; komitmen: number;
  /** Ada transaksi aktif (bukan dibatalkan). */
  hasTransaction: boolean;
}

export type Status = "Sesuai target" | "Perlu perhatian" | "Di bawah target" | "Belum ada target kas";
/** Ambang indikator internal (rasio realisasi kumulatif terhadap target kas kumulatif). */
export const THRESHOLD = { good: 90, watch: 70 } as const;

export interface Metrics {
  pagu: number; kasTw: number; kasCum: number; realTw: number; realCum: number;
  pending: number; komitmen: number; sisa: number;
  pctPagu: number | null; pctKas: number | null; status: Status;
}

export const QUARTER_LABEL: Record<Quarter, string> = { 1: "Triwulan I", 2: "Triwulan II", 3: "Triwulan III", 4: "Triwulan IV" };

export function quarterRange(year: number, q: Quarter): { start: string; end: string } {
  const m1 = (q - 1) * 3 + 1, m3 = m1 + 2;
  const lastDay = new Date(Date.UTC(year, m3, 0)).getUTCDate();
  const p = (n: number) => String(n).padStart(2, "0");
  return { start: `${year}-${p(m1)}-01`, end: `${year}-${p(m3)}-${p(lastDay)}` };
}

export const todayWIB = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** Triwulan bawaan: triwulan berjalan (WIB) bila tahun anggaran = tahun ini; tahun lampau -> IV; tahun depan -> I. */
export function defaultQuarter(year: number, now: Date): Quarter {
  const t = todayWIB(now);
  const ty = Number(t.slice(0, 4));
  if (year < ty) return 4;
  if (year > ty) return 1;
  return (Math.floor((Number(t.slice(5, 7)) - 1) / 3) + 1) as Quarter;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const ratio = (a: number, b: number) => (b === 0 ? null : round2((a / b) * 100));

export function classify(realCum: number, kasCum: number): Status {
  if (kasCum <= 0) return "Belum ada target kas";
  const r = (realCum / kasCum) * 100;
  return r >= THRESHOLD.good ? "Sesuai target" : r >= THRESHOLD.watch ? "Perlu perhatian" : "Di bawah target";
}

export function metricsOf(items: QItem[], q: Quarter, year: number): Metrics {
  const { start, end } = quarterRange(year, q);
  let pagu = 0, kasTw = 0, kasCum = 0, realTw = 0, realCum = 0, pending = 0, komitmen = 0;
  for (const it of items) {
    pagu += it.pagu; pending += it.pending; komitmen += it.komitmen;
    if (it.kasMonths) {
      for (let m = 0; m < 12; m++) {
        const v = it.kasMonths[m] ?? 0;
        if (m < q * 3) kasCum += v;
        if (m >= (q - 1) * 3 && m < q * 3) kasTw += v;
      }
    }
    for (const r of it.real) {
      if (r.date <= end) realCum += r.amount;
      if (r.date >= start && r.date <= end) realTw += r.amount;
    }
  }
  return {
    pagu, kasTw, kasCum, realTw, realCum, pending, komitmen, sisa: pagu - realCum,
    pctPagu: ratio(realCum, pagu), pctKas: ratio(realCum, kasCum), status: classify(realCum, kasCum),
  };
}

export interface Line { level: 0 | 1 | 2; code: string; name: string; m: Metrics }
export interface PptkLine { key: string; name: string; items: number; m: Metrics }
export interface QuarterPoint { quarter: Quarter; kas: number; real: number }

export interface QuarterReport {
  org: string; year: number; stageLabel: string; quarter: Quarter; label: string;
  start: string; end: string; today: string; endsInFuture: boolean; notStarted: boolean;
  pptkFilter: string | null; generatedAt: Date;
  totals: Metrics;
  lines: Line[];
  byPptk: PptkLine[];
  perQuarter: QuarterPoint[];
  counts: { items: number; withKas: number; kasFinal: number; kasSubmitted: number; kasDraft: number; realized: number; inProgress: number; idle: number; unassigned: number };
  attention: { code: string; name: string; gap: number; pctKas: number | null; pptk: string }[];
  analysis: { headline: string; findings: string[]; recommendations: string[]; notes: string[] };
}

const nf = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const pf = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const rp = (n: number) => `Rp ${nf.format(Math.round(n))}`;
export const pct = (n: number | null) => (n === null ? "-" : `${pf.format(n)}%`);
export const dateID = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function groupBy<T>(list: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of list) { const k = key(x); (m.get(k) ?? m.set(k, []).get(k)!).push(x); }
  return m;
}

export interface BuildInput {
  org: string; year: number; stageLabel: string; quarter: Quarter; now: Date;
  items: QItem[]; pptkFilter: string | null;
}

export function buildQuarterReport(inp: BuildInput): QuarterReport {
  const { year, quarter: q, items } = inp;
  const { start, end } = quarterRange(year, q);
  const today = todayWIB(inp.now);
  const totals = metricsOf(items, q, year);

  // Susunan berjenjang Program > Kegiatan > Sub Kegiatan
  const sorted = [...items].sort((a, b) => `${a.programCode}|${a.activityCode}|${a.subCode}`.localeCompare(`${b.programCode}|${b.activityCode}|${b.subCode}`, "id", { numeric: true }));
  const lines: Line[] = [];
  for (const [, pr] of groupBy(sorted, (r) => r.programCode)) {
    lines.push({ level: 0, code: pr[0]!.programCode, name: pr[0]!.programName || "(tanpa program)", m: metricsOf(pr, q, year) });
    for (const [, ac] of groupBy(pr, (r) => r.activityCode)) {
      lines.push({ level: 1, code: ac[0]!.activityCode, name: ac[0]!.activityName || "(tanpa kegiatan)", m: metricsOf(ac, q, year) });
      for (const [, sb] of groupBy(ac, (r) => r.subCode)) {
        lines.push({ level: 2, code: sb[0]!.subCode, name: sb[0]!.subName || "(tanpa sub kegiatan)", m: metricsOf(sb, q, year) });
      }
    }
  }

  const byPptk: PptkLine[] = [...groupBy(items, (r) => r.pptkId ?? "none")].map(([key, list]) => ({
    key, name: list[0]!.pptk || "Belum ditugaskan", items: list.length, m: metricsOf(list, q, year),
  })).sort((a, b) => a.name.localeCompare(b.name, "id"));

  const perQuarter: QuarterPoint[] = ([1, 2, 3, 4] as Quarter[]).map((x) => {
    const mm = metricsOf(items, x, year);
    return { quarter: x, kas: mm.kasTw, real: mm.realTw };
  });

  const kasStatuses = items.map((i) => i.kasStatus);
  const counts = {
    items: items.length,
    withKas: items.filter((i) => i.kasMonths && i.kasMonths.some((v) => v > 0)).length,
    kasFinal: kasStatuses.filter((s) => s === "final").length,
    kasSubmitted: kasStatuses.filter((s) => s === "submitted").length,
    kasDraft: kasStatuses.filter((s) => s === "draft" || s === "returned").length,
    realized: 0, inProgress: 0, idle: 0,
    unassigned: items.filter((i) => !i.pptkId).length,
  };
  for (const it of items) {
    const realCum = it.real.filter((r) => r.date <= end).reduce((s, r) => s + r.amount, 0);
    if (realCum > 0) counts.realized++;
    else if (it.hasTransaction || it.pending > 0 || it.komitmen > 0) counts.inProgress++;
    else counts.idle++;
  }

  // Sub kegiatan yang perlu perhatian: target kas ada namun realisasi tertinggal (urut selisih terbesar)
  const attention = lines.filter((l) => l.level === 2 && l.m.kasCum > 0 && l.m.status === "Di bawah target")
    .map((l) => ({ code: l.code, name: l.name, gap: l.m.kasCum - l.m.realCum, pctKas: l.m.pctKas,
      pptk: [...new Set(items.filter((i) => i.subCode === l.code).map((i) => i.pptk || "Belum ditugaskan"))].join(", ") }))
    .sort((a, b) => b.gap - a.gap).slice(0, 5);

  const notStarted = today < start;
  const endsInFuture = today < end;
  const label = QUARTER_LABEL[q];
  const rep: QuarterReport = {
    org: inp.org, year, stageLabel: inp.stageLabel, quarter: q, label, start, end, today, endsInFuture, notStarted,
    pptkFilter: inp.pptkFilter, generatedAt: inp.now, totals, lines, byPptk, perQuarter, counts, attention,
    analysis: { headline: "", findings: [], recommendations: [], notes: [] },
  };
  rep.analysis = analyse(rep);
  return rep;
}

function analyse(r: QuarterReport): QuarterReport["analysis"] {
  const t = r.totals, c = r.counts;
  const findings: string[] = [], recs: string[] = [], notes: string[] = [];
  const scope = r.pptkFilter ? `PPTK ${r.pptkFilter}` : "seluruh butir anggaran";

  if (c.items === 0) {
    return { headline: `Belum ada butir anggaran pada cakupan laporan (${scope}).`, findings: [], recommendations: [], notes: ["Laporan tidak memuat data karena belum ada butir anggaran pada versi dan filter yang dipilih."] };
  }

  const headline = `${r.label} TA ${r.year}: realisasi kumulatif ${rp(t.realCum)} (${pct(t.pctPagu)} dari pagu ${rp(t.pagu)}); ${
    t.pctKas === null ? "target Anggaran Kas belum tersedia" : `${pct(t.pctKas)} dari target kas kumulatif`} — ${t.status.toLowerCase()}.`;

  findings.push(`Capaian keuangan ${r.label}: realisasi sah pada triwulan ini ${rp(t.realTw)}; kumulatif s.d. ${dateID(r.end)} ${rp(t.realCum)} (${pct(t.pctPagu)} dari pagu). Sisa pagu ${rp(t.sisa)}.`);

  if (t.kasCum > 0) {
    const diff = t.realCum - t.kasCum;
    findings.push(`Terhadap Anggaran Kas: target kumulatif ${rp(t.kasCum)} (${pct(t.pagu === 0 ? null : round2((t.kasCum / t.pagu) * 100))} dari pagu), target triwulan ini ${rp(t.kasTw)}. Realisasi kumulatif mencapai ${pct(t.pctKas)} dari target, ${diff < 0 ? `lebih rendah ${rp(-diff)}` : diff > 0 ? `lebih tinggi ${rp(diff)}` : "sama dengan target"}.`);
  } else {
    findings.push("Anggaran Kas belum memuat target s.d. triwulan ini sehingga capaian terhadap kas tidak dapat dinilai.");
  }
  if (c.withKas < c.items) {
    findings.push(`Anggaran Kas baru terisi untuk ${c.withKas} dari ${c.items} butir; ${c.kasFinal} final, ${c.kasSubmitted} diajukan, ${c.kasDraft} masih draf/dikembalikan. Capaian terhadap kas hanya mencerminkan butir yang sudah terisi.`);
  } else if (c.kasFinal < c.items) {
    findings.push(`Anggaran Kas terisi untuk seluruh butir (${c.kasFinal} final, ${c.kasSubmitted} diajukan, ${c.kasDraft} draf/dikembalikan).`);
  }

  findings.push(`Pelaksanaan: dari ${c.items} butir anggaran, ${c.realized} sudah terealisasi, ${c.inProgress} dalam proses (ada transaksi/komitmen belum SP2D), dan ${c.idle} belum ada aktivitas.${t.pending > 0 ? ` Pembayaran menunggu SP2D ${rp(t.pending)}.` : ""}${t.komitmen > 0 ? ` Komitmen kontrak ${rp(t.komitmen)} (belum dihitung sebagai realisasi).` : ""}`);

  if (r.attention.length) {
    findings.push(`Sub kegiatan di bawah target (<${THRESHOLD.watch}% dari kas): ${r.attention.slice(0, 3).map((a) => `${a.code} ${a.name} (${pct(a.pctKas)}, selisih ${rp(a.gap)})`).join("; ")}.`);
  }
  if (!r.pptkFilter && r.byPptk.length > 1) {
    const rated = r.byPptk.filter((p) => p.key !== "none" && p.m.pctKas !== null);
    if (rated.length > 1) {
      const hi = [...rated].sort((a, b) => (b.m.pctKas! - a.m.pctKas!))[0]!, lo = [...rated].sort((a, b) => (a.m.pctKas! - b.m.pctKas!))[0]!;
      findings.push(`Menurut PPTK: capaian terhadap kas tertinggi ${hi.name} (${pct(hi.m.pctKas)}), terendah ${lo.name} (${pct(lo.m.pctKas)}).`);
    }
  }
  if (c.unassigned > 0) findings.push(`${c.unassigned} butir belum memiliki PPTK penanggung jawab sehingga tidak dapat dipantau per PPTK.`);

  if (t.status === "Di bawah target" || t.status === "Perlu perhatian") recs.push("Percepat proses pelaksanaan dan pembayaran pada sub kegiatan yang tertinggal; bila ada kendala, sesuaikan jadwal Anggaran Kas melalui mekanisme yang berlaku.");
  if (t.status === "Sesuai target") recs.push("Pertahankan laju pelaksanaan dan pastikan ketepatan pencatatan SP2D.");
  if (t.pending > 0) recs.push(`Tindak lanjuti pembayaran menunggu SP2D senilai ${rp(t.pending)} agar tercatat sebagai realisasi.`);
  if (c.idle > 0) recs.push(`Telaah ${c.idle} butir yang belum ada aktivitas: tetapkan jadwal pengadaan/pelaksanaan atau usulkan pergeseran bila tidak dapat dilaksanakan.`);
  if (c.withKas < c.items) recs.push("Lengkapi dan ajukan Anggaran Kas seluruh butir agar capaian terhadap target dapat dinilai utuh.");
  if (c.unassigned > 0) recs.push("Tetapkan PPTK pada butir yang belum memiliki penanggung jawab.");

  if (r.notStarted) notes.push(`${r.label} belum dimulai per ${dateID(r.today)}; angka bersifat awal.`);
  else if (r.endsInFuture) notes.push(`${r.label} belum berakhir; angka bersifat sementara per ${dateID(r.today)}.`);
  notes.push("Realisasi = pembayaran dengan SP2D bertanggal dan tidak dibatalkan, dikelompokkan menurut tanggal SP2D. Komitmen kontrak dan pembayaran menunggu SP2D tidak dihitung sebagai realisasi.");
  notes.push("Target kas = Anggaran Kas bulanan yang tersimpan di sistem (semua status). Capaian fisik/keluaran kegiatan belum dicatat di sistem; capaian kinerja pada laporan ini diukur dari capaian keuangan dan status pelaksanaan transaksi.");
  notes.push(`Indikator status (rasio realisasi kumulatif terhadap target kas kumulatif): Sesuai target ≥ ${THRESHOLD.good}%; Perlu perhatian ${THRESHOLD.watch}–<${THRESHOLD.good}%; Di bawah target < ${THRESHOLD.watch}%. Analisis disusun otomatis dari data sistem.`);

  return { headline, findings, recommendations: recs, notes };
}
