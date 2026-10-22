"use server";

import { requireModule } from "@/lib/auth/guard";
import { userClient } from "@/lib/supabase/server";
import { flashRedirect } from "@/lib/flash";
import { friendlyError, isUuid, num, optStr, runAction, str, uuidOrNull } from "@/lib/action-utils";
import { availableOf, checkTransaction } from "@/lib/tx-rules";
import { todayWIB } from "@/lib/quarterly-core";
import { normalizeName } from "@/lib/supplier-input";
import { STAGE_LABEL } from "@/lib/auth/context";

const LIST = "/realisasi";
const detail = (id: string) => `/realisasi/${id}`;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Sb = Awaited<ReturnType<typeof userClient>>;

/** Sisa tersedia butir pada versi: pagu − realisasi sah − pembayaran lama yang belum bertanggal SP2D (RLS membatasi ke butir yang boleh dilihat). */
async function availableFor(sb: Sb, version: string, item: string): Promise<number | null> {
  const { data } = await sb.from("v_budget_balance").select("pagu, eligible_realization, pending_sp2d").eq("budget_version_id", version).eq("budget_item_id", item).maybeSingle();
  return data ? availableOf(Number(data.pagu), Number(data.eligible_realization), Number(data.pending_sp2d)) : null;
}

/**
 * Tahapan menurut tanggal DPA: bila tanggal DPA sudah diisi, transaksi dicatat pada versi yang berlaku pada tanggal transaksi
 * (mis. sebelum 16 Mar = Murni), BUKAN sekadar versi yang sedang dibuka. Aman terhadap kondisi lama: tanpa tanggal DPA,
 * migrasi 0014 belum dijalankan, versi draf, atau butir tidak ada pada versi tsb -> tetap memakai versi yang sedang dibuka.
 */
async function versionForDate(sb: Sb, contextVersion: string, txDate: string, item: string): Promise<{ versionId: string; label: string | null }> {
  const stay = { versionId: contextVersion, label: null };
  if (!DATE_RE.test(txDate)) return stay;
  try {
    const { data: cv } = await sb.from("budget_versions").select("fiscal_year_id").eq("id", contextVersion).maybeSingle();
    if (!cv) return stay;
    const { data, error } = await sb.rpc("stage_version_for_date", { p_fy: cv.fiscal_year_id, p_date: txDate });
    const row = Array.isArray(data) ? data[0] : null;
    if (error || !row || !row.effective || row.status === "draft") return stay;
    if (row.version_id === contextVersion) return stay;
    const { data: has } = await sb.from("budget_item_versions").select("budget_item_id").eq("budget_version_id", row.version_id).eq("budget_item_id", item).maybeSingle();
    if (!has) return stay;
    const name = STAGE_LABEL[row.stage_code as keyof typeof STAGE_LABEL] ?? String(row.stage_code);
    return { versionId: row.version_id as string, label: `${name} v${row.version_no}` };
  } catch {
    return stay;
  }
}

/**
 * Input realisasi satu langkah (PPTK): butir + tanggal transaksi + tanggal SP2D + nilai (+ uraian/penyedia/metode opsional).
 * Tanpa nomor SP2D dan tanpa verifikasi: tersimpan langsung sebagai realisasi sah.
 */
export async function createRealizationAction(fd: FormData): Promise<void> {
  const { context } = await requireModule("realization.edit");
  if (str(fd, "versionId", 40) !== context.versionId) flashRedirect(LIST, { err: "Konteks anggaran berubah. Muat ulang halaman." });
  const item = str(fd, "itemId", 40);
  const date = str(fd, "date", 10);
  const txDate = str(fd, "txDate", 10) || date; // formulir lama tanpa tanggal transaksi: dianggap sama dengan tanggal SP2D
  const amount = num(fd, "amount");
  if (!isUuid(item)) flashRedirect(LIST, { err: "Pilih butir anggaran." });
  const back = `${LIST}?butir=${item}${DATE_RE.test(date) ? `&tgl=${date}` : ""}`;

  const supabase = await userClient();
  const routed = await versionForDate(supabase, context.versionId, txDate, item);
  const versionId = routed.versionId;
  const available = await availableFor(supabase, versionId, item);
  if (available === null) flashRedirect(LIST, { err: "Butir anggaran tidak ditemukan atau bukan milik Anda." });

  // Duplikat: transaksi aktif dengan butir, tanggal, dan nilai yang sama
  let duplicate = false;
  if (DATE_RE.test(txDate)) {
    const { data: same } = await supabase.from("realization_transactions").select("id, payment_records(amount)")
      .eq("budget_version_id", versionId).eq("budget_item_id", item).eq("transaction_date", txDate).neq("status", "cancelled").limit(50);
    duplicate = (same ?? []).some((t) => Math.round((t.payment_records as { amount: string | number }[]).reduce((a, p) => a + Number(p.amount), 0) * 100) === Math.round(amount * 100));
  }
  const problem = checkTransaction({ date, txDate, today: todayWIB(new Date()), year: context.year, amount, available: available!, duplicate, confirmDuplicate: str(fd, "confirmDuplicate", 5) === "true" });
  if (problem) flashRedirect(back, { err: problem });

  // Penyedia: dipilih dari Data Master, atau diketik manual (ditambahkan ke Data Master / dipakai ulang bila namanya sudah ada).
  let supplierId = uuidOrNull(fd, "supplier");
  if (str(fd, "supplierNew", 5) === "true") {
    const name = normalizeName(str(fd, "supplierName", 200));
    if (!name) flashRedirect(back, { err: "Nama penyedia baru wajib diisi." });
    let supErr = "";
    try {
      const { data, error } = await supabase.rpc("create_supplier_for_realization", { p_name: name, p_npwp: null, p_address: optStr(fd, "supplierAddress", 500) });
      if (error) supErr = friendlyError(error); else supplierId = String(data);
    } catch { supErr = "Terjadi kesalahan pada sistem. Silakan coba lagi."; }
    if (supErr) flashRedirect(back, { err: `Penyedia: ${supErr}` });
  }

  let message = "";
  try {
    const { error } = await supabase.rpc("record_realization_v2", {
      p_version: versionId, p_item: item, p_tx_date: txDate, p_sp2d_date: date, p_description: optStr(fd, "description", 500),
      p_supplier: supplierId, p_method: uuidOrNull(fd, "method"), p_amount: amount,
    });
    if (error) message = friendlyError(error);
  } catch { message = "Terjadi kesalahan pada sistem. Silakan coba lagi."; }
  if (message) flashRedirect(back, { err: message });

  flashRedirect(back, { ok: routed.label ? `Realisasi tersimpan pada tahapan ${routed.label} (sesuai tanggal DPA yang berlaku pada tanggal transaksi).` : "Realisasi tersimpan dan langsung tercatat." });
}

