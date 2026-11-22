"use server";

import { requireAnyModule, requireModule } from "@/lib/auth/guard";
import { userClient } from "@/lib/supabase/server";
import { friendlyError, isUuid, optStr, runAction, str, uuidOrNull } from "@/lib/action-utils";
import { flashRedirect } from "@/lib/flash";
import { contentFromRup, DOC_AUTHOR_PERMISSIONS, DOC_TYPES, parseDocContent, type DocContent, type RupSource } from "@/lib/documents";
import { computeTotals, parsePpn, type DocItem } from "@/lib/document-items";
import { formatRupiah } from "@/lib/format";

const LIST = "/dokumen";
const detail = (id: string) => `/dokumen/${id}`;
function docId(fd: FormData) {
  const id = str(fd, "docId", 40);
  if (!isUuid(id)) flashRedirect(LIST, { err: "Dokumen tidak valid." });
  return id;
}

export async function createDocumentAction(fd: FormData): Promise<void> {
  const { user } = await requireAnyModule([...DOC_AUTHOR_PERMISSIONS]);
  const type = str(fd, "type", 40);
  const item = str(fd, "itemId", 40);
  const title = str(fd, "title", 300);
  const def = DOC_TYPES[type];
  if (!def || def.creatorRoles.length === 0) flashRedirect(LIST, { err: "Jenis dokumen tidak valid." });
  if (def!.createdFrom === "nota_dinas_pptk") flashRedirect(LIST, { err: "DPP tidak dibuat langsung: PPK menyusunnya dari Nota Dinas PPTK yang telah diterima (tombol “Susun DPP dari Nota Dinas ini”)." });
  if (def!.createdFrom === "dpp") flashRedirect(LIST, { err: "Nota Dinas PPK dibuat dari halaman DPP (tombol “Buat Nota Dinas PPK kepada PPBJ”)." });
  if (def!.createPermission && !user.permissions.has(def!.createPermission)) flashRedirect(LIST, { err: `${def!.label} hanya dapat disusun oleh ${def!.creatorRoles.join("/").toUpperCase()}.` });
  // Penugasan mengikuti alur: Nota Dinas PPTK -> PPK (tujuan PPK); Nota Dinas PPK & DPP disusun PPK (PPK = penyusun) -> PPBJ.
  let assignedPpk = uuidOrNull(fd, "ppk"), assignedPpbj = uuidOrNull(fd, "ppbj");
  if (def!.recipient === "ppk") { assignedPpbj = null; if (!assignedPpk) flashRedirect(LIST, { err: "Pilih PPK tujuan Nota Dinas." }); }
  else assignedPpk = user.id;
  if (!isUuid(item)) flashRedirect(LIST, { err: "Pilih butir anggaran." });
  const parsed = parseDocContent(fd, type);
  if (parsed.errors.length) flashRedirect(LIST, { err: parsed.errors[0]! });
  const supabase = await userClient();
  // Pilihan paket dari RUP (SiRUP): isi awal DPP diambil dari data RUP yang tersimpan (bukan dari nilai kiriman browser).
  const rupId = str(fd, "rupId", 40);
  if (type === "nota_dinas_pptk" && isUuid(rupId)) {
    const { data: rup } = await supabase.from("rup_references").select("rup_code, package_name, pagu, jenis_pengadaan, metode_pemilihan, cara_pengadaan, sumber_dana, lokasi").eq("id", rupId).maybeSingle();
    if (rup) parsed.content = { ...parsed.content, ...contentFromRup(rup as RupSource) };
  }
  let id = "", msg = "";
  try {
    const { data, error } = await supabase.rpc("create_document", {
      p_type: type, p_item: item, p_title: title, p_ppk: assignedPpk, p_ppbj: assignedPpbj, p_content: parsed.content,
    });
    if (error) msg = friendlyError(error); else id = String(data);
  } catch { msg = "Terjadi kesalahan pada sistem. Silakan coba lagi."; }
  if (msg) flashRedirect(LIST, { err: msg });
  flashRedirect(detail(id), { ok: "Dokumen draf dibuat." });
}

