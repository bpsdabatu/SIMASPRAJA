"use server";

import { requireModule } from "@/lib/auth/guard";
import { userClient } from "@/lib/supabase/server";
import { flashRedirect } from "@/lib/flash";
import { friendlyError, isUuid, num, optStr, runAction, str } from "@/lib/action-utils";
import { parseMoney } from "@/lib/csv";
import { normHeader, readTable } from "@/lib/spreadsheet";
import { parseBulkPayload } from "@/lib/cash-bulk";
import { requireModule as requirePerm } from "@/lib/auth/guard";
import { revalidatePath } from "next/cache";
import { fetchAll } from "@/lib/fetch-all";
import {
  planCashAdjust, planCashImport, resolveCashHeaders,
  type AdjustSource, type AdjustTarget, type CashAdjustState, type CashImportState, type CashItem, type CashItemStatus,
} from "@/lib/cash-import-core";

const BACK = "/anggaran-kas";

async function ctxVersion(fd: FormData, permission: string) {
  const { context } = await requireModule(permission);
  if (str(fd, "versionId", 40) !== context.versionId) flashRedirect(BACK, { err: "Konteks anggaran berubah. Muat ulang halaman lalu ulangi." });
  return context.versionId;
}

export async function saveCashPlanAction(fd: FormData): Promise<void> {
  const versionId = await ctxVersion(fd, "cashplan.edit");
  const item = str(fd, "itemId", 40);
  if (!isUuid(item)) flashRedirect(BACK, { err: "Butir tidak valid." });
  const months: number[] = [];
  for (let m = 1; m <= 12; m++) {
    const raw = String(fd.get(`m${m}`) ?? "").trim();
    const v = raw === "" ? 0 : num(fd, `m${m}`);
    if (!Number.isFinite(v) || v < 0) flashRedirect(BACK, { err: `Nilai bulan ke-${m} tidak valid.` });
    months.push(v);
  }
  const supabase = await userClient();
  return runAction(BACK, "Anggaran kas disimpan sebagai draf.", async () =>
    supabase.rpc("save_cash_plan", { p_version: versionId, p_item: item, p_months: months }),
  );
}

export async function cashStatusAction(fd: FormData): Promise<void> {
  const to = str(fd, "to", 12);
  const perm = to === "submitted" ? "cashplan.submit" : "cashplan.finalize";
  await ctxVersion(fd, perm);
  const plan = str(fd, "planId", 40);
  if (!isUuid(plan) || !["submitted", "returned", "final"].includes(to)) flashRedirect(BACK, { err: "Permintaan tidak valid." });
  const msg = { submitted: "Anggaran kas diajukan.", returned: "Anggaran kas dikembalikan ke PPTK.", final: "Anggaran kas difinalisasi." }[to]!;
  const supabase = await userClient();
  return runAction(BACK, msg, async () =>
    supabase.rpc("set_cash_plan_status", { p_plan: plan, p_to: to, p_reason: optStr(fd, "reason", 300) }),
  );
}

/* ======================= Tambahan: hapus draf & impor Excel/CSV ======================= */

export async function deleteCashPlanAction(fd: FormData): Promise<void> {
  await ctxVersion(fd, "cashplan.edit");
  const plan = str(fd, "planId", 40);
  if (!isUuid(plan)) flashRedirect(BACK, { err: "Permintaan tidak valid." });
  const supabase = await userClient();
  return runAction(BACK, "Draf anggaran kas dihapus.", async () => supabase.rpc("delete_cash_plan", { p_plan: plan }));
}

const MONTH_KEYS = ["jan", "feb", "mar", "apr", "mei", "jun", "jul", "agu", "sep", "okt", "nov", "des"];
const MONTH_ALIASES: string[][] = [
  ["jan", "januari"], ["feb", "februari"], ["mar", "maret"], ["apr", "april"], ["mei"], ["jun", "juni"],
  ["jul", "juli"], ["agu", "agt", "agustus"], ["sep", "september"], ["okt", "oktober"], ["nov", "november"], ["des", "desember"],
];