function txId(fd: FormData): string {
  const id = str(fd, "txId", 40);
  if (!isUuid(id)) flashRedirect(LIST, { err: "Transaksi tidak valid." });
  return id;
}

/** Pembatalan realisasi dengan alasan tercatat (hak koreksi Admin). */
export async function cancelTransactionAction(fd: FormData): Promise<void> {
  await requireModule("realization.correct");
  const id = txId(fd);
  const supabase = await userClient();
  return runAction(detail(id), "Transaksi dibatalkan.", async () =>
    supabase.rpc("cancel_transaction", { p_tx: id, p_reason: str(fd, "reason", 300) }),
  );
}

/** Koreksi tanggal SP2D dengan alasan tercatat (hak koreksi Admin). */
export async function correctDateAction(fd: FormData): Promise<void> {
  await requireModule("realization.correct");
  const id = txId(fd);
  const date = str(fd, "date", 10);
  if (!DATE_RE.test(date)) flashRedirect(detail(id), { err: "Tanggal SP2D wajib diisi dengan benar." });
  const supabase = await userClient();
  return runAction(detail(id), "Tanggal SP2D dikoreksi dan alasan tercatat.", async () =>
    supabase.rpc("correct_realization_date", { p_tx: id, p_date: date, p_reason: str(fd, "reason", 300) }),
  );
}

/** Koreksi tanggal transaksi dan tanggal SP2D sekaligus, dengan alasan tercatat (hak koreksi Admin). */
export async function correctDatesAction(fd: FormData): Promise<void> {
  await requireModule("realization.correct");
  const id = txId(fd);
  const txDate = str(fd, "txDate", 10);
  const date = str(fd, "date", 10);
  if (!DATE_RE.test(txDate)) flashRedirect(detail(id), { err: "Tanggal transaksi wajib diisi dengan benar." });
  if (!DATE_RE.test(date)) flashRedirect(detail(id), { err: "Tanggal SP2D wajib diisi dengan benar." });
  if (txDate > date) flashRedirect(detail(id), { err: "Tanggal transaksi tidak boleh setelah tanggal SP2D." });
  const supabase = await userClient();
  return runAction(detail(id), "Tanggal transaksi dan SP2D dikoreksi; alasan tercatat.", async () =>
    supabase.rpc("correct_realization_dates", { p_tx: id, p_tx_date: txDate, p_sp2d_date: date, p_reason: str(fd, "reason", 300) }),
  );
}

/* ======================= Kelola penyedia (tambah / ubah / hapus) — hanya nama & alamat ======================= */

const SUP = "/realisasi/penyedia";

export async function createSupplierAction(fd: FormData): Promise<void> {
  await requireModule("realization.edit");
  const name = normalizeName(str(fd, "name", 200));
  if (!name) flashRedirect(SUP, { err: "Nama penyedia wajib diisi." });
  const supabase = await userClient();
  return runAction(SUP, "Penyedia ditambahkan.", async () =>
    supabase.rpc("create_supplier_for_realization", { p_name: name, p_npwp: null, p_address: optStr(fd, "address", 500) }),
  );
}

export async function updateSupplierAction(fd: FormData): Promise<void> {
  await requireModule("realization.edit");
  const id = str(fd, "id", 40);
  const name = normalizeName(str(fd, "name", 200));
  if (!isUuid(id)) flashRedirect(SUP, { err: "Penyedia tidak valid." });
  if (!name) flashRedirect(SUP, { err: "Nama penyedia wajib diisi." });
  const supabase = await userClient();
  return runAction(SUP, "Data penyedia diperbarui.", async () =>
    supabase.rpc("update_supplier_for_realization", { p_id: id, p_name: name, p_address: optStr(fd, "address", 500) }),
  );
}

export async function deleteSupplierAction(fd: FormData): Promise<void> {
  await requireModule("realization.edit");
  const id = str(fd, "id", 40);
  if (!isUuid(id)) flashRedirect(SUP, { err: "Penyedia tidak valid." });
  const supabase = await userClient();
  return runAction(SUP, "Penyedia dihapus.", async () => supabase.rpc("delete_supplier_for_realization", { p_id: id }));
}