export async function saveRevisionAction(fd: FormData): Promise<void> {
  await requireAnyModule([...DOC_AUTHOR_PERMISSIONS]);
  const id = docId(fd);
  const type = str(fd, "type", 40);
  const parsed = parseDocContent(fd, type);
  if (parsed.errors.length) flashRedirect(detail(id), { err: parsed.errors.slice(0, 3).join(" ") + (parsed.errors.length > 3 ? ` (+${parsed.errors.length - 3} kesalahan lain)` : "") });
  const supabase = await userClient();
  const baseRaw = Number(str(fd, "base", 9));
  const base = Number.isInteger(baseRaw) && baseRaw >= 0 ? baseRaw : null;
  return runAction(detail(id), "Revisi baru disimpan.", async () => {
    // save_shared_revision (migrasi 0021): penyusun & PPK pada DPP, dengan pengaman bentrok. Belum ada -> fungsi lama (hanya penyusun).
    const r = await supabase.rpc("save_shared_revision", { p_doc: id, p_title: optStr(fd, "title", 300), p_content: parsed.content, p_note: optStr(fd, "note", 300), p_base_revision: base });
    if (r.error && (r.error.code === "PGRST202" || /could not find the function/i.test(r.error.message))) {
      return supabase.rpc("save_document_revision", { p_doc: id, p_title: optStr(fd, "title", 300), p_content: parsed.content, p_note: optStr(fd, "note", 300) });
    }
    return r;
  });
}

const simple = (rpc: string, perm: string | string[], ok: string, withReason = false) => async (fd: FormData): Promise<void> => {
  await (Array.isArray(perm) ? requireAnyModule(perm) : requireModule(perm));
  const id = docId(fd);
  const supabase = await userClient();
  const args: Record<string, unknown> = { p_doc: id };
  if (withReason) args.p_reason = str(fd, "reason", 300);
  return runAction(fd.get("back") === "list" ? LIST : detail(id), ok, async () => supabase.rpc(rpc, args));
};

export async function submitDocumentAction(fd: FormData): Promise<void> {
  await requireAnyModule([...DOC_AUTHOR_PERMISSIONS]);
  const id = docId(fd);
  const supabase = await userClient();
  const { data: d } = await supabase.from("procurement_documents").select("doc_type, assigned_ppk_id, assigned_ppbj_id").eq("id", id).maybeSingle();
  if (d) {
    const def = DOC_TYPES[d.doc_type];
    if (def?.recipient === "ppk" && !d.assigned_ppk_id) flashRedirect(detail(id), { err: "Tentukan PPK tujuan pada bagian Penugasan sebelum mengajukan Nota Dinas." });
    if (def?.recipient === "ppbj" && !d.assigned_ppbj_id) flashRedirect(detail(id), { err: "Tentukan PPBJ (tujuan/pereviu) pada bagian Penugasan sebelum mengajukan dokumen." });
    // DPP disampaikan kepada PPBJ bersama Nota Dinas PPK sebagai pengantar: pengajuan DPP ikut mengajukan nota tersebut.
    if (d.doc_type === "dpp") {
      const { data: nota } = await supabase.from("procurement_documents").select("id, status").eq("source_document_id", id).eq("doc_type", "nota_dinas_ppk").neq("status", "cancelled").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!nota) flashRedirect(detail(id), { err: "Buat Nota Dinas PPK kepada PPBJ dari halaman DPP ini (bagian Alur dokumen) sebelum mengajukan DPP." });
      if (nota && (nota.status === "draft" || nota.status === "returned_for_correction")) {
        const r = await supabase.rpc("submit_document", { p_doc: nota.id });
        if (r.error) flashRedirect(detail(id), { err: `Nota Dinas PPK belum dapat diajukan: ${friendlyError(r.error)}` });
      }
    }
  }
  return runAction(detail(id), "Dokumen diajukan.", async () => supabase.rpc("submit_document", { p_doc: id }));
}

/** Nota Dinas diterima: PPK menerima Nota Dinas PPTK; PPBJ menerima Nota Dinas PPK. */
export async function acceptDocumentAction(fd: FormData): Promise<void> {
  await requireModule("document.view");
  const id = docId(fd);
  const supabase = await userClient();
  return runAction(detail(id), "Nota Dinas diterima.", async () => supabase.rpc("accept_document", { p_doc: id }));
}

async function loadLatestContent(supabase: Awaited<ReturnType<typeof userClient>>, docId: string): Promise<DocContent> {
  const { data } = await supabase.from("document_revisions").select("content").eq("document_id", docId).order("revision_no", { ascending: false }).limit(1).maybeSingle();
  return ((data?.content ?? {}) as DocContent);
}

