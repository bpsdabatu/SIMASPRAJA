"use server";

import { requireModule } from "@/lib/auth/guard";
import { userClient } from "@/lib/supabase/server";
import { flashRedirect } from "@/lib/flash";
import { friendlyError, isUuid, num, optStr, runAction, str, uuidOrNull } from "@/lib/action-utils";
import { parseCsv, parseMoney } from "@/lib/csv";
import { readTable } from "@/lib/spreadsheet";
import { STAGES, STAGE_LABEL } from "@/lib/auth/context";
import { isIsoDate } from "@/lib/reports";
import { revalidatePath } from "next/cache";
import { fetchAll } from "@/lib/fetch-all";
import {
  itemKey, planBudgetImport, resolveBudgetHeaders, type BudgetImportState, type ExistingItem, type Lookups,
} from "@/lib/budget-import-core";

const BACK = "/anggaran";

export async function createVersionAction(fd: FormData): Promise<void> {
  await requireModule("budget.edit");
  const year = Number(str(fd, "year", 6));
  const stage = str(fd, "stage", 20);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) flashRedirect(BACK, { err: "Tahun anggaran tidak valid." });
  if (!(STAGES as readonly string[]).includes(stage)) flashRedirect(BACK, { err: "Tahapan anggaran tidak valid." });
  const copy = uuidOrNull(fd, "copyFrom");
  const supabase = await userClient();
  return runAction(BACK, "Versi anggaran dibuat berstatus draf. Pilih konteks (menu Ganti) untuk membukanya.", async () =>
    supabase.rpc("create_budget_version", { p_year: year, p_stage: stage, p_note: optStr(fd, "note", 300), p_copy_from: copy }),
  );
}

export async function setVersionStatusAction(fd: FormData): Promise<void> {
  await requireModule("budget.edit");
  const id = str(fd, "versionId", 40);
  const to = str(fd, "to", 10);
  if (!isUuid(id) || !["active", "final"].includes(to)) flashRedirect(BACK, { err: "Permintaan tidak valid." });
  const supabase = await userClient();
  return runAction(BACK, to === "final" ? "Versi anggaran difinalisasi dan tidak dapat diubah lagi." : "Versi anggaran diaktifkan.", async () =>
    supabase.rpc("set_budget_version_status", { p_version: id, p_to: to }),
  );
}

/** Mengisi / mengoreksi tanggal penetapan DPA suatu versi (penentu tahapan berlaku pada LRA). Koreksi wajib beralasan (divalidasi database). */
export async function setVersionDpaDateAction(fd: FormData): Promise<void> {
  await requireModule("budget.edit");
  const id = str(fd, "versionId", 40);
  const date = str(fd, "dpaDate", 10);
  if (!isUuid(id) || !isIsoDate(date)) flashRedirect(BACK, { err: "Versi atau tanggal DPA tidak valid." });
  const supabase = await userClient();
  return runAction(BACK, "Tanggal DPA disimpan.", async () =>
    supabase.rpc("set_budget_version_dpa_date", { p_version: id, p_date: date, p_reason: optStr(fd, "reason", 300) }),
  );
}

async function currentVersion(fd: FormData) {
  const { context } = await requireModule("budget.edit");
  const v = str(fd, "versionId", 40);
  if (v !== context.versionId) flashRedirect(BACK, { err: "Konteks anggaran berubah. Muat ulang halaman lalu ulangi." });
  return context.versionId;
}

export async function addItemAction(fd: FormData): Promise<void> {
  const versionId = await currentVersion(fd);
  const pagu = num(fd, "pagu");
  const sub = str(fd, "subActivity", 40), acct = str(fd, "account", 40), fund = str(fd, "funding", 40);
  if (![sub, acct, fund].every(isUuid)) flashRedirect(BACK, { err: "Sub kegiatan, rekening, dan sumber dana wajib dipilih." });
  if (!Number.isFinite(pagu) || pagu < 0) flashRedirect(BACK, { err: "Pagu harus berupa angka nol atau lebih." });
  const supabase = await userClient();
  return runAction(BACK, "Butir anggaran ditambahkan.", async () =>
    supabase.rpc("add_budget_item", {
      p_version: versionId, p_sub_activity: sub, p_account: acct, p_funding: fund,
      p_pptk: uuidOrNull(fd, "pptk"), p_description: optStr(fd, "description", 500), p_pagu: pagu,
    }),
  );
}