/** Impor anggaran kas dari Excel/CSV (templat berisi butir dari Input Anggaran; kunci: id_butir). Hanya butir milik PPTK yang bersangkutan yang dapat disimpan (RLS). */
export async function importCashPlansAction(fd: FormData): Promise<void> {
  const versionId = await ctxVersion(fd, "cashplan.edit");
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) flashRedirect(BACK, { err: "Pilih berkas Excel (.xlsx) atau CSV." });
  const read = await readTable(file as File);
  if (!read.ok) flashRedirect(BACK, { err: read.error });
  const table = (read as { rows: string[][] }).rows;
  const header = (table[0] ?? []).map(normHeader);
  const iId = header.indexOf("id_butir");
  const iMonth = MONTH_ALIASES.map((al) => header.findIndex((h) => al.includes(h)));
  if (iId === -1 || iMonth.some((i) => i === -1)) flashRedirect(BACK, { err: "Gunakan templat dari menu ini: kolom id_butir dan jan s.d. des wajib ada." });
  const data = table.slice(1);
  if (data.length === 0) flashRedirect(BACK, { err: "Berkas tidak berisi baris data." });
  if (data.length > 2000) flashRedirect(BACK, { err: "Maksimal 2.000 baris per impor." });

  const problems: string[] = [];
  const seen = new Set<string>();
  const parsed = data.map((r, i) => {
    const line = i + 2;
    const id = (r[iId] ?? "").trim();
    if (!isUuid(id)) problems.push(`Baris ${line}: id_butir tidak valid`);
    else if (seen.has(id)) problems.push(`Baris ${line}: id_butir ganda`);
    seen.add(id);
    const months = iMonth.map((c, m) => {
      const raw = (r[c] ?? "").trim();
      if (raw === "") return 0;
      const v = parseMoney(raw);
      if (!Number.isFinite(v) || v < 0) { problems.push(`Baris ${line}: nilai ${MONTH_KEYS[m]} tidak valid`); return 0; }
      return v;
    });
    return { line, id, months };
  });
  if (problems.length) flashRedirect(BACK, { err: `Impor dibatalkan, tidak ada data yang disimpan. ${problems.length} masalah: ${problems.slice(0, 5).join("; ")}${problems.length > 5 ? " ..." : ""}` });

  const supabase = await userClient();
  let ok = 0, skipped = 0;
  const failed: string[] = [];
  for (const p of parsed) {
    if (p.months.every((m) => m === 0)) { skipped++; continue; }
    const { error } = await supabase.rpc("save_cash_plan", { p_version: versionId, p_item: p.id, p_months: p.months });
    if (error) failed.push(`Baris ${p.line}: ${friendlyError(error)}`); else ok++;
  }
  if (failed.length) flashRedirect(BACK, { err: `${ok} butir tersimpan sebagai draf, ${failed.length} gagal. ${failed.slice(0, 4).join("; ")}${failed.length > 4 ? " ..." : ""}` });
  flashRedirect(BACK, { ok: `${ok} anggaran kas tersimpan sebagai draf${skipped ? `; ${skipped} baris kosong dilewati` : ""}. Periksa lalu ajukan.` });
}

/* ======================= Tambahan: simpan massal (tabel ringkas) ======================= */

/**
 * Simpan beberapa butir sekaligus dari tabel ringkas. intent=draft: simpan sebagai draf; intent=submit: simpan lalu ajukan.
 * Setiap butir tetap melewati RPC save_cash_plan / set_cash_plan_status (RLS PPTK penugasan, total kas <= pagu diperiksa di database).
 * Tidak atomik antarbutir: butir yang berhasil tetap tersimpan, yang gagal dilaporkan dengan alasannya.
 */
