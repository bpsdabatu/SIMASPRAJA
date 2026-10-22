"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/auth/session";
import { userClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";
import { friendlyError, str } from "@/lib/action-utils";
import { readTable } from "@/lib/spreadsheet";
import { todayWIB } from "@/lib/quarterly-core";
import { normName, resolvePptk, type Lookups } from "@/lib/budget-import-core";
import {
  guessMethods, parseRealizationReport, planRealizationImport, reconcileRecap, versionLabel,
  type BudgetItemRef, type MasterMaps, type PlanOptions, type RealizationImportState, type StageVersion,
} from "@/lib/realization-import-core";

const cents = (n: number) => Math.round(n * 100);
const SHOW = 400;

/**
 * Impor Realisasi dari laporan (Excel/CSV). Dua tahap: intent=preview (hanya memeriksa) lalu intent=apply (menyimpan).
 * Berkas dibaca ulang dan SELURUH validasi diulang di server pada tahap apply; klien tidak dipercaya.
 * Tahapan tiap baris ditentukan dari TANGGAL DPA (database menentukan ulang secara otoritatif per baris).
 */
export async function importRealizationAction(_prev: RealizationImportState, fd: FormData): Promise<RealizationImportState> {
  const { user, context } = await requireContext();
  const isAdmin = user.permissions.has("realization.correct");
  if (!isAdmin && !user.permissions.has("realization.edit")) return { phase: "error", error: "Anda tidak berwenang mengimpor realisasi." };
  const apply = str(fd, "intent", 10) === "apply";
  const basis = str(fd, "basis", 10) === "sp2d" ? "sp2d" : "transaksi";
  const includeSimilar = str(fd, "includeSimilar", 5) === "true";
  const onlyValid = str(fd, "onlyValid", 5) === "true";

  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { phase: "error", error: "Pilih berkas Excel (.xlsx) atau CSV." };
  const read = await readTable(file);
  if (!read.ok) return { phase: "error", error: read.error };
  const parsed = parseRealizationReport((read as { rows: string[][] }).rows);
  if (!parsed.ok) return { phase: "error", error: parsed.error };
  if (parsed.rows.length > 3000) return { phase: "error", error: "Maksimal 3.000 baris per impor." };
  const reconcile = reconcileRecap(parsed.rows, parsed.recap);

  const supabase = await userClient();
  const { data: cv } = await supabase.from("budget_versions").select("fiscal_year_id").eq("id", context.versionId).maybeSingle();
  if (!cv) return { phase: "error", error: "Konteks anggaran tidak valid. Muat ulang halaman." };
  const fy = cv.fiscal_year_id as string;
  const year = context.year;

  // ---------- versi (tahapan) + tanggal DPA ----------
  const { data: vrows } = await supabase.from("budget_versions").select("id, stage_code, version_no, status, dpa_date").eq("fiscal_year_id", fy);
  const versions: StageVersion[] = (vrows ?? []).map((v) => ({ id: v.id as string, stage: v.stage_code as StageVersion["stage"], versionNo: v.version_no as number, status: v.status as string, dpaDate: (v.dpa_date as string | null) ?? null }));
  if (!versions.some((v) => v.dpaDate)) {
    return { phase: "error", error: "Belum ada tanggal penetapan DPA pada versi anggaran tahun ini. Isi tanggal DPA Murni/Pergeseran di menu Input Anggaran (bagian versi) agar tahapan dapat ditentukan." };
  }
  const versionIds = versions.map((v) => v.id);

  // ---------- master & butir ----------
  const act = async (table: string) => (await supabase.from(table).select("id, code, name").eq("is_active", true).limit(10000)).data ?? [];
  const [subs, accts, funds, roleRows, itemsRes, bivRes, methodsRes] = await Promise.all([
    act("sub_activities"), act("expenditure_accounts"), act("funding_sources"),
    supabase.from("user_roles").select("profiles!inner(id, username, full_name, status)").eq("role_code", "pptk").limit(5000),
    fetchAll<{ id: string; sub_activity_id: string; expenditure_account_id: string; funding_source_id: string; pptk_id: string | null; description: string | null; rup_reference_id: string | null }>((from, to) =>
      supabase.from("budget_items").select("id, sub_activity_id, expenditure_account_id, funding_source_id, pptk_id, description, rup_reference_id").eq("fiscal_year_id", fy).order("id").range(from, to)),
    fetchAll<{ budget_version_id: string; budget_item_id: string }>((from, to) =>
      supabase.from("budget_item_versions").select("budget_version_id, budget_item_id").in("budget_version_id", versionIds).order("budget_item_id").range(from, to)),
    supabase.from("procurement_methods").select("id, code, name").eq("is_active", true).order("code").limit(200),
  ]);
  if (itemsRes.error || bivRes.error) return { phase: "error", error: "Butir anggaran tidak dapat dimuat. Coba lagi." };

  const pptk: { id: string; fullName: string; username: string }[] = [];
  for (const r of (roleRows.data ?? []) as unknown as Array<{ profiles: { id: string; username: string; full_name: string; status: string } | { id: string; username: string; full_name: string; status: string }[] }>) {
    const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
    if (p && p.status === "active") pptk.push({ id: p.id, fullName: p.full_name, username: p.username });
  }
  if (!pptk.some((p) => p.id === user.id) && !isAdmin) pptk.push({ id: user.id, fullName: user.fullName, username: user.username });

  const look: Lookups = {
    subs: new Map(subs.map((r) => [String(r.code).trim().toLowerCase(), r.id as string])),
    accounts: new Map(accts.map((r) => [String(r.code).trim().toLowerCase(), r.id as string])),
    fundingByCode: new Map(funds.map((r) => [String(r.code).trim().toLowerCase(), r.id as string])),
    fundingByName: new Map(funds.map((r) => [normName(String(r.name)), r.id as string])),
    pptkByUsername: new Map(pptk.map((p) => [p.username.toLowerCase(), p.id])),
    pptk: pptk.map((p) => ({ id: p.id, fullName: p.fullName })),
  };
  const byName = (rows: { id: unknown; name: unknown }[]) => {
    const m = new Map<string, string[]>();
    for (const r of rows) { const k = normName(String(r.name)); m.set(k, [...(m.get(k) ?? []), r.id as string]); }
    return m;
  };
  const items: BudgetItemRef[] = itemsRes.rows.map((i) => ({ id: i.id, subId: i.sub_activity_id, accId: i.expenditure_account_id, fundId: i.funding_source_id, pptkId: i.pptk_id, description: i.description, hasRup: !!i.rup_reference_id }));
  const itemsInVersion = new Map<string, Set<string>>();
  for (const b of bivRes.rows) { const s = itemsInVersion.get(b.budget_version_id) ?? new Set<string>(); s.add(b.budget_item_id); itemsInVersion.set(b.budget_version_id, s); }

  // ---------- PPTK biasa: hanya barisnya sendiri diproses ----------
  let rows = parsed.rows;
  let ignoredOthers = 0;
  if (!isAdmin) {
    const mine = rows.filter((r) => { if (!r.pptk) return false; const p = resolvePptk(r.pptk, { ...look, pptk: look.pptk.filter((x) => x.id === user.id), pptkByUsername: new Map([[user.username.toLowerCase(), user.id]]) }); return p.ok; });
    ignoredOthers = rows.length - mine.length;
    rows = mine;
    if (rows.length === 0) return { phase: "error", error: `Tidak ada baris atas nama PPTK Anda (${user.fullName}) pada berkas. ${ignoredOthers} baris milik PPTK lain diabaikan.` };
  }

  // ---------- saldo pagu (pemeriksaan awal) ----------
  const itemIds = items.map((i) => i.id);
  const paguByVersionItem = new Map<string, { pagu: number; used: number }>();
  if (itemIds.length) {
    const bal = await fetchAll<{ budget_version_id: string; budget_item_id: string; pagu: string | number; eligible_realization: string | number; pending_sp2d: string | number }>((from, to) =>
      supabase.from("v_budget_balance").select("budget_version_id, budget_item_id, pagu, eligible_realization, pending_sp2d").in("budget_version_id", versionIds).order("budget_item_id").range(from, to));
    for (const b of bal.rows) paguByVersionItem.set(`${b.budget_version_id}|${b.budget_item_id}`, { pagu: Number(b.pagu), used: Number(b.eligible_realization) + Number(b.pending_sp2d) });
  }
  const maps: MasterMaps = { look, subsByName: byName(subs), accsByName: byName(accts), items, itemsInVersion, paguByVersionItem };

  // ---------- rencana: dua tahap (1: kumpulkan kunci; 2: hitung ulang dengan data yang sudah ada) ----------
  const basePlan: Omit<PlanOptions, "existingKeys" | "existingSimilar"> = { versions, year, today: todayWIB(new Date()), basis, userId: user.id, isAdmin, includeSimilar };
  const pass1 = planRealizationImport(rows, maps, { ...basePlan, existingKeys: new Set(), existingSimilar: new Set() });
  const touched = [...new Set(pass1.rows.map((r) => r.itemId).filter(Boolean) as string[])];
  const existingKeys = new Set<string>();
  const existingSimilar = new Set<string>();
  if (touched.length) {
    const ex = await fetchAll<{ budget_item_id: string; transaction_date: string; import_key: string | null; status: string; payment_records: { amount: string | number }[] }>((from, to) =>
      supabase.from("realization_transactions").select("budget_item_id, transaction_date, import_key, status, payment_records(amount)").in("budget_item_id", touched).neq("status", "cancelled").order("id").range(from, to));
    if (ex.error) return { phase: "error", error: "Transaksi yang sudah ada tidak dapat dimuat. Coba lagi." };
    for (const t of ex.rows) {
      if (t.import_key) existingKeys.add(t.import_key);
      existingSimilar.add(`${t.budget_item_id}|${t.transaction_date}|${cents(t.payment_records.reduce((a, p) => a + Number(p.amount), 0))}`);
    }
  }
  const plan = planRealizationImport(rows, maps, { ...basePlan, existingKeys, existingSimilar });

  // ---------- metode pengadaan ----------
  const methodRefs = (methodsRes.data ?? []).map((m) => ({ id: m.id as string, code: m.code as string, name: m.name as string }));
  const guesses = guessMethods(rows, methodRefs);
  let chosen: Record<string, string> = {};
  try { const j = JSON.parse(str(fd, "methodMap", 20000) || "{}"); if (j && typeof j === "object") chosen = j as Record<string, string>; } catch { /* abaikan */ }
  const canCreateMethods = user.permissions.has("master.manage");
  const methodFor = (name: string): string | null => {
    if (!name) return null;
    const g = guesses.find((x) => normName(x.fileName) === normName(name));
    const pick = chosen[g?.fileName ?? name] ?? chosen[name];
    if (pick === "__buat__") return "__buat__";
    if (pick && methodRefs.some((m) => m.id === pick)) return pick;
    if (pick === "") return null;
    return g?.resolvedId ?? null;
  };
  const guessesOut = guesses.map((g) => ({ ...g, resolvedId: methodFor(g.fileName) === "__buat__" ? "__buat__" : methodFor(g.fileName) }));

  const view = {
    fileName: file.name.slice(0, 200), reconcile, counts: plan.counts, total: plan.total, byStage: plan.byStage, straddle: plan.straddle,
    versions: versions.sort((a, b) => (a.dpaDate ?? "9").localeCompare(b.dpaDate ?? "9")).map((v) => ({ label: versionLabel(v, versions), dpaDate: v.dpaDate, status: v.status })),
    methods: guessesOut, methodOptions: methodRefs, canCreateMethods,
    rows: plan.rows.slice(0, SHOW), truncated: plan.rows.length > SHOW,
  } satisfies Partial<RealizationImportState>;
  const note = ignoredOthers ? ` ${ignoredOthers} baris milik PPTK lain diabaikan.` : "";

  if (!apply) return { phase: "preview", ...view, error: note.trim() || undefined };
  if (plan.counts.galat > 0 && !onlyValid) {
    return { phase: "error", ...view, error: `${plan.counts.galat} baris bermasalah. Perbaiki berkas, atau centang "Impor baris valid saja" untuk melewati baris bermasalah (baris yang dilewati dapat diunggah ulang setelah diperbaiki; baris yang sudah masuk tidak akan ganda).` };
  }
  const todo = plan.rows.filter((r) => r.status === "baru");
  if (todo.length === 0) return { phase: "error", ...view, error: "Tidak ada baris baru untuk diimpor." };

  // ---------- terapkan ----------
  const sha = createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex");
  const totalInFile = rows.reduce((a, r) => a + cents(r.amount), 0) / 100;
  const { data: batchId, error: bErr } = await supabase.rpc("start_realization_import", { p_fy: fy, p_file_name: file.name, p_sha256: sha, p_rows: rows.length, p_total: totalInFile, p_basis: basis });
  if (bErr || !batchId) return { phase: "error", ...view, error: `Batch impor tidak dapat dibuat: ${bErr ? friendlyError(bErr) : "tidak diketahui"}. Pastikan migrasi 0014 sudah dijalankan.` };

  // metode baru (hanya bila diminta & berwenang)
  const created = new Map<string, string>();
  if (canCreateMethods) {
    for (const g of guessesOut) {
      if (g.resolvedId !== "__buat__") continue;
      const code = g.fileName.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 12) || "LAIN";
      const { data, error } = await supabase.from("procurement_methods").insert({ organization_id: user.organizationId, code, name: g.fileName.slice(0, 200) }).select("id").single();
      if (!error && data) created.set(normName(g.fileName), data.id as string);
    }
  }
  const methodId = (name: string): string | null => { const m = methodFor(name); return m === "__buat__" ? created.get(normName(name)) ?? null : m; };

  let imported = 0, skipped = 0, amount = 0;
  const gagal: string[] = [];
  const CHUNK = 8;
  for (let k = 0; k < todo.length; k += CHUNK) {
    await Promise.all(todo.slice(k, k + CHUNK).map(async (r) => {
      try {
        const { data, error } = await supabase.rpc("import_realization_row", {
          p_batch: batchId, p_item: r.itemId, p_tx_date: r.txDate, p_sp2d_date: r.sp2dDate, p_description: r.desc || null,
          p_supplier: null, p_method: methodId(r.method), p_amount: r.amount, p_import_key: r.importKey, p_expected_version: r.versionId,
        });
        if (error) gagal.push(`Baris ${r.no || r.line}: ${friendlyError(error)}`);
        else if (data === null) skipped++;
        else { imported++; amount += cents(r.amount); }
      } catch (e) {
        console.error("[impor-realisasi]", e instanceof Error ? e.message : "unknown");
        gagal.push(`Baris ${r.no || r.line}: terjadi kesalahan sistem`);
      }
    }));
  }
  for (const p of ["/realisasi", "/dashboard", "/lra", "/anggaran-kas"]) revalidatePath(p);
  return { phase: "done", ...view, applied: { imported, skipped, gagal, batchId: String(batchId), amount: amount / 100 } };
}