/** PPK menyusun DPP dari Nota Dinas PPTK yang telah diterima: rincian, referensi harga, dan bahan spesifikasi disalin sebagai isi awal. */
export async function createDppFromNotaAction(fd: FormData): Promise<void> {
  const { user } = await requireModule("document.create_ppk");
  const notaId = docId(fd);
  const supabase = await userClient();
  const { data: nota } = await supabase.from("procurement_documents").select("id, doc_type, status, title, budget_item_id, assigned_ppk_id").eq("id", notaId).maybeSingle();
  if (!nota || nota.doc_type !== "nota_dinas_pptk") flashRedirect(LIST, { err: "Nota Dinas PPTK tidak ditemukan." });
  if (nota!.assigned_ppk_id !== user.id) flashRedirect(detail(notaId), { err: "DPP hanya dapat disusun oleh PPK tujuan Nota Dinas ini." });
  if (nota!.status !== "issued") flashRedirect(detail(notaId), { err: "Terima Nota Dinas PPTK terlebih dahulu sebelum menyusun DPP." });
  const { data: existing } = await supabase.from("procurement_documents").select("id").eq("source_document_id", notaId).eq("doc_type", "dpp").neq("status", "cancelled").limit(1).maybeSingle();
  if (existing) flashRedirect(detail(existing.id), { ok: "DPP untuk Nota Dinas ini sudah ada." });
  const c = await loadLatestContent(supabase, notaId);
  const items: DocItem[] = Array.isArray(c.items) ? c.items : [];
  const ppn = parsePpn(c.ppn_persen);
  const t = computeTotals(items, ppn);
  const content: DocContent = {
    perihal: String(c.perihal ?? "") || nota!.title, isi: String(c.isi ?? ""), lampiran: String(c.lampiran ?? ""),
    items, ppn_persen: String(ppn), subtotal: String(t.subtotal), ppn: String(t.ppn), hps: items.length ? String(t.total) : String(c.hps ?? ""),
    rup_pagu: String(c.rup_pagu ?? ""),
  };
  // Data RUP/identitas paket dari Nota Dinas dibawa ke DPP.
  for (const k of ["kode_rup", "jenis_pengadaan", "metode_pemilihan", "cara_pengadaan", "sumber_dana", "lokasi"] as const) if (c[k]) content[k] = String(c[k]);
  let newId = "", msg = "";
  try {
    const { data, error } = await supabase.rpc("create_document", { p_type: "dpp", p_item: nota!.budget_item_id, p_title: `DPP — ${nota!.title}`.slice(0, 300), p_ppk: user.id, p_ppbj: null, p_content: content });
    if (error) msg = friendlyError(error); else newId = String(data);
    if (!msg) { const l = await supabase.rpc("set_document_source", { p_doc: newId, p_source: notaId }); if (l.error) msg = friendlyError(l.error); }
  } catch { msg = "Terjadi kesalahan pada sistem. Silakan coba lagi."; }
  if (msg) flashRedirect(detail(notaId), { err: msg.includes("could not find") ? "Jalankan migrasi 0022 di Supabase untuk fitur alur dokumen." : msg });
  flashRedirect(detail(newId), { ok: "DPP draf dibuat dari Nota Dinas PPTK. Lengkapi spesifikasi teknis/KAK, HPS, dan rancangan kontrak, lalu tetapkan PPBJ pada Penugasan." });
}

/** PPK membuat Nota Dinas kepada PPBJ dari DPP (pengantar permintaan reviu dan persiapan pemilihan). */
export async function createNotaPpkFromDppAction(fd: FormData): Promise<void> {
  const { user } = await requireModule("document.create_ppk");
  const dppId = docId(fd);
  const supabase = await userClient();
  const { data: dpp } = await supabase.from("procurement_documents").select("id, doc_type, title, budget_item_id, assigned_ppbj_id").eq("id", dppId).maybeSingle();
  if (!dpp || dpp.doc_type !== "dpp") flashRedirect(LIST, { err: "DPP tidak ditemukan." });
  const { data: existing } = await supabase.from("procurement_documents").select("id").eq("source_document_id", dppId).eq("doc_type", "nota_dinas_ppk").neq("status", "cancelled").limit(1).maybeSingle();
  if (existing) flashRedirect(detail(existing.id), { ok: "Nota Dinas PPK untuk DPP ini sudah ada." });
  const c = await loadLatestContent(supabase, dppId);
  const hps = Number(c.hps);
  const name = String(c.perihal ?? "") || dpp!.title;
  const content: DocContent = {
    perihal: `Permohonan reviu Dokumen Persiapan Pengadaan dan persiapan pemilihan penyedia: ${name}`.slice(0, 300),
    isi: `Bersama ini disampaikan Dokumen Persiapan Pengadaan (DPP) untuk paket "${name}" untuk direviu bersama PPK dan ditindaklanjuti dengan persiapan pemilihan penyedia sesuai ketentuan pengadaan barang/jasa pemerintah.`,
    lampiran: `1. Dokumen Persiapan Pengadaan (DPP): ${dpp!.title}${Number.isFinite(hps) && hps > 0 ? ` — HPS ${formatRupiah(hps)}` : ""}`,
  };
  let newId = "", msg = "";
  try {
    const { data, error } = await supabase.rpc("create_document", { p_type: "nota_dinas_ppk", p_item: dpp!.budget_item_id, p_title: `Nota Dinas PPK kepada PPBJ — ${dpp!.title}`.slice(0, 300), p_ppk: user.id, p_ppbj: dpp!.assigned_ppbj_id, p_content: content });
    if (error) msg = friendlyError(error); else newId = String(data);
    if (!msg) { const l = await supabase.rpc("set_document_source", { p_doc: newId, p_source: dppId }); if (l.error) msg = friendlyError(l.error); }
  } catch { msg = "Terjadi kesalahan pada sistem. Silakan coba lagi."; }
  if (msg) flashRedirect(detail(dppId), { err: msg.includes("could not find") ? "Jalankan migrasi 0022 di Supabase untuk fitur alur dokumen." : msg });
  flashRedirect(detail(newId), { ok: "Nota Dinas PPK kepada PPBJ dibuat. Lengkapi nomor/tanggal, lalu ajukan DPP (nota ini ikut diajukan)." });
}

