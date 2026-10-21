import { normHeader } from "@/lib/header";
import { parseMoney } from "@/lib/csv";

/**
 * Inti impor/penyesuaian Input Anggaran (murni, tanpa akses database; dapat diuji).
 *
 * Kolom berkas (urutan bebas, nama kolom longgar):
 *  - kode_sub_kegiatan      (wajib)
 *  - kode_rekening          (wajib; alias kode_belanja)
 *  - sumber_dana            (wajib; boleh KODE atau NAMA, mis. "PAD" / "DBH CHT"; alias kode_sumber_dana, nama_sumber_dana)
 *  - pptk                   (opsional; boleh USERNAME atau NAMA LENGKAP; alias username_pptk, nama_pptk)
 *  - uraian                 (opsional)
 *  - pagu                   (wajib)
 *  - tahun, tahapan         (opsional; bila ada WAJIB sama dengan versi tujuan agar tidak salah tahun/tahapan)
 */
export type BudgetCol = "sub" | "account" | "funding" | "pptk" | "desc" | "pagu" | "year" | "stage";

const ALIASES: Record<BudgetCol, string[]> = {
  sub: ["kode_sub_kegiatan", "kode_subkegiatan", "sub_kegiatan_kode"],
  account: ["kode_rekening", "kode_belanja", "kode_rek", "rekening"],
  funding: ["sumber_dana", "kode_sumber_dana", "nama_sumber_dana"],
  pptk: ["pptk", "username_pptk", "nama_pptk"],
  desc: ["uraian", "keterangan"],
  pagu: ["pagu", "anggaran", "jumlah"],
  year: ["tahun", "tahun_anggaran"],
  stage: ["tahapan", "tahapan_anggaran"],
};
const REQUIRED: BudgetCol[] = ["sub", "account", "funding", "pagu"];
const LABEL: Record<BudgetCol, string> = {
  sub: "kode_sub_kegiatan", account: "kode_rekening", funding: "sumber_dana", pptk: "pptk", desc: "uraian", pagu: "pagu", year: "tahun", stage: "tahapan",
};

export interface HeaderResult { idx: Partial<Record<BudgetCol, number>>; problems: string[] }

export function resolveBudgetHeaders(headerRow: string[]): HeaderResult {
  const header = headerRow.map(normHeader);
  const idx: Partial<Record<BudgetCol, number>> = {};
  for (const col of Object.keys(ALIASES) as BudgetCol[]) {
    // Prioritaskan urutan alias (nama utama lebih dulu), bukan urutan kolom pada berkas.
    for (const a of ALIASES[col]) {
      const i = header.indexOf(a);
      if (i !== -1) { idx[col] = i; break; }
    }
  }
  const problems = REQUIRED.filter((c) => idx[c] === undefined).map((c) => `Kolom wajib "${LABEL[c]}" tidak ditemukan pada baris pertama.`);
  return { idx, problems };
}

/** Nama dibakukan untuk pencocokan: huruf kecil, spasi tunggal, tanda baca di sekitar gelar disamakan. */
export const normName = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").trim();
const baseName = (s: string) => normName(s.split(",")[0] ?? "");

export interface Lookups {
  subs: Map<string, string>;       // kode (lower) -> id
  accounts: Map<string, string>;   // kode (lower) -> id
  fundingByCode: Map<string, string>;
  fundingByName: Map<string, string>;
  pptkByUsername: Map<string, string>;
  pptk: { id: string; fullName: string }[];
}

export type Resolve = { ok: true; id: string } | { ok: false; reason: string };

export function resolveFunding(v: string, l: Lookups): Resolve {
  const key = v.trim().toLowerCase();
  const id = l.fundingByCode.get(key) ?? l.fundingByName.get(normName(v));
  return id ? { ok: true, id } : { ok: false, reason: `sumber dana "${v}" tidak ditemukan (isi dengan kode atau nama persis seperti di Data Master)` };
}

/** PPTK: username dulu; lalu nama lengkap persis; lalu nama tanpa gelar bila hanya satu yang cocok. */
export function resolvePptk(v: string, l: Lookups): Resolve {
  const raw = v.trim();
  const u = l.pptkByUsername.get(raw.toLowerCase());
  if (u) return { ok: true, id: u };
  const full = normName(raw);
  const exact = l.pptk.filter((p) => normName(p.fullName) === full);
  if (exact.length === 1) return { ok: true, id: exact[0]!.id };
  if (exact.length > 1) return { ok: false, reason: `PPTK "${v}" cocok dengan lebih dari satu akun; gunakan username` };
  const base = baseName(raw);
  const loose = base ? l.pptk.filter((p) => baseName(p.fullName) === base) : [];
  if (loose.length === 1) return { ok: true, id: loose[0]!.id };
  if (loose.length > 1) return { ok: false, reason: `PPTK "${v}" cocok dengan lebih dari satu akun; gunakan username` };
  return { ok: false, reason: `PPTK "${v}" tidak ditemukan sebagai akun berperan PPTK (buat dulu di Data Master › PPTK)` };
}

export interface ExistingItem { itemId: string; pagu: number; pptkId: string | null }
/** Kunci identitas butir (sama dengan identitas di add_budget_item): sub + rekening + sumber dana + uraian. */
export const itemKey = (sub: string, acct: string, fund: string, desc: string | null) => `${sub}|${acct}|${fund}|${(desc ?? "").trim()}`;