export async function saveCashPlansBulkAction(fd: FormData): Promise<void> {
  const submit = str(fd, "intent", 10) === "submit";
  const versionId = await ctxVersion(fd, "cashplan.edit");
  if (submit) await requirePerm("cashplan.submit");
  const parsed = parseBulkPayload(String(fd.get(submit ? "payload_submit" : "payload_draft") ?? ""));
  if (!parsed.ok) flashRedirect(BACK, { err: parsed.error });
  const rows = (parsed as { ok: true; rows: ReturnType<typeof parseBulkPayload> extends infer R ? R extends { ok: true; rows: infer T } ? T : never : never }).rows;

  const supabase = await userClient();
  let saved = 0, submitted = 0;
  const failed: string[] = [];
  const CHUNK = 6;
  for (let k = 0; k < rows.length; k += CHUNK) {
    await Promise.all(rows.slice(k, k + CHUNK).map(async (r) => {
      try {
        const { data, error } = await supabase.rpc("save_cash_plan", { p_version: versionId, p_item: r.id, p_months: r.months });
        if (error) { failed.push(`${r.label}: ${friendlyError(error)}`); return; }
        saved++;
        if (!submit) return;
        const planId = typeof data === "string" ? data : "";
        if (!isUuid(planId)) { failed.push(`${r.label}: tersimpan sebagai draf, belum diajukan`); return; }
        const res = await supabase.rpc("set_cash_plan_status", { p_plan: planId, p_to: "submitted", p_reason: null });
        if (res.error) failed.push(`${r.label}: tersimpan sebagai draf, belum diajukan (${friendlyError(res.error)})`); else submitted++;
      } catch (e) {
        console.error("[kas-massal]", e instanceof Error ? e.message : "unknown");
        failed.push(`${r.label}: terjadi kesalahan sistem`);
      }
    }));
  }
  const okMsg = submit ? `${submitted} butir disimpan dan diajukan.` : `${saved} butir disimpan sebagai draf.`;
  if (failed.length) flashRedirect(BACK, { err: `${okMsg} ${failed.length} butir gagal: ${failed.slice(0, 4).join("; ")}${failed.length > 4 ? " ..." : ""}` });
  flashRedirect(BACK, { ok: okMsg });
}

/* ======================= Impor kas berbasis kode/triwulan + penyesuaian antartahapan (periksa dulu -> terapkan) ======================= */

interface ItemRaw {
  budget_item_id: string; pagu: string | number;
  budget_items: {
    description: string | null; pptk_id: string | null;
    sub_activities: { code: string; name: string } | null; expenditure_accounts: { code: string; name: string } | null;
    funding_sources: { code: string; name: string } | null;
  } | null;
}
interface PlanRaw { budget_item_id: string; status: CashItemStatus; cash_budget_periods: { period_no: number; period_type: string; amount: string | number }[] }
const monthsOf = (p?: PlanRaw) => Array.from({ length: 12 }, (_, i) => Number(p?.cash_budget_periods.find((x) => x.period_type === "month" && x.period_no === i + 1)?.amount ?? 0));
const ITEM_SELECT = "budget_item_id, pagu, budget_items(description, pptk_id, sub_activities(code,name), expenditure_accounts(code,name), funding_sources(code,name))";
const PLAN_SELECT = "budget_item_id, status, cash_budget_periods(period_no, period_type, amount)";

type Sb = Awaited<ReturnType<typeof userClient>>;
async function loadItemsAndPlans(supabase: Sb, versionId: string) {
  const [items, plans] = await Promise.all([
    fetchAll<ItemRaw>((from, to) => supabase.from("budget_item_versions").select(ITEM_SELECT).eq("budget_version_id", versionId).order("budget_item_id").range(from, to)),
    fetchAll<PlanRaw>((from, to) => supabase.from("cash_budget_plans").select(PLAN_SELECT).eq("budget_version_id", versionId).order("id").range(from, to)),
  ]);
  return { items, plans };
}

