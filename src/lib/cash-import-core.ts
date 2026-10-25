import { cents, fromCents, quarterSums, sumMonths } from "@/lib/cash-core";
import { parseMoney } from "@/lib/csv";
import { normHeader } from "@/lib/header";
import { normName } from "@/lib/budget-import-core";

/**
 * Inti impor Anggaran Kas dan penyesuaian antartahapan (murni, tanpa akses database; dapat diuji).
 * Semua hitungan uang dalam sen (integer) agar tidak ada selisih pembulatan.
 */

export type CashItemStatus = "none" | "draft" | "submitted" | "returned" | "final";
export interface CashItem {
  itemId: string; subCode: string; accountCode: string; fundingCode: string; fundingName: string; desc: string;
  pagu: number; pptkId: string | null; pptkName?: string; status: CashItemStatus; months: number[];
}

/* ------------------------------------------------------------------ header ------------------------------------------------------------------ */

const MONTH_ALIASES: string[][] = [
  ["jan", "januari"], ["feb", "februari"], ["mar", "maret"], ["apr", "april"], ["mei"], ["jun", "juni"],
  ["jul", "juli"], ["agu", "agt", "agustus"], ["sep", "september"], ["okt", "oktober"], ["nov", "november"], ["des", "desember"],
];
const TW_ALIASES: string[][] = [
  ["tw1", "tw_1", "tw_i", "triwulan_1", "triwulan_i"], ["tw2", "tw_2", "tw_ii", "triwulan_2", "triwulan_ii"],
  ["tw3", "tw_3", "tw_iii", "triwulan_3", "triwulan_iii"], ["tw4", "tw_4", "tw_iv", "triwulan_4", "triwulan_iv"],
];

export interface CashHeader {
  id?: number; sub?: number; account?: number; funding?: number; desc?: number;
  program?: number; kegiatan?: number; pptk?: number; pagu?: number;
  months?: number[]; quarters?: number[]; problems: string[];
}

export function resolveCashHeaders(headerRow: string[]): CashHeader {
  const h = headerRow.map(normHeader);
  const find = (aliases: string[]) => { for (const a of aliases) { const i = h.indexOf(a); if (i !== -1) return i; } return undefined; };
  const out: CashHeader = {
    id: find(["id_butir"]), sub: find(["kode_sub_kegiatan"]), account: find(["kode_rekening", "kode_belanja"]),
    funding: find(["sumber_dana", "kode_sumber_dana", "nama_sumber_dana"]), desc: find(["uraian"]), problems: [],
    program: find(["kode_program"]), kegiatan: find(["kode_kegiatan"]), pptk: find(["pptk", "nama_pptk"]), pagu: find(["pagu"]),
  };
  const m = MONTH_ALIASES.map(find), q = TW_ALIASES.map(find);
  if (m.every((x) => x !== undefined)) out.months = m as number[];
  if (q.every((x) => x !== undefined)) out.quarters = q as number[];
  if (out.id === undefined && (out.sub === undefined || out.account === undefined)) {
    out.problems.push("Kolom penanda butir tidak ditemukan: gunakan id_butir (dari templat) ATAU kode_sub_kegiatan + kode_rekening.");
  }
  if (!out.months && !out.quarters) out.problems.push("Kolom nilai tidak ditemukan: gunakan 12 kolom bulan (jan s.d. des) ATAU 4 kolom triwulan (tw1 s.d. tw4).");
  return out;
}

/* ------------------------------------------------------------------ hitung ------------------------------------------------------------------ */

/** Nilai triwulan -> 12 bulan: tiap triwulan dibagi 3; sisa sen pada bulan ketiga triwulan itu sehingga jumlah tepat. */
export function quarterToMonths(q: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    const c = Math.max(0, cents(q[i] ?? 0));
    const b = Math.floor(c / 3);
    out.push(fromCents(b), fromCents(b), fromCents(c - 2 * b));
  }
  return out;
}