export type RowStatus = "baru" | "ubah" | "sama" | "lewati" | "galat";
export interface PlannedRow {
  line: number; status: RowStatus; message: string;
  subCode: string; accountCode: string; funding: string; pptkText: string; desc: string | null;
  pagu: number; oldPagu: number | null;
  subId?: string; accountId?: string; fundingId?: string; pptkId?: string | null;
  itemId?: string; pptkChange?: boolean;
}
export interface PlanOutcome { rows: PlannedRow[]; problems: string[]; counts: Record<RowStatus, number> }

export interface PlanOptions { mode: "tambah_perbarui" | "tambah_saja"; targetYear: number; targetStage: string }

const cent = (n: number) => Math.round(n * 100);

export function planBudgetImport(table: string[][], idx: Partial<Record<BudgetCol, number>>, look: Lookups, existing: Map<string, ExistingItem>, opt: PlanOptions): PlanOutcome {
  const data = table.slice(1);
  const problems: string[] = [];
  const rows: PlannedRow[] = [];
  const seen = new Map<string, number>();
  const cell = (r: string[], c: BudgetCol) => (idx[c] === undefined ? "" : (r[idx[c]!] ?? "").trim());

  data.forEach((r, i) => {
    const line = i + 2;
    const errs: string[] = [];
    const subCode = cell(r, "sub"), accountCode = cell(r, "account"), funding = cell(r, "funding"), pptkText = cell(r, "pptk");
    const desc = cell(r, "desc") || null;
    const pagu = parseMoney(cell(r, "pagu"));

    const subId = look.subs.get(subCode.toLowerCase());
    const accountId = look.accounts.get(accountCode.toLowerCase());
    if (!subCode) errs.push("kode sub kegiatan kosong"); else if (!subId) errs.push(`kode sub kegiatan "${subCode}" tidak ditemukan`);
    if (!accountCode) errs.push("kode rekening kosong"); else if (!accountId) errs.push(`kode rekening "${accountCode}" tidak ditemukan`);
    const f = funding ? resolveFunding(funding, look) : ({ ok: false, reason: "sumber dana kosong" } as Resolve);
    if (!f.ok) errs.push(f.reason);
    let pptkId: string | null = null;
    if (pptkText) { const p = resolvePptk(pptkText, look); if (p.ok) pptkId = p.id; else errs.push(p.reason); }
    if (!Number.isFinite(pagu) || pagu < 0) errs.push("pagu tidak valid (harus angka nol atau lebih)");
    if (idx.year !== undefined && cell(r, "year") !== "" && Number(cell(r, "year")) !== opt.targetYear) errs.push(`tahun pada berkas (${cell(r, "year")}) berbeda dari versi tujuan (${opt.targetYear})`);
    if (idx.stage !== undefined && cell(r, "stage") !== "" && cell(r, "stage").toLowerCase() !== opt.targetStage.toLowerCase()) errs.push(`tahapan pada berkas (${cell(r, "stage")}) berbeda dari versi tujuan (${opt.targetStage})`);

    const base = { line, subCode, accountCode, funding, pptkText, desc, pagu: Number.isFinite(pagu) ? pagu : 0, oldPagu: null as number | null };
    if (errs.length || !subId || !accountId || !f.ok) {
      const msg = errs.join("; ");
      problems.push(`Baris ${line}: ${msg}`);
      rows.push({ ...base, status: "galat", message: msg });
      return;
    }
    const key = itemKey(subId, accountId, f.id, desc);
    if (seen.has(key)) {
      const msg = `butir ganda dengan baris ${seen.get(key)} (sub kegiatan + rekening + sumber dana + uraian sama)`;
      problems.push(`Baris ${line}: ${msg}`);
      rows.push({ ...base, status: "galat", message: msg });
      return;
    }
    seen.set(key, line);

    const ex = existing.get(key);
    const common = { ...base, subId, accountId, fundingId: f.id, pptkId };
    if (!ex) { rows.push({ ...common, status: "baru", message: "Butir baru ditambahkan" }); return; }
    if (opt.mode === "tambah_saja") { rows.push({ ...common, itemId: ex.itemId, oldPagu: ex.pagu, status: "lewati", message: "Sudah ada pada versi ini (mode hanya tambah)" }); return; }
    const paguChanged = cent(ex.pagu) !== cent(pagu);
    const pptkChange = pptkId !== null && pptkId !== ex.pptkId;
    if (!paguChanged && !pptkChange) { rows.push({ ...common, itemId: ex.itemId, oldPagu: ex.pagu, status: "sama", message: "Tidak ada perubahan" }); return; }
    rows.push({
      ...common, itemId: ex.itemId, oldPagu: ex.pagu, pptkChange, status: "ubah",
      message: [paguChanged ? "Pagu disesuaikan" : "", pptkChange ? "PPTK ditugaskan/diganti" : ""].filter(Boolean).join("; "),
    });
  });

  const counts: Record<RowStatus, number> = { baru: 0, ubah: 0, sama: 0, lewati: 0, galat: 0 };
  for (const r of rows) counts[r.status]++;
  return { rows, problems, counts };
}

/** Keadaan yang dikembalikan aksi server ke panel impor (periksa dulu -> terapkan). */
export interface BudgetImportState {
  phase?: "idle" | "preview" | "done" | "error";
  error?: string;
  target?: string;
  counts?: Record<RowStatus, number>;
  rows?: PlannedRow[];
  truncated?: boolean;
  applied?: { baru: number; ubah: number; gagal: string[] };
}
