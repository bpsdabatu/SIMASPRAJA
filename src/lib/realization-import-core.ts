import { parseMoney } from "@/lib/csv";
import { normHeader } from "@/lib/header";
import { normName, resolvePptk, type Lookups } from "@/lib/budget-import-core";

/**
 * Inti impor Realisasi (murni, tanpa akses database; dapat diuji).
 *
 * Format yang dipahami = laporan "Pencarian Realisasi per Metode" (Rekap per metode di atas + tabel RINCIAN TRANSAKSI):
 *   No | Tgl Transaksi | Uraian | Sub Kegiatan | Nama Belanja | Sumber Dana | Metode Pemilihan | Nominal (Rp) | Tgl SP2D | PPTK
 * Sub Kegiatan/Belanja boleh berupa NAMA atau KODE (kolom kode_sub_kegiatan / kode_rekening opsional); PPTK boleh nama atau username.
 * Tahun anggaran TIDAK diambil dari judul laporan; tahapan ditentukan oleh tanggal DPA (lihat stageForDate).
 */

/* ------------------------------------------------------------------ tanggal & uang ------------------------------------------------------------------ */

const pad = (n: number) => String(n).padStart(2, "0");
const validYmd = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};

/** "23/01/2026", "23-01-2026", "2026-01-23" -> "2026-01-23"; kosong -> null; tidak valid -> undefined. */
export function parseDateFlexible(raw: string): string | null | undefined {
  const s = raw.trim();
  if (s === "") return null;
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return validYmd(Number(m[3]), Number(m[2]), Number(m[1])) ?? undefined;
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) return validYmd(Number(m[1]), Number(m[2]), Number(m[3])) ?? undefined;
  // Angka serial tanggal Excel (sel berformat Umum): 1 = 1 Jan 1900 (dengan kekeliruan tahun kabisat 1900 milik Excel) -> hari 25569 = 1 Jan 1970.
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Math.floor(Number(s));
    if (n >= 30000 && n <= 80000) { const d = new Date(Date.UTC(1970, 0, 1) + (n - 25569) * 86400000); return validYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) ?? undefined; }
  }
  return undefined;
}

/* ------------------------------------------------------------------ pencocokan nama yang toleran ------------------------------------------------------------------ */

const STOP = new Set(["dan", "yang", "untuk", "dari", "di", "ke", "pada", "the", "of"]);
/** Huruf kecil tanpa tanda baca/spasi: "DBH-CHT", "dbh cht", "D.B.H CHT" -> "dbhcht". */
export const looseKey = (s: string) => s.replace(/&/g, " dan ").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const words = (s: string) => s.replace(/&/g, " dan ").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
/** Singkatan dari kata-kata nama: "Pendapatan Asli Daerah" -> "pad"; "Dana Bagi Hasil Cukai Hasil Tembakau" -> "dbhcht". */
const initials = (s: string) => words(s).filter((w) => !STOP.has(w)).map((w) => w[0]).join("");

export interface NameEntry { id: string; name: string; code?: string }
export interface NameMatch { id: string | null; ambiguous: boolean; suggestions: NameEntry[] }

/**
 * Mencocokkan nama pada berkas dengan entri master secara bertahap: persis -> tanpa tanda baca/spasi -> kode -> singkatan (PAD = Pendapatan Asli Daerah)
 * -> salah satu memuat yang lain (tanpa tanda baca; minimal 8 huruf). Hanya mengembalikan id bila hasilnya TEPAT SATU; selain itu null + saran terdekat.
 */
export function matchName(raw: string, entries: NameEntry[]): NameMatch {
  const n = normName(raw), lk = looseKey(raw);
  if (!lk) return { id: null, ambiguous: false, suggestions: [] };
  const stages: ((e: NameEntry) => boolean)[] = [
    (e) => normName(e.name) === n,
    (e) => looseKey(e.name) === lk,
    (e) => !!e.code && looseKey(e.code) === lk,
    (e) => lk.length >= 2 && lk.length <= 8 && initials(e.name) === lk,
    (e) => lk.length >= 8 && (looseKey(e.name).includes(lk) || lk.includes(looseKey(e.name))) && looseKey(e.name).length >= 8,
  ];
  for (const st of stages) {
    const hit = entries.filter(st);
    if (hit.length === 1) return { id: hit[0]!.id, ambiguous: false, suggestions: [] };
    if (hit.length > 1) return { id: null, ambiguous: true, suggestions: hit.slice(0, 6) };
  }
  const wa = new Set(words(raw).filter((w) => !STOP.has(w)));
  const scored = entries.map((e) => { const wb = new Set(words(e.name).filter((w) => !STOP.has(w))); let c = 0; for (const w of wa) if (wb.has(w)) c++; return { e, score: c / Math.max(1, Math.min(wa.size, wb.size)) }; })
    .filter((x) => x.score > 0.4).sort((a, b) => b.score - a.score).slice(0, 5).map((x) => x.e);
  return { id: null, ambiguous: false, suggestions: scored };
}