/**
 * Menyesuaikan 12 bulan ke pagu baru. Bila total <= pagu: tidak diubah. Bila total > pagu: dikecilkan proporsional
 * (metode sisa terbesar) sehingga jumlahnya TEPAT sama dengan pagu dan tak ada bulan yang menjadi negatif.
 */
export function fitMonthsToPagu(months: number[], pagu: number): { months: number[]; changed: boolean } {
  const c = months.map((m) => Math.max(0, cents(m)));
  const total = c.reduce((a, b) => a + b, 0);
  const target = Math.max(0, cents(pagu));
  if (total <= target) return { months: c.map(fromCents), changed: false };
  if (target === 0) return { months: c.map(() => 0), changed: true };
  const raw = c.map((v) => (v * target) / total);
  const fl = raw.map(Math.floor);
  let left = target - fl.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (const o of order) { if (left <= 0) break; fl[o.i]!++; left--; }
  return { months: fl.map(fromCents), changed: true };
}

/* ------------------------------------------------------------------ impor ------------------------------------------------------------------ */

export type CashRowStatus = "simpan" | "sama" | "kosong" | "dikunci" | "galat";
export interface CashPlannedRow {
  line: number; status: CashRowStatus; message: string; label: string;
  itemId?: string; months?: number[]; total: number; pagu: number | null;
}
export interface CashPlanOutcome { rows: CashPlannedRow[]; problems: string[]; counts: Record<CashRowStatus, number> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * scope: id PPTK (hanya butir penugasannya) atau "semua" (ADMIN mendistribusikan ke seluruh PPTK; butir wajib sudah punya PPTK).
 * Nilai selalu dinormalkan ke TRIWULAN (bila berkas berisi bulan, dijumlahkan per triwulan) lalu disimpan sebagai 12 periode (tiap TW dibagi 3).
 */
export function planCashImport(table: string[][], head: CashHeader, items: CashItem[], scope: string): CashPlanOutcome {
  const userId = scope;
  const all = scope === "semua";
  const byId = new Map(items.map((i) => [i.itemId.toLowerCase(), i]));
  const byCodes = new Map<string, CashItem[]>();
  for (const it of items) {
    const k = `${it.subCode.toLowerCase()}|${it.accountCode.toLowerCase()}`;
    byCodes.set(k, [...(byCodes.get(k) ?? []), it]);
  }
  const cell = (r: string[], i: number | undefined) => (i === undefined ? "" : (r[i] ?? "").trim());

  const rows: CashPlannedRow[] = [];
  const problems: string[] = [];
  const seen = new Map<string, number>();
  const fail = (line: number, label: string, msg: string) => {
    problems.push(`Baris ${line}: ${msg}`);
    rows.push({ line, status: "galat", message: msg, label, total: 0, pagu: null });
  };

  table.slice(1).forEach((r, n) => {
    const line = n + 2;
    // 1) cari butir
    let item: CashItem | undefined;
    const idv = cell(r, head.id);
    const subv = cell(r, head.sub), accv = cell(r, head.account);
    const label = idv ? idv.slice(0, 8) : `${subv} ${accv}`.trim() || `baris ${line}`;
    if (idv) {
      if (!UUID.test(idv)) return fail(line, label, "id_butir tidak valid");
      item = byId.get(idv.toLowerCase());
      if (!item) return fail(line, label, "id_butir tidak ditemukan pada versi anggaran yang dibuka");
    } else {
      if (!subv || !accv) return fail(line, label, "kode_sub_kegiatan dan kode_rekening wajib diisi");
      let cand = byCodes.get(`${subv.toLowerCase()}|${accv.toLowerCase()}`) ?? [];
      if (cand.length === 0) return fail(line, label, `butir dengan sub kegiatan "${subv}" dan rekening "${accv}" tidak ada pada versi yang dibuka`);
      const fv = cell(r, head.funding);
      if (fv && cand.length > 1) {
        const f = cand.filter((c) => c.fundingCode.toLowerCase() === fv.toLowerCase() || normName(c.fundingName) === normName(fv));
        if (f.length) cand = f;
      }
      const dv = cell(r, head.desc);
      if (dv && cand.length > 1) {
        const d = cand.filter((c) => normName(c.desc) === normName(dv));
        if (d.length) cand = d;
      }
      const pv = cell(r, head.pptk);
      if (pv && cand.length > 1) {
        const p = cand.filter((c) => c.pptkName && normName(c.pptkName) === normName(pv));
        if (p.length) cand = p;
      }
      if (cand.length > 1 && !all) {
        const mine = cand.filter((c) => c.pptkId === userId);
        if (mine.length) cand = mine;
      }
      if (cand.length > 1) return fail(line, label, "butir ambigu (ada lebih dari satu dengan sub kegiatan + rekening yang sama); tambahkan kolom sumber_dana dan/atau uraian, atau pakai id_butir");
      item = cand[0]!;
    }
    const kv = cell(r, head.kegiatan), pgv = cell(r, head.program);
    if (kv && !item.subCode.toLowerCase().startsWith(kv.toLowerCase())) return fail(line, label, `kode kegiatan "${kv}" tidak sesuai dengan sub kegiatan ${item.subCode}`);
    if (pgv && !item.subCode.toLowerCase().startsWith(pgv.toLowerCase())) return fail(line, label, `kode program "${pgv}" tidak sesuai dengan sub kegiatan ${item.subCode}`);
    const paguRaw = cell(r, head.pagu);
    if (paguRaw) {
      const pg = parseMoney(paguRaw);
      if (Number.isFinite(pg) && cents(pg) !== cents(item.pagu)) return fail(line, label, `pagu pada berkas (${pg.toLocaleString("id-ID")}) berbeda dengan pagu Input Anggaran tahapan yang dibuka (${item.pagu.toLocaleString("id-ID")}); pastikan berkas disusun untuk tahapan ini`);
    }
    if (seen.has(item.itemId)) return fail(line, label, `butir ganda dengan baris ${seen.get(item.itemId)}`);
    seen.set(item.itemId, line);

    // 2) nilai
    const read = (cols: number[] | undefined): number[] | null => {
      if (!cols) return null;
      const vals: number[] = [];
      for (const c of cols) {
        const raw = cell(r, c);
        if (raw === "") { vals.push(0); continue; }
        const v = parseMoney(raw);
        if (!Number.isFinite(v) || v < 0) return null;
        if (Math.abs(v * 100 - Math.round(v * 100)) > 1e-6) return null;
        vals.push(Math.round(v * 100) / 100);
      }
      return vals;
    };
    const monthsRaw = head.months ? read(head.months) : null;
    const hasMonthText = head.months?.some((c) => cell(r, c) !== "") ?? false;
    let months: number[] | null;
    if (head.months && (hasMonthText || !head.quarters)) {
      months = monthsRaw;
      if (!months) return fail(line, label, "ada nilai bulan yang tidak valid (angka nol atau lebih, maksimal 2 desimal)");
    } else {
      const q = read(head.quarters);
      if (!q) return fail(line, label, "ada nilai triwulan yang tidak valid (angka nol atau lebih, maksimal 2 desimal)");
      months = quarterToMonths(q);
    }
    months = quarterToMonths(quarterSums(months)); // anggaran kas disusun per TRIWULAN
    const total = sumMonths(months);
    const base = { line, label: `${item.subCode} ${item.accountCode}`.trim(), itemId: item.itemId, months, total, pagu: item.pagu };

    // 3) aturan
    if (all) { if (!item.pptkId) return fail(line, label, "butir belum memiliki PPTK; tetapkan PPTK di Input Anggaran agar kas dapat didistribusikan"); }
    else if (item.pptkId !== userId) return fail(line, label, "bukan butir penugasan Anda (hanya PPTK penanggung jawab yang dapat mengisi kas)");
    if (cents(total) > cents(item.pagu)) return fail(line, label, `total kas ${total.toLocaleString("id-ID")} melebihi pagu ${item.pagu.toLocaleString("id-ID")}`);
    if (item.status === "submitted" || item.status === "final") { rows.push({ ...base, status: "dikunci", message: `Berstatus ${item.status === "final" ? "final" : "diajukan"}; tidak diubah` }); return; }
    if (cents(total) === 0) { rows.push({ ...base, status: "kosong", message: "Semua nilai 0; dilewati" }); return; }
    const qa = quarterSums(months), qb = quarterSums(item.months);
    const same = qa.every((v, i) => cents(v) === cents(qb[i] ?? 0));
    if (same) { rows.push({ ...base, status: "sama", message: "Sama dengan isian saat ini" }); return; }
    rows.push({ ...base, status: "simpan", message: cents(total) < cents(item.pagu) ? `Sisa belum dialokasikan ${(fromCents(cents(item.pagu) - cents(total))).toLocaleString("id-ID")}` : "Pas sesuai pagu" });
  });

  const counts: Record<CashRowStatus, number> = { simpan: 0, sama: 0, kosong: 0, dikunci: 0, galat: 0 };
  for (const r of rows) counts[r.status]++;
  return { rows, problems, counts };
}

/* ------------------------------------------------------------------ penyesuaian antartahapan ------------------------------------------------------------------ */

export type AdjustStatus = "salin" | "kurangi" | "tambah" | "baru" | "realisasi" | "melebihi" | "terisi" | "dikunci" | "tanpa_sumber";
export const emptyAdjustCounts = (): Record<AdjustStatus, number> => ({ salin: 0, kurangi: 0, tambah: 0, baru: 0, realisasi: 0, melebihi: 0, terisi: 0, dikunci: 0, tanpa_sumber: 0 });
export interface AdjustTarget { itemId: string; label: string; pagu: number; mine: boolean; status: CashItemStatus; months: number[]; subCode?: string }
export interface AdjustSource { pagu: number | null; months: number[] | null; subCode?: string }
export interface AdjustRow {
  itemId: string; label: string; status: AdjustStatus; message: string;
  oldPagu: number | null; newPagu: number; oldTotal: number; newTotal: number; months?: number[];
}
export interface AdjustOutcome { rows: AdjustRow[]; others: number; counts: Record<AdjustStatus, number>; warnings?: string[] }

/**
 * Menyalin kas dari tahapan sebelumnya ke tahapan yang dibuka lalu menyesuaikannya dengan pagu baru.
 *  - total kas lama <= pagu baru  -> disalin apa adanya (sisa pagu baru tampil sebagai "belum dialokasikan");
 *  - total kas lama  > pagu baru  -> dikecilkan proporsional sampai tepat sama dengan pagu baru.
 * Isian yang sudah ada dilindungi (tidak ditimpa) kecuali overwrite=true; butir diajukan/final tidak disentuh.
 * Hasil selalu tersimpan sebagai DRAF agar PPTK memeriksa dan mengajukan ulang sesuai tahapan.
 */
export function planCashAdjust(targets: AdjustTarget[], source: Map<string, AdjustSource>, overwrite: boolean): AdjustOutcome {
  const rows: AdjustRow[] = [];
  let others = 0;
  for (const t of targets) {
    if (!t.mine) { others++; continue; }
    const s = source.get(t.itemId);
    const oldTotal = s?.months ? sumMonths(s.months) : 0;
    const base = { itemId: t.itemId, label: t.label, oldPagu: s?.pagu ?? null, newPagu: t.pagu, oldTotal, newTotal: 0 };
    if (t.status === "submitted" || t.status === "final") { rows.push({ ...base, status: "dikunci", message: `Berstatus ${t.status === "final" ? "final" : "diajukan"}; tidak diubah` }); continue; }
    if (!s?.months || cents(oldTotal) === 0) { rows.push({ ...base, status: "tanpa_sumber", message: "Tidak ada kas pada tahapan sumber (butir baru atau belum disusun)" }); continue; }
    if (!overwrite && cents(sumMonths(t.months)) > 0) { rows.push({ ...base, status: "terisi", message: "Sudah ada isian; dilindungi (centang “timpa” bila ingin mengganti)" }); continue; }
    const fit = fitMonthsToPagu(s.months, t.pagu);
    const newTotal = sumMonths(fit.months);
    const gap = cents(t.pagu) - cents(newTotal);
    const msg = fit.changed
      ? `Pagu turun (${(s.pagu ?? 0).toLocaleString("id-ID")} → ${t.pagu.toLocaleString("id-ID")}); kas dikecilkan proporsional`
      : gap > 0 ? `Disalin; pagu baru lebih besar, sisa ${fromCents(gap).toLocaleString("id-ID")} belum dialokasikan` : "Disalin; pas sesuai pagu";
    rows.push({ ...base, newTotal, months: fit.months, status: fit.changed ? "kurangi" : "salin", message: msg });
  }
  const counts = emptyAdjustCounts();
  for (const r of rows) counts[r.status]++;
  return { rows, others, counts };
}

/* ------------------------------------------------------------------ penyesuaian kas menurut TAHAPAN (Pergeseran / Perubahan) ------------------------------------------------------------------ */

export type StageCode = "murni" | "pergeseran" | "perubahan";

/** Indeks triwulan (0..3) dari tanggal DPA ISO (YYYY-MM-DD); null bila tidak ada. */
export const quarterOfDate = (iso: string | null | undefined): number | null => {
  const m = iso ? Number(iso.slice(5, 7)) : NaN;
  return Number.isInteger(m) && m >= 1 && m <= 12 ? Math.floor((m - 1) / 3) : null;
};

/** Pembagian sen proporsional bobot (metode sisa terbesar); bobot semua nol -> rata. Jumlah tepat = total. */
export function splitProportional(total: number, weights: number[]): number[] {
  const w = weights.map((x) => Math.max(0, x));
  const ww = w.reduce((a, b) => a + b, 0) > 0 ? w : w.map(() => 1);
  const sum = ww.reduce((a, b) => a + b, 0);
  const raw = ww.map((x) => (total * x) / sum);
  const fl = raw.map(Math.floor);
  let left = total - fl.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (const o of order) { if (left <= 0) break; fl[o.i]!++; left--; }
  return fl;
}

/**
 * Menyesuaikan Anggaran Kas (TRIWULAN) dengan perubahan pagu pada tahapan baru, per butir (kode rekening):
 *  - pagu TIDAK berubah  -> kas tetap (disalin apa adanya)  [aturan Perubahan: yang tidak berubah tidak diubah];
 *  - pagu turun          -> bila kas lama masih muat dalam pagu baru, tetap; bila tidak, kelebihannya dikurangkan dari triwulan paling akhir
 *                           mundur sampai triwulan DPA, lalu triwulan sebelumnya bila masih kurang (triwulan yang sudah berjalan paling akhir disentuh);
 *  - pagu naik           -> selisih ditambahkan pada triwulan DPA s.d. TW IV, proporsional kas lama pada triwulan tsb (rata bila kosong);
 *  - butir baru (tak ada pada tahapan sumber) -> pagu dibagi rata pada triwulan DPA s.d. TW IV.
 * Pergeseran: total pagu per SUB KEGIATAN harus sama dengan tahapan sumber (pergeseran hanya antar-rekening dalam sub kegiatan yang sama);
 * pelanggarannya dilaporkan sebagai peringatan. Pergeseran dapat dilakukan beberapa kali setahun: pilih versi pergeseran sebelumnya sebagai sumber.
 * Hasil selalu DRAF; butir diajukan/final tidak disentuh; isian yang sudah ada dilindungi kecuali overwrite.
 */
export function planCashByStage(
  stage: StageCode, targets: AdjustTarget[], source: Map<string, AdjustSource>, dpaDate: string | null, overwrite: boolean,
): AdjustOutcome {
  const dq = quarterOfDate(dpaDate);
  const start = dq ?? 0;
  const rows: AdjustRow[] = [];
  const warnings: string[] = [];
  if (dq === null) warnings.push("Tanggal DPA versi yang dibuka belum diisi: perubahan kas ditempatkan pada seluruh triwulan (TW I–IV). Isi tanggal DPA di Input Anggaran agar hanya triwulan berjalan dan berikutnya yang berubah.");
  let others = 0;
  const fmt = (n: number) => n.toLocaleString("id-ID");

  for (const t of targets) {
    if (!t.mine) { others++; continue; }
    const s = source.get(t.itemId);
    const oldQ = (s?.months ? quarterSums(s.months) : [0, 0, 0, 0]).map(cents);
    const oldTotal = oldQ.reduce((a, b) => a + b, 0);
    const base = { itemId: t.itemId, label: t.label, oldPagu: s?.pagu ?? null, newPagu: t.pagu, oldTotal: fromCents(oldTotal), newTotal: 0 };
    if (t.status === "submitted" || t.status === "final") { rows.push({ ...base, status: "dikunci", message: `Berstatus ${t.status === "final" ? "final" : "diajukan"}; tidak diubah` }); continue; }
    if (!overwrite && cents(sumMonths(t.months)) > 0) { rows.push({ ...base, status: "terisi", message: "Sudah ada isian; dilindungi (centang “timpa” bila ingin mengganti)" }); continue; }

    const P = cents(t.pagu);
    const emit = (q: number[], status: AdjustStatus, message: string) => {
      const months = quartersToMonthsCents(q);
      rows.push({ ...base, newTotal: sumMonths(months), months, status, message });
    };

    if (!s || s.pagu === null) {
      if (P <= 0) { rows.push({ ...base, status: "tanpa_sumber", message: "Butir baru berpagu 0; tidak ada kas" }); continue; }
      const span = 4 - start;
      const share = splitProportional(P, Array(span).fill(1));
      const q = [0, 0, 0, 0]; share.forEach((v, k) => { q[start + k] = v; });
      emit(q, "baru", `Butir baru pada tahapan ini; pagu ${fmt(t.pagu)} dibagi rata ${span === 4 ? "TW I–IV" : `TW ${start + 1}–IV`}`);
      continue;
    }
    if (oldTotal === 0) { rows.push({ ...base, status: "tanpa_sumber", message: "Tidak ada kas pada tahapan sumber (belum disusun)" }); continue; }

    const Po = cents(s.pagu);
    if (P === Po) { emit(oldQ.slice(), "salin", "Pagu tidak berubah; kas tetap"); continue; }
    if (P < Po) {
      if (oldTotal <= P) { emit(oldQ.slice(), "salin", `Pagu turun (${fmt(s.pagu)} → ${fmt(t.pagu)}) tetapi kas lama masih muat; kas tetap`); continue; }
      let excess = oldTotal - P;
      const q = oldQ.slice();
      const order = [...Array.from({ length: 4 - start }, (_, k) => 3 - k), ...Array.from({ length: start }, (_, k) => start - 1 - k)];
      for (const i of order) { if (excess <= 0) break; const cut = Math.min(q[i]!, excess); q[i]! -= cut; excess -= cut; }
      emit(q, "kurangi", `Pagu turun (${fmt(s.pagu)} → ${fmt(t.pagu)}); kas dikurangi ${fmt(fromCents(oldTotal - P))} dari triwulan akhir mundur`);
      continue;
    }
    const delta = P - Po;
    const span = 4 - start;
    const share = splitProportional(delta, Array.from({ length: span }, (_, k) => oldQ[start + k]!));
    const q = oldQ.slice(); share.forEach((v, k) => { q[start + k]! += v; });
    emit(q, "tambah", `Pagu naik (${fmt(s.pagu)} → ${fmt(t.pagu)}); tambahan ${fmt(fromCents(delta))} ditempatkan pada ${span === 4 ? "TW I–IV" : `TW ${start + 1}–IV`}`);
  }

  if (stage === "pergeseran") {
    const subOld = new Map<string, number>(), subNew = new Map<string, number>();
    for (const [, v] of source) if (v.subCode && v.pagu !== null) subOld.set(v.subCode, (subOld.get(v.subCode) ?? 0) + cents(v.pagu));
    for (const t of targets) if (t.subCode) subNew.set(t.subCode, (subNew.get(t.subCode) ?? 0) + cents(t.pagu));
    for (const sub of new Set([...subOld.keys(), ...subNew.keys()])) {
      const a = subOld.get(sub) ?? 0, b = subNew.get(sub) ?? 0;
      if (a !== b) warnings.push(`Pergeseran: total pagu sub kegiatan ${sub} berubah (${fmt(fromCents(a))} → ${fmt(fromCents(b))}). Pergeseran hanya boleh memindahkan pagu antar-rekening dalam sub kegiatan yang sama; periksa Input Anggaran.`);
    }
  }
  const counts = emptyAdjustCounts();
  for (const r of rows) counts[r.status]++;
  return { rows, others, counts, warnings };
}

/** 4 nilai triwulan (sen, integer) -> 12 bulan (rupiah). */
function quartersToMonthsCents(q: number[]): number[] {
  const out: number[] = [];
  for (const c0 of q) { const c = Math.max(0, c0); const b = Math.floor(c / 3); out.push(fromCents(b), fromCents(b), fromCents(c - 2 * b)); }
  return out;
}

/* ------------------------------------------------------------------ penyesuaian kas berbasis realisasi ------------------------------------------------------------------ */

export interface RealizedByItem {
  /** Realisasi sah (ber-SP2D) per bulan SP2D, 12 nilai (lintas tahapan). */
  monthly: number[];
  /** Bagian realisasi pada bulan DPA yang bertanggal SP2D SEBELUM tanggal DPA (sudah terjadi pada tahapan sebelumnya). */
  preDpaMonth: number;
}

/** Pembagian sen proporsional (metode sisa terbesar); jumlah tepat = total. Bobot semua nol -> rata. */
function splitCents(total: number, weights: number[]): number[] {
  const w = weights.map((x) => Math.max(0, x));
  const sw = w.reduce((a, b) => a + b, 0);
  const ww = sw > 0 ? w : w.map(() => 1);
  const sum = ww.reduce((a, b) => a + b, 0);
  const raw = ww.map((x) => (total * x) / sum);
  const fl = raw.map(Math.floor);
  let left = total - fl.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (const o of order) { if (left <= 0) break; fl[o.i]!++; left--; }
  return fl;
}

/**
 * Menyusun kas tahapan baru dari REALISASI nyata:
 *  - bulan SEBELUM bulan tanggal DPA  : kas = realisasi sebenarnya bulan itu;
 *  - bulan DPA s.d. Desember          : sisa pagu baru (pagu - realisasi sebelum tanggal DPA) dibagi mengikuti pola rencana kas lama
 *                                       (bobot = kas lama pada bulan-bulan tsb; bila tidak ada -> rata); realisasi bulan DPA yang bertanggal
 *                                       sebelum DPA ditambahkan pada bulan DPA.
 * Total kas selalu TEPAT sama dengan pagu baru. Bila realisasi sebelum DPA melebihi pagu baru -> "melebihi" (tidak disimpan).
 * Isian yang sudah ada dilindungi kecuali overwrite; butir diajukan/final tidak disentuh; hanya butir milik PPTK yang login.
 */
export function planCashFromRealization(
  targets: AdjustTarget[], source: Map<string, AdjustSource>, realized: Map<string, RealizedByItem>, dpaDate: string, overwrite: boolean,
): AdjustOutcome {
  const m0 = Math.min(11, Math.max(0, Number(dpaDate.slice(5, 7)) - 1));
  const rows: AdjustRow[] = [];
  let others = 0;
  for (const t of targets) {
    if (!t.mine) { others++; continue; }
    const s = source.get(t.itemId);
    const real = realized.get(t.itemId);
    const oldTotal = s?.months ? sumMonths(s.months) : 0;
    const base = { itemId: t.itemId, label: t.label, oldPagu: s?.pagu ?? null, newPagu: t.pagu, oldTotal, newTotal: 0 };
    if (t.status === "submitted" || t.status === "final") { rows.push({ ...base, status: "dikunci", message: `Berstatus ${t.status === "final" ? "final" : "diajukan"}; tidak diubah` }); continue; }
    const hasReal = !!real && (real.monthly.some((v) => cents(v) > 0) || cents(real.preDpaMonth) > 0);
    if (!hasReal && cents(oldTotal) === 0) { rows.push({ ...base, status: "tanpa_sumber", message: "Tidak ada realisasi maupun kas tahapan sumber" }); continue; }
    if (!overwrite && cents(sumMonths(t.months)) > 0) { rows.push({ ...base, status: "terisi", message: "Sudah ada isian; dilindungi (centang “timpa” bila ingin mengganti)" }); continue; }

    const closed = Array.from({ length: 12 }, (_, i) => (i < m0 ? cents(real?.monthly[i] ?? 0) : 0));
    const pre = cents(real?.preDpaMonth ?? 0);
    const realizedBefore = closed.reduce((a, b) => a + b, 0) + pre;
    const rest = cents(t.pagu) - realizedBefore;
    if (rest < 0) {
      rows.push({ ...base, status: "melebihi", message: `Realisasi sebelum tanggal DPA (${fromCents(realizedBefore).toLocaleString("id-ID")}) melebihi pagu baru (${t.pagu.toLocaleString("id-ID")}); periksa pagu atau data realisasi` });
      continue;
    }
    const weights = Array.from({ length: 12 - m0 }, (_, k) => cents(s?.months?.[m0 + k] ?? 0));
    const share = splitCents(rest, weights);
    const outC = closed.slice();
    for (let k = 0; k < share.length; k++) outC[m0 + k] = share[k]! + (k === 0 ? pre : 0);
    const months = outC.map(fromCents);
    rows.push({
      ...base, newTotal: sumMonths(months), months, status: "realisasi",
      message: `Bulan sebelum ${MONTH_NAMES[m0]} = realisasi (${fromCents(closed.reduce((a, b) => a + b, 0)).toLocaleString("id-ID")}); sisa ${fromCents(rest).toLocaleString("id-ID")} dibagi ${MONTH_NAMES[m0]}–Des${cents(oldTotal) > 0 ? " mengikuti pola kas lama" : " secara rata"}`,
    });
  }
  const counts = emptyAdjustCounts();
  for (const r of rows) counts[r.status]++;
  return { rows, others, counts };
}
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** Keadaan yang dikembalikan aksi server ke panel (periksa dulu -> terapkan). */
export interface CashImportState {
  phase?: "idle" | "preview" | "done" | "error";
  error?: string;
  counts?: Record<CashRowStatus, number>;
  rows?: CashPlannedRow[];
  truncated?: boolean;
  note?: string;
  applied?: { saved: number; gagal: string[] };
}
export interface CashAdjustState {
  phase?: "idle" | "preview" | "done" | "error";
  error?: string;
  source?: string;
  warnings?: string[];
  counts?: Record<AdjustStatus, number>;
  rows?: AdjustRow[];
  others?: number;
  truncated?: boolean;
  applied?: { saved: number; gagal: string[] };
}