export async function updatePaguAction(fd: FormData): Promise<void> {
  const versionId = await currentVersion(fd);
  const item = str(fd, "itemId", 40);
  const pagu = num(fd, "pagu");
  if (!isUuid(item)) flashRedirect(BACK, { err: "Butir tidak valid." });
  if (!Number.isFinite(pagu) || pagu < 0) flashRedirect(BACK, { err: "Pagu harus berupa angka nol atau lebih." });
  const supabase = await userClient();
  return runAction(BACK, "Pagu diperbarui.", async () =>
    supabase.rpc("update_item_pagu", { p_version: versionId, p_item: item, p_pagu: pagu, p_note: optStr(fd, "note", 300) }),
  );
}

export async function assignPptkAction(fd: FormData): Promise<void> {
  await currentVersion(fd);
  const item = str(fd, "itemId", 40);
  if (!isUuid(item)) flashRedirect(BACK, { err: "Butir tidak valid." });
  const supabase = await userClient();
  return runAction(BACK, "Penugasan PPTK diperbarui.", async () =>
    supabase.from("budget_items").update({ pptk_id: uuidOrNull(fd, "pptk") }).eq("id", item),
  );
}

const IMPORT_HEADERS = ["kode_sub_kegiatan", "kode_rekening", "kode_sumber_dana", "username_pptk", "uraian", "pagu"];
const MAX_IMPORT_BYTES = 1_000_000;

/* ======================= Tambahan: tahun anggaran, ubah & hapus butir ======================= */

export async function addFiscalYearAction(fd: FormData): Promise<void> {
  await requireModule("budget.edit");
  const year = Number(str(fd, "year", 6));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) flashRedirect(BACK, { err: "Tahun anggaran tidak valid." });
  const supabase = await userClient();
  const { data: existing } = await supabase.from("fiscal_years").select("id").eq("year", year).maybeSingle();
  if (existing) flashRedirect(BACK, { err: `Tahun anggaran ${year} sudah ada. Gunakan "Buat versi baru" untuk menambah tahapan.` });
  return runAction(BACK, `Tahun anggaran ${year} ditambahkan dengan versi Murni (draf). Aktifkan versi, lalu pilih konteks (menu Ganti) untuk membukanya.`, async () =>
    supabase.rpc("create_budget_version", { p_year: year, p_stage: "murni", p_note: optStr(fd, "note", 300), p_copy_from: null }),
  );
}

export async function updateItemDetailAction(fd: FormData): Promise<void> {
  const versionId = await currentVersion(fd);
  const item = str(fd, "itemId", 40);
  const sub = str(fd, "subActivity", 40), acct = str(fd, "account", 40), fund = str(fd, "funding", 40);
  if (![item, sub, acct, fund].every(isUuid)) flashRedirect(BACK, { err: "Sub kegiatan, rekening, dan sumber dana wajib dipilih." });
  const supabase = await userClient();
  return runAction(BACK, "Rincian butir anggaran diperbarui.", async () =>
    supabase.rpc("update_budget_item", { p_version: versionId, p_item: item, p_sub_activity: sub, p_account: acct, p_funding: fund, p_description: optStr(fd, "description", 500) }),
  );
}

export async function deleteItemAction(fd: FormData): Promise<void> {
  const versionId = await currentVersion(fd);
  const item = str(fd, "itemId", 40);
  if (!isUuid(item)) flashRedirect(BACK, { err: "Butir tidak valid." });
  const supabase = await userClient();
  return runAction(BACK, "Butir anggaran dihapus dari versi ini.", async () =>
    supabase.rpc("delete_budget_item", { p_version: versionId, p_item: item }),
  );
}