/** Menyimpan banyak rencana kas lewat RPC save_cash_plan (RLS PPTK penugasan + total <= pagu diperiksa lagi di database). */
async function saveMany(supabase: Sb, versionId: string, rows: { itemId: string; months: number[]; label: string }[]) {
  let saved = 0;
  const gagal: string[] = [];
  const CHUNK = 6;
  for (let k = 0; k < rows.length; k += CHUNK) {
    await Promise.all(rows.slice(k, k + CHUNK).map(async (r) => {
      try {
        const { error } = await supabase.rpc("save_cash_plan", { p_version: versionId, p_item: r.itemId, p_months: r.months });
        if (error) gagal.push(`${r.label}: ${friendlyError(error)}`); else saved++;
      } catch (e) {
        console.error("[kas-impor]", e instanceof Error ? e.message : "unknown");
        gagal.push(`${r.label}: terjadi kesalahan sistem`);
      }
    }));
  }
  return { saved, gagal };
}

/**
 * Impor Anggaran Kas dari Excel/CSV. Butir dikenali lewat id_butir ATAU kode_sub_kegiatan + kode_rekening (+ sumber_dana/uraian bila perlu);
 * nilai dapat per bulan (jan–des) atau per triwulan (tw1–tw4, dibagi rata ke 3 bulan). intent=preview hanya memeriksa; intent=apply menyimpan sebagai DRAF.
 */
export async function importCashAction(_prev: CashImportState, fd: FormData): Promise<CashImportState> {
  const { user, context } = await requireModule("cashplan.edit");
  if (str(fd, "versionId", 40) !== context.versionId) return { phase: "error", error: "Konteks anggaran berubah. Muat ulang halaman lalu ulangi." };
  const apply = str(fd, "intent", 10) === "apply";
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { phase: "error", error: "Pilih berkas Excel (.xlsx) atau CSV." };
  const read = await readTable(file);
  if (!read.ok) return { phase: "error", error: read.error };
  const table = (read as { rows: string[][] }).rows;
  const head = resolveCashHeaders(table[0] ?? []);
  if (head.problems.length) return { phase: "error", error: head.problems.join(" ") };
  if (table.length < 2) return { phase: "error", error: "Berkas tidak berisi baris data." };
  if (table.length - 1 > 2000) return { phase: "error", error: "Maksimal 2.000 baris per impor." };

  const supabase = await userClient();
  const { items, plans } = await loadItemsAndPlans(supabase, context.versionId);
  if (items.error || plans.error) return { phase: "error", error: "Data anggaran tidak dapat dimuat. Coba lagi." };
  const planOf = new Map(plans.rows.map((p) => [p.budget_item_id, p]));
  const cash: CashItem[] = items.rows.filter((r) => r.budget_items).map((r) => {
    const b = r.budget_items!;
    const plan = planOf.get(r.budget_item_id);
    return {
      itemId: r.budget_item_id, subCode: b.sub_activities?.code ?? "", accountCode: b.expenditure_accounts?.code ?? "",
      fundingCode: b.funding_sources?.code ?? "", fundingName: b.funding_sources?.name ?? "", desc: b.description ?? "",
      pagu: Number(r.pagu), pptkId: b.pptk_id, status: plan?.status ?? "none", months: monthsOf(plan),
    };
  });

  const plan = planCashImport(table, head, cash, user.id);
  const SHOW = 300;
  const view = { counts: plan.counts, rows: plan.rows.slice(0, SHOW), truncated: plan.rows.length > SHOW };
  if (plan.problems.length) return { phase: "error", ...view, error: `Impor dibatalkan, tidak ada data yang disimpan. ${plan.problems.length} baris bermasalah; perbaiki berkas lalu periksa ulang.` };
  if (!apply) return { phase: "preview", ...view };

  const todo = plan.rows.filter((r) => r.status === "simpan" && r.itemId && r.months).map((r) => ({ itemId: r.itemId!, months: r.months!, label: r.label }));
  const res = await saveMany(supabase, context.versionId, todo);
  revalidatePath("/anggaran-kas");
  return { phase: "done", ...view, applied: res };
}