/* ------------------------------------------------------------------ ringkasan penyebab galat ------------------------------------------------------------------ */

export interface ReasonSummary { code: string; label: string; hint: string; count: number; example: string }
const REASONS: { code: string; test: RegExp; label: string; hint: string }[] = [
  { code: "tahun", test: /di luar tahun anggaran/, label: "Tahun tidak sesuai", hint: "Tahun anggaran pada konteks yang dibuka berbeda dengan tanggal pada berkas. Pilih konteks tahun yang benar (menu Ganti Konteks) lalu ulangi." },
  { code: "master", test: /tidak ditemukan di Data Master|ambigu \(nama sama|belanja .* ambigu/, label: "Nama tidak cocok dengan Data Master", hint: "Cocokkan nama pada kotak “Cocokkan nama yang belum dikenali” di bawah, atau samakan nama di Data Master." },
  { code: "butir", test: /belum ada di Input Anggaran|butir ambigu|belum memiliki PPTK/, label: "Butir anggaran belum ada", hint: "Tambahkan butir di Input Anggaran (unduh “Daftar butir anggaran yang dibutuhkan”, isi pagunya, lalu unggah di Input Anggaran › Impor)." },
  { code: "pptk", test: /PPTK|akun berperan/, label: "PPTK belum ada / tidak cocok", hint: "Buat akun PPTK di Data Master › PPTK (tersedia templat berisi PPTK bawaan), atau cocokkan namanya di kotak pencocokan di bawah." },
  { code: "tahapan", test: /tahapan|draf|belum ada versi/, label: "Tahapan / versi anggaran", hint: "Aktifkan versi anggaran terkait, isi tanggal DPA-nya, atau pastikan butir ada pada versi tahapan tersebut." },
  { code: "pagu", test: /melebihi sisa pagu/, label: "Melebihi pagu", hint: "Naikkan pagu butir pada versi tahapan terkait (Input Anggaran) atau periksa nilai realisasi." },
  { code: "hak", test: /bukan butir penugasan/, label: "Bukan butir penugasan Anda", hint: "Hanya Admin yang dapat mengimpor untuk semua PPTK." },
  { code: "tanggal", test: /tanggal|hari ini|nominal/, label: "Tanggal / nominal tidak valid", hint: "Perbaiki data di berkas sumber (mis. tanggal SP2D lebih awal dari tanggal transaksi)." },
];
export function summarizeReasons(problemRows: { no: string; line: number; message: string }[]): ReasonSummary[] {
  const by = new Map<string, ReasonSummary>();
  for (const r of problemRows) {
    const def = REASONS.find((d) => d.test.test(r.message)) ?? { code: "lain", label: "Lainnya", hint: "Lihat kolom Catatan pada tabel." };
    const cur = by.get(def.code) ?? { code: def.code, label: def.label, hint: def.hint, count: 0, example: `Baris ${r.no || r.line}: ${r.message}` };
    cur.count++; by.set(def.code, cur);
  }
  return [...by.values()].sort((a, b) => b.count - a.count);
}

export const cleanText = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

/* ------------------------------------------------------------------ urai laporan ------------------------------------------------------------------ */

type Col = "no" | "txDate" | "desc" | "subName" | "subCode" | "accName" | "accCode" | "funding" | "method" | "amount" | "sp2dDate" | "pptk" | "supplier";
const ALIASES: Record<Col, string[]> = {
  no: ["no", "nomor"],
  txDate: ["tgl_transaksi", "tanggal_transaksi"],
  desc: ["uraian", "keterangan"],
  subName: ["sub_kegiatan", "nama_sub_kegiatan"],
  subCode: ["kode_sub_kegiatan"],
  accName: ["nama_belanja", "belanja", "nama_rekening"],
  accCode: ["kode_rekening", "kode_belanja"],
  funding: ["sumber_dana", "kode_sumber_dana", "nama_sumber_dana"],
  method: ["metode_pemilihan", "metode_pengadaan", "metode"],
  amount: ["nominal_rp", "nominal", "jumlah", "nilai"],
  sp2dDate: ["tgl_sp2d", "tanggal_sp2d"],
  pptk: ["pptk", "nama_pptk", "username_pptk"],
  supplier: ["penyedia", "nama_penyedia"],
};

export interface RawRow {
  /** Nomor baris pada berkas (urutan sel), untuk pesan galat. */
  line: number; no: string;
  txDate: string | null; sp2dDate: string | null; desc: string;
  subName: string; subCode: string; accName: string; accCode: string; funding: string; method: string; pptk: string; supplier: string;
  amount: number;
  /** Galat bentuk (tanggal/nominal tak terbaca) ditemukan saat mengurai. */
  parseError?: string;
}
export interface Recap { byMethod: { name: string; count: number; amount: number }[]; total: { count: number; amount: number } | null }
export type ParsedReport = { ok: true; rows: RawRow[]; recap: Recap | null } | { ok: false; error: string };

export function parseRealizationReport(table: string[][]): ParsedReport {
  let hi = -1;
  let idx: Partial<Record<Col, number>> = {};
  for (let i = 0; i < table.length; i++) {
    const h = table[i]!.map(normHeader);
    const found: Partial<Record<Col, number>> = {};
    for (const c of Object.keys(ALIASES) as Col[]) for (const a of ALIASES[c]) { const k = h.indexOf(a); if (k !== -1) { found[c] = k; break; } }
    if (found.txDate !== undefined && found.amount !== undefined) { hi = i; idx = found; break; }
  }
  if (hi === -1) return { ok: false, error: 'Baris judul tabel tidak ditemukan. Pastikan ada kolom "Tgl Transaksi" dan "Nominal (Rp)".' };
  const missing: string[] = [];
  if (idx.subName === undefined && idx.subCode === undefined) missing.push("Sub Kegiatan");
  if (idx.accName === undefined && idx.accCode === undefined) missing.push("Nama Belanja");
  if (idx.funding === undefined) missing.push("Sumber Dana");
  if (missing.length) return { ok: false, error: `Kolom wajib tidak ditemukan: ${missing.join(", ")}.` };

  const cell = (r: string[], c: Col) => (idx[c] === undefined ? "" : (r[idx[c]!] ?? "").trim());
  const rows: RawRow[] = [];
  for (let i = hi + 1; i < table.length; i++) {
    const r = table[i]!;
    const no = cell(r, "no");
    // Baris data: bernomor (bila ada kolom No) atau memuat tanggal transaksi; baris lain (catatan kaki) diabaikan.
    const isData = idx.no !== undefined ? /^\d+$/.test(no) : cell(r, "txDate") !== "";
    if (!isData) continue;
    const tx = parseDateFlexible(cell(r, "txDate"));
    const sp = parseDateFlexible(cell(r, "sp2dDate"));
    const amount = parseMoney(cell(r, "amount"));
    const errs: string[] = [];
    if (tx === undefined) errs.push(`tanggal transaksi "${cell(r, "txDate")}" tidak terbaca (gunakan dd/mm/yyyy)`);
    if (sp === undefined) errs.push(`tanggal SP2D "${cell(r, "sp2dDate")}" tidak terbaca (gunakan dd/mm/yyyy)`);
    if (!Number.isFinite(amount)) errs.push(`nominal "${cell(r, "amount")}" tidak terbaca`);
    rows.push({
      line: i + 1, no, txDate: tx ?? null, sp2dDate: sp ?? null, desc: cleanText(cell(r, "desc")).slice(0, 500),
      subName: cleanText(cell(r, "subName")), subCode: cleanText(cell(r, "subCode")), accName: cleanText(cell(r, "accName")), accCode: cleanText(cell(r, "accCode")),
      funding: cleanText(cell(r, "funding")), method: cleanText(cell(r, "method")), pptk: cleanText(cell(r, "pptk")), supplier: cleanText(cell(r, "supplier")),
      amount: Number.isFinite(amount) ? amount : 0, parseError: errs.length ? errs.join("; ") : undefined,
    });
  }
  if (rows.length === 0) return { ok: false, error: "Tidak ada baris transaksi pada berkas." };
  return { ok: true, rows, recap: parseRecap(table.slice(0, hi)) };
}

/** Blok rekap di atas rincian: baris [Metode, Jumlah, Persen, Total Nominal] + baris TOTAL. null bila tidak ada. */
function parseRecap(top: string[][]): Recap | null {
  const hi = top.findIndex((r) => r.some((c) => normHeader(c) === "metode_pemilihan") && r.some((c) => /jumlah/i.test(c)));
  if (hi === -1) return null;
  const head = top[hi]!.map(normHeader);
  const ci = head.findIndex((h) => h.startsWith("jumlah"));
  const ai = head.findIndex((h) => h.startsWith("total_nominal") || h === "nominal");
  if (ci === -1 || ai === -1) return null;
  const byMethod: Recap["byMethod"] = [];
  let total: Recap["total"] = null;
  for (const r of top.slice(hi + 1)) {
    const name = cleanText(r[0] ?? "");
    if (!name) continue;
    const count = Number((r[ci] ?? "").replace(/\D/g, ""));
    const amount = parseMoney(r[ai] ?? "");
    if (!Number.isFinite(count) || !Number.isFinite(amount)) continue;
    if (name.toLowerCase() === "total") total = { count, amount }; else byMethod.push({ name, count, amount });
  }
  return byMethod.length || total ? { byMethod, total } : null;
}

export interface Reconciliation { ok: boolean; notes: string[] }
const cents = (n: number) => Math.round(n * 100);

/** Mencocokkan rekap di berkas dengan hasil penguraian rincian (jumlah & nominal total serta per metode). */
export function reconcileRecap(rows: RawRow[], recap: Recap | null): Reconciliation {
  if (!recap) return { ok: true, notes: ["Berkas tidak memuat rekap; rekonsiliasi dilewati."] };
  const notes: string[] = [];
  const sum = rows.reduce((a, r) => a + cents(r.amount), 0);
  if (recap.total) {
    if (recap.total.count !== rows.length) notes.push(`Jumlah transaksi pada rekap ${recap.total.count}, pada rincian ${rows.length}.`);
    if (cents(recap.total.amount) !== sum) notes.push(`Total nominal pada rekap ${recap.total.amount.toLocaleString("id-ID")}, pada rincian ${(sum / 100).toLocaleString("id-ID")}.`);
  }
  for (const m of recap.byMethod) {
    const mine = rows.filter((r) => normName(r.method) === normName(m.name));
    const amt = mine.reduce((a, r) => a + cents(r.amount), 0);
    if (mine.length !== m.count || amt !== cents(m.amount)) notes.push(`Metode "${m.name}": rekap ${m.count} transaksi / ${m.amount.toLocaleString("id-ID")}, rincian ${mine.length} / ${(amt / 100).toLocaleString("id-ID")}.`);
  }
  return notes.length ? { ok: false, notes } : { ok: true, notes: [`Rekap cocok dengan rincian: ${rows.length} transaksi, total ${(sum / 100).toLocaleString("id-ID")}.`] };
}

/* ------------------------------------------------------------------ tahapan berdasarkan tanggal DPA ------------------------------------------------------------------ */

export type StageCode = "murni" | "pergeseran" | "perubahan";
export interface StageVersion { id: string; stage: StageCode; versionNo: number; status: string; dpaDate: string | null }
const SEQ: Record<StageCode, number> = { murni: 1, pergeseran: 2, perubahan: 3 };
const NAME: Record<StageCode, string> = { murni: "Murni", pergeseran: "Pergeseran", perubahan: "Perubahan" };
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

export function versionLabel(v: StageVersion, all: StageVersion[]): string {
  const peers = all.filter((p) => p.stage === v.stage).sort((a, b) => a.versionNo - b.versionNo);
  const rank = peers.findIndex((p) => p.id === v.id) + 1;
  return v.stage === "pergeseran" || peers.length > 1 ? `${NAME[v.stage]} ${ROMAN[rank - 1] ?? rank}` : NAME[v.stage];
}

/**
 * Cermin persis dari public.stage_version_for_date (migrasi 0014): versi ber-DPA dengan tanggal DPA terbesar yang <= tanggal
 * (sama tanggal: Murni < Pergeseran < Perubahan, lalu nomor versi); bila belum ada DPA yang berlaku -> versi Murni (effective=false).
 * Versi draf ikut dipertimbangkan agar tidak diam-diam jatuh ke tahapan sebelumnya; pemanggil menolak versi draf.
 */
export function stageForDate(versions: StageVersion[], date: string): { version: StageVersion | null; effective: boolean } {
  const key = (v: StageVersion) => `${v.dpaDate}|${SEQ[v.stage]}|${String(v.versionNo).padStart(5, "0")}`;
  const eff = versions.filter((v) => v.dpaDate && v.dpaDate <= date).sort((a, b) => (key(a) < key(b) ? 1 : -1))[0];
  if (eff) return { version: eff, effective: true };
  const murni = versions.filter((v) => v.stage === "murni").sort((a, b) => b.versionNo - a.versionNo)[0] ?? null;
  return { version: murni, effective: false };
}

/* ------------------------------------------------------------------ pencocokan & validasi ------------------------------------------------------------------ */

export interface BudgetItemRef { id: string; subId: string; accId: string; fundId: string; pptkId: string | null; description: string | null; hasRup: boolean }
export interface MasterMaps {
  look: Lookups;                               // sub/akun menurut KODE + sumber dana + PPTK
  subsByName: Map<string, string[]>;           // nama (normal) -> id[]
  accsByName: Map<string, string[]>;
  items: BudgetItemRef[];
  itemsInVersion: Map<string, Set<string>>;    // versionId -> itemId
  paguByVersionItem: Map<string, { pagu: number; used: number }>; // "versionId|itemId" -> pagu & terpakai (realisasi sah + menunggu SP2D)
}
export interface PlanOptions {
  versions: StageVersion[]; year: number; today: string; basis: "transaksi" | "sp2d";
  /** Pengguna: Admin boleh semua butir; PPTK hanya butirnya. */
  userId: string; isAdmin: boolean;
  existingKeys: Set<string>;
  /** Transaksi aktif yang sudah ada: "itemId|tanggal|sen" -> jumlah (deteksi input manual yang sama). */
  existingSimilar: Set<string>;
  includeSimilar: boolean;
}

export type RowStatus = "baru" | "ada" | "mirip" | "galat";
export interface PlannedRow {
  index: number; line: number; no: string; status: RowStatus; message: string;
  txDate: string | null; sp2dDate: string | null; amount: number; desc: string;
  sub: string; account: string; funding: string; pptk: string; method: string;
  itemId?: string; versionId?: string; stageLabel?: string; stage?: StageCode; importKey?: string;
  /** Tanggal transaksi dan SP2D jatuh pada tahapan berbeda (lintas DPA). */
  straddle?: boolean; notes: string[];
  /** Diisi bila butir anggaran belum ada: kombinasi master yang dibutuhkan (untuk daftar butir yang perlu dibuat). */
  missingItem?: { subId: string; accId: string; fundId: string; pptkId: string | null };
}
export interface StageTally { label: string; stage: StageCode; versionId: string; dpaDate: string | null; count: number; amount: number }
export interface PlanOutcome {
  rows: PlannedRow[]; counts: Record<RowStatus, number>; total: { count: number; amount: number };
  byStage: StageTally[]; straddle: number; problems: string[]; reasons: ReasonSummary[];
}

const uniq = (m: Map<string, string[]>, k: string): string | null | undefined => { const v = m.get(k); return !v ? undefined : v.length === 1 ? v[0]! : null; };

/** Kunci bahan identitas baris (di-hash di sisi server): butir + tanggal transaksi + nilai + urutan kemunculan identik dalam berkas. */
export const keyMaterial = (itemId: string, txDate: string, amount: number, occurrence: number) => `${itemId}|${txDate}|${cents(amount)}|${occurrence}`;

export function planRealizationImport(raw: RawRow[], maps: MasterMaps, opt: PlanOptions): PlanOutcome {
  const rows: PlannedRow[] = [];
  const problems: string[] = [];
  const occ = new Map<string, number>();
  const running = new Map<string, number>(); // "versionId|itemId" -> tambahan dari berkas ini

  raw.forEach((r, index) => {
    const base = {
      index, line: r.line, no: r.no, txDate: r.txDate, sp2dDate: r.sp2dDate, amount: r.amount, desc: r.desc,
      sub: r.subName || r.subCode, account: r.accName || r.accCode, funding: r.funding, pptk: r.pptk, method: r.method, notes: [] as string[],
    };
    const fail = (msg: string, extra: Partial<PlannedRow> = {}) => {
      problems.push(`Baris ${r.no || r.line}: ${msg}`);
      rows.push({ ...base, ...extra, status: "galat", message: msg });
    };
    if (r.parseError) return fail(r.parseError);

    // --- tanggal & nilai (sama dengan aturan basis data) ---
    if (!r.txDate) return fail("tanggal transaksi kosong");
    if (Number(r.txDate.slice(0, 4)) !== opt.year) return fail(`tanggal transaksi ${r.txDate} di luar tahun anggaran ${opt.year}`);
    if (r.txDate > opt.today) return fail(`tanggal transaksi ${r.txDate} melebihi hari ini`);
    if (r.sp2dDate) {
      if (Number(r.sp2dDate.slice(0, 4)) !== opt.year) return fail(`tanggal SP2D ${r.sp2dDate} di luar tahun anggaran ${opt.year}`);
      if (r.sp2dDate > opt.today) return fail(`tanggal SP2D ${r.sp2dDate} melebihi hari ini`);
      if (r.txDate > r.sp2dDate) return fail(`tanggal transaksi ${r.txDate} setelah tanggal SP2D ${r.sp2dDate} (periksa salah ketik tanggal)`);
    }
    if (!(r.amount > 0)) return fail("nominal harus lebih dari nol");
    if (Math.abs(r.amount * 100 - Math.round(r.amount * 100)) > 1e-6) return fail("nominal maksimal dua desimal");

    // --- sub kegiatan, belanja, sumber dana, PPTK ---
    let subId: string | null | undefined = r.subCode ? maps.look.subs.get(r.subCode.toLowerCase()) : undefined;
    if (!subId && r.subName) subId = uniq(maps.subsByName, normName(r.subName));
    if (!subId) return fail(subId === null ? `sub kegiatan "${r.subName}" ambigu (nama sama pada beberapa kode); isi kolom kode_sub_kegiatan` : `sub kegiatan "${r.subName || r.subCode}" tidak ditemukan di Data Master`);
    let accId: string | null | undefined = r.accCode ? maps.look.accounts.get(r.accCode.toLowerCase()) : undefined;
    if (!accId && r.accName) accId = uniq(maps.accsByName, normName(r.accName));
    if (!accId) return fail(accId === null ? `belanja "${r.accName}" ambigu; isi kolom kode_rekening` : `belanja "${r.accName || r.accCode}" tidak ditemukan di Data Master`);
    const fundId = maps.look.fundingByCode.get(r.funding.toLowerCase()) ?? maps.look.fundingByName.get(normName(r.funding));
    if (!fundId) return fail(`sumber dana "${r.funding}" tidak ditemukan di Data Master`);
    let pptkId: string | null = null;
    let pptkUnresolved = false;
    if (r.pptk) {
      const p = resolvePptk(r.pptk, maps.look);
      if (p.ok) pptkId = p.id;
      // Admin: realisasi melekat pada BUTIR (bukan pada akun PPTK), jadi nama PPTK yang belum punya akun tidak memblokir; hanya dicatat.
      else if (opt.isAdmin) pptkUnresolved = true;
      else return fail(p.reason);
    }

    // --- butir anggaran ---
    let cand = maps.items.filter((i) => !i.hasRup && i.subId === subId && i.accId === accId && i.fundId === fundId);
    if (cand.length === 0) return fail("butir anggaran (sub kegiatan + belanja + sumber dana) belum ada di Input Anggaran", { missingItem: { subId: subId!, accId: accId!, fundId, pptkId } });
    let pptkMismatch = false;
    if (pptkId) {
      const mine = cand.filter((i) => i.pptkId === pptkId);
      if (mine.length > 0) cand = mine;
      // Satu butir hanya punya satu PPTK, sedangkan laporan dapat memuat PPTK berbeda pada kombinasi yang sama. Bila hanya ada SATU kandidat,
      // realisasi tetap melekat pada butir itu (dicatat sebagai catatan); bila ada beberapa butir dan tidak ada yang cocok -> ditolak.
      else if (cand.length === 1) pptkMismatch = true;
      else return fail(`ada ${cand.length} butir untuk kombinasi ini dan tidak ada yang ditugaskan ke PPTK "${r.pptk}"; samakan penugasan PPTK di Input Anggaran atau perbaiki berkas`);
    }
    if (cand.length > 1) return fail(`butir ambigu (${cand.length} butir dengan sub kegiatan + belanja + sumber dana${pptkId ? " + PPTK" : ""} yang sama)${pptkUnresolved ? `; PPTK "${r.pptk}" belum punya akun sehingga tidak dapat membedakan — buat akun PPTK lebih dulu` : "; isi kolom PPTK atau bedakan uraian butir"}`);
    const item = cand[0]!;
    if (!opt.isAdmin && item.pptkId !== opt.userId) return fail("bukan butir penugasan Anda (hanya Admin yang dapat mengimpor untuk semua PPTK)", { itemId: item.id });
    if (!item.pptkId && !opt.isAdmin) return fail("butir belum memiliki PPTK penugasan", { itemId: item.id });

    // --- tahapan menurut tanggal DPA ---
    const stageDate = opt.basis === "sp2d" && r.sp2dDate ? r.sp2dDate : r.txDate;
    const st = stageForDate(opt.versions, stageDate);
    if (!st.version) return fail(`belum ada versi anggaran untuk tanggal ${stageDate}`);
    const label = versionLabel(st.version, opt.versions);
    if (st.version.status === "draft") return fail(`tahapan ${label} untuk tanggal ${stageDate} masih berstatus draf; aktifkan/tetapkan versinya lebih dulu`, { itemId: item.id });
    const inV = maps.itemsInVersion.get(st.version.id);
    if (!inV || !inV.has(item.id)) return fail(`butir tidak ada pada tahapan ${label} (tanggal ${stageDate}); tambahkan butir pada versi tersebut atau periksa tanggal`, { itemId: item.id, stageLabel: label });
    const other = opt.basis === "sp2d" ? r.txDate : r.sp2dDate;
    const otherSt = other ? stageForDate(opt.versions, other).version : null;
    const straddle = !!(otherSt && otherSt.id !== st.version.id);
    const notes: string[] = [];
    if (pptkMismatch) notes.push(`PPTK pada berkas (${r.pptk}) berbeda dari PPTK penugasan butir; realisasi tetap melekat pada butir`);
    if (pptkUnresolved) notes.push(`PPTK "${r.pptk}" belum terdaftar sebagai akun (realisasi tetap tersimpan pada butir)`);
    if (!st.effective) notes.push("tanggal sebelum DPA pertama berlaku; dimasukkan ke Murni");
    if (straddle) notes.push(`transaksi dan SP2D berbeda tahapan (${opt.basis === "sp2d" ? "tanggal transaksi" : "tanggal SP2D"} jatuh pada ${versionLabel(otherSt!, opt.versions)})`);

    // --- idempotensi & kemiripan ---
    const o = (occ.get(`${item.id}|${r.txDate}|${cents(r.amount)}`) ?? 0) + 1;
    occ.set(`${item.id}|${r.txDate}|${cents(r.amount)}`, o);
    const material = keyMaterial(item.id, r.txDate, r.amount, o);
    const common = { ...base, notes, itemId: item.id, versionId: st.version.id, stageLabel: label, stage: st.version.stage, importKey: material, straddle };

    if (opt.existingKeys.has(material)) { rows.push({ ...common, status: "ada", message: "Sudah pernah diimpor (kunci sama); dilewati" }); return; }
    if (!opt.includeSimilar && opt.existingSimilar.has(`${item.id}|${r.txDate}|${cents(r.amount)}`)) {
      rows.push({ ...common, status: "mirip", message: "Sudah ada transaksi dengan butir, tanggal, dan nilai yang sama (mungkin input manual); dilewati" });
      return;
    }

    // --- pagu (pemeriksaan awal; basis data tetap menegakkan) ---
    const pk = `${st.version.id}|${item.id}`;
    const pv = maps.paguByVersionItem.get(pk);
    if (pv) {
      const add = running.get(pk) ?? 0;
      const sisa = pv.pagu - pv.used - add;
      if (cents(r.amount) > cents(sisa)) return fail(`melebihi sisa pagu butir pada ${label} (sisa ${Math.max(0, sisa).toLocaleString("id-ID")}, nilai ${r.amount.toLocaleString("id-ID")})`, { itemId: item.id, stageLabel: label, versionId: st.version.id });
      running.set(pk, add + r.amount);
    }
    rows.push({ ...common, status: "baru", message: r.sp2dDate ? "Realisasi sah (ber-SP2D)" : "Belum SP2D (menunggu tanggal SP2D)" });
  });

  const counts: Record<RowStatus, number> = { baru: 0, ada: 0, mirip: 0, galat: 0 };
  const stageMap = new Map<string, StageTally>();
  let totalAmt = 0;
  for (const r of rows) {
    counts[r.status]++;
    if (r.status === "baru" && r.versionId && r.stage && r.stageLabel) {
      const t = stageMap.get(r.versionId) ?? { label: r.stageLabel, stage: r.stage, versionId: r.versionId, dpaDate: opt.versions.find((v) => v.id === r.versionId)?.dpaDate ?? null, count: 0, amount: 0 };
      t.count++; t.amount += cents(r.amount) / 100; stageMap.set(r.versionId, t);
      totalAmt += cents(r.amount);
    }
  }
  const byStage = [...stageMap.values()].sort((a, b) => SEQ[a.stage] - SEQ[b.stage] || (a.dpaDate ?? "").localeCompare(b.dpaDate ?? ""));
  return { rows, counts, total: { count: counts.baru, amount: totalAmt / 100 }, byStage, straddle: rows.filter((r) => r.status === "baru" && r.straddle).length, problems, reasons: summarizeReasons(rows.filter((r) => r.status === "galat")) };
}

/* ------------------------------------------------------------------ metode pengadaan ------------------------------------------------------------------ */

export interface MethodRef { id: string; code: string; name: string }
export interface MethodGuess { fileName: string; count: number; amount: number; resolvedId: string | null; candidates: MethodRef[] }

/** Nama metode berkas -> metode master: persis; atau awalan unik ("e-Purchasing" -> "E-Purchasing (Katalog Elektronik)"); ambigu/tidak ada -> null + kandidat. */
export function guessMethods(rows: { method: string; amount: number }[], methods: MethodRef[]): MethodGuess[] {
  const by = new Map<string, { count: number; amount: number; name: string }>();
  for (const r of rows) {
    if (!r.method) continue;
    const k = normName(r.method);
    const e = by.get(k) ?? { count: 0, amount: 0, name: r.method };
    e.count++; e.amount += r.amount; by.set(k, e);
  }
  const out: MethodGuess[] = [];
  for (const [k, e] of by) {
    const exact = methods.filter((m) => normName(m.name) === k || normName(m.code) === k);
    const prefix = methods.filter((m) => normName(m.name).startsWith(k));
    const pick = exact.length === 1 ? exact : exact.length === 0 && prefix.length === 1 ? prefix : [];
    out.push({ fileName: e.name, count: e.count, amount: Math.round(e.amount * 100) / 100, resolvedId: pick[0]?.id ?? null, candidates: prefix.length > 1 ? prefix : [] });
  }
  return out.sort((a, b) => b.count - a.count);
}

/** Nama pada berkas yang belum dikenali: pengguna dapat memetakannya ke entri master. */
export interface UnresolvedName { kind: "sub" | "acc" | "fund" | "pptk"; name: string; count: number; suggestions: { id: string; label: string }[]; options: { id: string; label: string }[] }

/* ------------------------------------------------------------------ keadaan antarmuka ------------------------------------------------------------------ */

export interface RealizationImportState {
  phase?: "idle" | "preview" | "done" | "error";
  error?: string;
  fileName?: string;
  reconcile?: Reconciliation;
  counts?: Record<RowStatus, number>;
  total?: { count: number; amount: number };
  byStage?: StageTally[];
  straddle?: number;
  versions?: { label: string; dpaDate: string | null; status: string }[];
  reasons?: ReasonSummary[];
  pptkWithoutAccount?: { name: string; count: number }[];
  unresolved?: UnresolvedName[];
  neededItems?: { subCode: string; accCode: string; fund: string; pptk: string; rows: number; total: number }[];
  methods?: MethodGuess[];
  methodOptions?: MethodRef[];
  canCreateMethods?: boolean;
  rows?: PlannedRow[];
  truncated?: boolean;
  applied?: { imported: number; skipped: number; gagal: string[]; batchId: string | null; amount: number };
}