/* ======================= Impor & penyesuaian anggaran per tahun + tahapan (periksa dulu, lalu terapkan) ======================= */

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Impor Excel/CSV ke versi (tahun + tahapan) yang dipilih. Murni ADITIF terhadap butir lain: butir yang tidak ada di berkas
 * tidak disentuh. Butir baru -> add_budget_item; butir yang sudah ada -> pagu disesuaikan lewat update_item_pagu (menolak pagu
 * di bawah realisasi) dan/atau PPTK ditugaskan. Semua lewat RPC/RLS yang sama dengan input manual.
 * intent=preview hanya memeriksa; intent=apply menyimpan. Seluruh berkas divalidasi lebih dulu: ada satu baris salah -> tidak ada yang disimpan.
 */
export async function importBudgetAction(_prev: BudgetImportState, fd: FormData): Promise<BudgetImportState> {
  await requireModule("budget.import");
  const apply = str(fd, "intent", 10) === "apply";
  const target = str(fd, "targetVersion", 40);
  const mode = str(fd, "mode", 20) === "tambah_saja" ? "tambah_saja" : "tambah_perbarui";
  if (!isUuid(target)) return { phase: "error", error: "Pilih versi anggaran tujuan (tahun dan tahapan)." };

  const supabase = await userClient();
  const { data: ver } = await supabase.from("budget_versions").select("id, stage_code, version_no, status, fiscal_years(year)").eq("id", target).maybeSingle();
  if (!ver) return { phase: "error", error: "Versi anggaran tujuan tidak ditemukan." };
  if (ver.status !== "draft" && ver.status !== "active") return { phase: "error", error: `Versi berstatus ${ver.status} tidak dapat diubah. Buat versi tahapan berikutnya untuk perubahan.` };
  const fy = Array.isArray(ver.fiscal_years) ? ver.fiscal_years[0] : ver.fiscal_years;
  const year = Number((fy as { year: number } | null)?.year);
  const stageLabel = `TA ${year} · ${STAGE_LABEL[ver.stage_code as keyof typeof STAGE_LABEL] ?? ver.stage_code} v${ver.version_no}`;

  const file = fd.get("file");
  let rows: string[][];
  if (file instanceof File && file.size > 0) {
    const read = await readTable(file);
    if (!read.ok) return { phase: "error", error: read.error };
    rows = (read as { rows: string[][] }).rows;
  } else {
    const text = str(fd, "csv", MAX_IMPORT_BYTES);
    if (!text.trim()) return { phase: "error", error: "Pilih berkas Excel/CSV atau tempel isinya." };
    rows = parseCsv(text);
  }
  const head = resolveBudgetHeaders(rows[0] ?? []);
  if (head.problems.length) return { phase: "error", error: head.problems.join(" ") };
  if (rows.length < 2) return { phase: "error", error: "Berkas tidak berisi baris data." };
  if (rows.length - 1 > 2000) return { phase: "error", error: "Maksimal 2.000 baris per impor." };

  const codeMap = async (table: string) => {
    const { data } = await supabase.from(table).select("id, code, name").eq("is_active", true).limit(10000);
    return data ?? [];
  };
  const [subs, accts, funds, roleRows, items] = await Promise.all([
    codeMap("sub_activities"), codeMap("expenditure_accounts"), codeMap("funding_sources"),
    supabase.from("user_roles").select("profiles!inner(id, username, full_name, status)").eq("role_code", "pptk").limit(5000),
    fetchAll<{ budget_item_id: string; pagu: string | number; budget_items: { sub_activity_id: string; expenditure_account_id: string; funding_source_id: string; description: string | null; pptk_id: string | null; rup_reference_id: string | null } | null }>((from, to) =>
      supabase.from("budget_item_versions").select("budget_item_id, pagu, budget_items(sub_activity_id, expenditure_account_id, funding_source_id, description, pptk_id, rup_reference_id)")
        .eq("budget_version_id", target).order("budget_item_id").range(from, to)),
  ]);
  if (items.error) return { phase: "error", error: "Butir anggaran yang ada tidak dapat dimuat. Coba lagi." };

  const pptk: { id: string; fullName: string; username: string }[] = [];
  for (const r of (roleRows.data ?? []) as unknown as Array<{ profiles: { id: string; username: string; full_name: string; status: string } | { id: string; username: string; full_name: string; status: string }[] }>) {
    const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
    if (p && p.status === "active") pptk.push({ id: p.id, fullName: p.full_name, username: p.username });
  }
  const look: Lookups = {
    subs: new Map(subs.map((r) => [String(r.code).trim().toLowerCase(), r.id as string])),
    accounts: new Map(accts.map((r) => [String(r.code).trim().toLowerCase(), r.id as string])),
    fundingByCode: new Map(funds.map((r) => [String(r.code).trim().toLowerCase(), r.id as string])),
    fundingByName: new Map(funds.map((r) => [norm(String(r.name)), r.id as string])),
    pptkByUsername: new Map(pptk.map((p) => [p.username.toLowerCase(), p.id])),
    pptk: pptk.map((p) => ({ id: p.id, fullName: p.fullName })),
  };
  const existing = new Map<string, ExistingItem>();
  for (const it of items.rows) {
    const b = it.budget_items;
    if (!b || b.rup_reference_id) continue; // identitas butir bertaut RUP berbeda dari butir tanpa RUP
    existing.set(itemKey(b.sub_activity_id, b.expenditure_account_id, b.funding_source_id, b.description), { itemId: it.budget_item_id, pagu: Number(it.pagu), pptkId: b.pptk_id });
  }

  const plan = planBudgetImport(rows, head.idx, look, existing, { mode, targetYear: year, targetStage: ver.stage_code });
  const SHOW = 300;
  const view = { target: stageLabel, counts: plan.counts, rows: plan.rows.slice(0, SHOW), truncated: plan.rows.length > SHOW };
  if (plan.problems.length) {
    return { phase: "error", ...view, error: `Impor dibatalkan, tidak ada data yang disimpan. ${plan.problems.length} baris bermasalah; perbaiki berkas lalu periksa ulang.` };
  }
  if (!apply) return { phase: "preview", ...view };

  let baru = 0, ubah = 0;
  const gagal: string[] = [];
  for (const r of plan.rows) {
    if (r.status === "baru") {
      const { error } = await supabase.rpc("add_budget_item", { p_version: target, p_sub_activity: r.subId, p_account: r.accountId, p_funding: r.fundingId, p_pptk: r.pptkId ?? null, p_description: r.desc, p_pagu: r.pagu });
      if (error) gagal.push(`Baris ${r.line}: ${friendlyError(error)}`); else baru++;
    } else if (r.status === "ubah" && r.itemId) {
      let ok = true;
      if (r.oldPagu !== null && Math.round(r.oldPagu * 100) !== Math.round(r.pagu * 100)) {
        const { error } = await supabase.rpc("update_item_pagu", { p_version: target, p_item: r.itemId, p_pagu: r.pagu, p_note: "Penyesuaian pagu melalui impor Excel/CSV" });
        if (error) { ok = false; gagal.push(`Baris ${r.line}: ${friendlyError(error)}`); }
      }
      if (ok && r.pptkChange) {
        const { error } = await supabase.from("budget_items").update({ pptk_id: r.pptkId }).eq("id", r.itemId);
        if (error) { ok = false; gagal.push(`Baris ${r.line}: penugasan PPTK gagal (${friendlyError(error)})`); }
      }
      if (ok) ubah++;
    }
  }
  revalidatePath("/anggaran");
  revalidatePath("/anggaran-kas");
  return { phase: "done", ...view, applied: { baru, ubah, gagal } };
}