/**
 * Menyesuaikan Anggaran Kas karena perubahan tahapan (Pergeseran/Perubahan): menyalin kas dari versi sumber (tahun anggaran yang sama)
 * ke versi yang dibuka, dikecilkan proporsional bila pagu baru lebih kecil. Hanya butir milik PPTK yang login; hasil berupa DRAF.
 */
export async function adjustCashAction(_prev: CashAdjustState, fd: FormData): Promise<CashAdjustState> {
  const { user, context } = await requireModule("cashplan.edit");
  if (str(fd, "versionId", 40) !== context.versionId) return { phase: "error", error: "Konteks anggaran berubah. Muat ulang halaman lalu ulangi." };
  const source = str(fd, "sourceVersion", 40);
  if (!isUuid(source) || source === context.versionId) return { phase: "error", error: "Pilih tahapan sumber yang berbeda dari versi yang sedang dibuka." };
  const apply = str(fd, "intent", 10) === "apply";
  const overwrite = str(fd, "overwrite", 5) === "true";

  const supabase = await userClient();
  const { data: vs } = await supabase.from("budget_versions").select("id, fiscal_year_id, stage_code, version_no").in("id", [source, context.versionId]);
  const src = (vs ?? []).find((v) => v.id === source), cur = (vs ?? []).find((v) => v.id === context.versionId);
  if (!src || !cur) return { phase: "error", error: "Versi anggaran tidak ditemukan." };
  if (src.fiscal_year_id !== cur.fiscal_year_id) return { phase: "error", error: "Tahapan sumber harus berasal dari tahun anggaran yang sama." };

  const [now, before] = await Promise.all([loadItemsAndPlans(supabase, context.versionId), loadItemsAndPlans(supabase, source)]);
  if (now.items.error || now.plans.error || before.items.error || before.plans.error) return { phase: "error", error: "Data anggaran tidak dapat dimuat. Coba lagi." };

  const planNow = new Map(now.plans.rows.map((p) => [p.budget_item_id, p]));
  const targets: AdjustTarget[] = now.items.rows.filter((r) => r.budget_items).map((r) => {
    const b = r.budget_items!, plan = planNow.get(r.budget_item_id);
    return { itemId: r.budget_item_id, label: `${b.sub_activities?.code ?? ""} ${b.expenditure_accounts?.code ?? ""}`.trim(), pagu: Number(r.pagu), mine: b.pptk_id === user.id, status: plan?.status ?? "none", months: monthsOf(plan) };
  });
  const planBefore = new Map(before.plans.rows.map((p) => [p.budget_item_id, p]));
  const srcMap = new Map<string, AdjustSource>(before.items.rows.map((r) => [r.budget_item_id, { pagu: Number(r.pagu), months: planBefore.has(r.budget_item_id) ? monthsOf(planBefore.get(r.budget_item_id)) : null }]));

  const out = planCashAdjust(targets, srcMap, overwrite);
  const SHOW = 300;
  const view = { source: `${(src.stage_code as string)} v${src.version_no}`, counts: out.counts, rows: out.rows.slice(0, SHOW), others: out.others, truncated: out.rows.length > SHOW };
  if (!apply) return { phase: "preview", ...view };

  const todo = out.rows.filter((r) => (r.status === "salin" || r.status === "kurangi") && r.months).map((r) => ({ itemId: r.itemId, months: r.months!, label: r.label }));
  const res = await saveMany(supabase, context.versionId, todo);
  revalidatePath("/anggaran-kas");
  return { phase: "done", ...view, applied: res };
}