export async function setAssigneesAction(fd: FormData): Promise<void> {
  await requireAnyModule([...DOC_AUTHOR_PERMISSIONS]);
  const id = docId(fd);
  const supabase = await userClient();
  // Hanya kolom yang tampil pada formulir yang diubah; yang lain dipertahankan (mis. PPK penyusun DPP tidak boleh terhapus).
  const { data: cur } = await supabase.from("procurement_documents").select("assigned_ppk_id, assigned_ppbj_id").eq("id", id).maybeSingle();
  const ppk = fd.has("ppk") ? uuidOrNull(fd, "ppk") : (cur?.assigned_ppk_id ?? null);
  const ppbj = fd.has("ppbj") ? uuidOrNull(fd, "ppbj") : (cur?.assigned_ppbj_id ?? null);
  return runAction(detail(id), "Penugasan disimpan.", async () => supabase.rpc("set_document_assignees", { p_doc: id, p_ppk: ppk, p_ppbj: ppbj }));
}
export const completeReviewAction = async (fd: FormData) => simple("complete_review", "document.review", "Reviu diselesaikan.")(fd);
export const returnDocumentAction = async (fd: FormData) => simple("return_document", "document.view", "Dokumen dikembalikan untuk perbaikan.", true)(fd);
export const cancelDocumentAction = async (fd: FormData) => simple("cancel_document", [...DOC_AUTHOR_PERMISSIONS], "Dokumen dibatalkan.", true)(fd);

export async function startReviewAction(fd: FormData): Promise<void> {
  await requireModule("document.review");
  const id = docId(fd);
  const supabase = await userClient();
  return runAction(detail(id), "Reviu dimulai.", async () => supabase.rpc("start_review", { p_doc: id }));
}

export async function addFindingAction(fd: FormData): Promise<void> {
  await requireModule("document.review");
  const id = docId(fd);
  const review = str(fd, "reviewId", 40);
  if (!isUuid(review)) flashRedirect(detail(id), { err: "Reviu tidak valid." });
  const supabase = await userClient();
  return runAction(detail(id), "Temuan dicatat.", async () =>
    supabase.rpc("add_finding", { p_review: review, p_finding: str(fd, "finding", 1000), p_correction: optStr(fd, "correction", 1000) }),
  );
}

export async function resolveFindingAction(fd: FormData): Promise<void> {
  await requireModule("document.review");
  const id = docId(fd);
  const fid = str(fd, "findingId", 40);
  if (!isUuid(fid)) flashRedirect(detail(id), { err: "Temuan tidak valid." });
  const supabase = await userClient();
  return runAction(detail(id), "Temuan ditandai selesai.", async () => supabase.from("review_findings").update({ is_resolved: true }).eq("id", fid));
}

export async function issueMinutesAction(fd: FormData): Promise<void> {
  await requireModule("document.issue_ba");
  const id = docId(fd);
  const no = str(fd, "minutesNo", 100);
  if (!no) flashRedirect(detail(id), { err: "Nomor Berita Acara wajib diisi." });
  const supabase = await userClient();
  return runAction(detail(id), "Berita Acara Reviu diterbitkan.", async () =>
    supabase.rpc("issue_minutes", { p_doc: id, p_minutes_no: no, p_content: { catatan: str(fd, "note", 1000) } }),
  );
}
