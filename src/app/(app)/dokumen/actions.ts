"use server";

import { requireAnyModule, requireModule } from "@/lib/auth/guard";
import { userClient } from "@/lib/supabase/server";
import { friendlyError, isUuid, optStr, runAction, str, uuidOrNull } from "@/lib/action-utils";
import { flashRedirect } from "@/lib/flash";
import { DOC_AUTHOR_PERMISSIONS, DOC_TYPES, parseDocContent } from "@/lib/documents";

const LIST = "/dokumen";
const detail = (id: string) => `/dokumen/${id}`;
function docId(fd: FormData) {
  const id = str(fd, "docId", 40);
  if (!isUuid(id)) flashRedirect(LIST, { err: "Dokumen tidak valid." });
  return id;
}

export async function createDocumentAction(fd: FormData): Promise<void> {
  await requireAnyModule([...DOC_AUTHOR_PERMISSIONS]);
  const type = str(fd, "type", 40);
  const item = str(fd, "itemId", 40);
  const title = str(fd, "title", 300);
  if (!DOC_TYPES[type] || DOC_TYPES[type]!.creatorRoles.length === 0) flashRedirect(LIST, { err: "Jenis dokumen tidak valid." });
  if (!isUuid(item)) flashRedirect(LIST, { err: "Pilih butir anggaran." });
  const parsed = parseDocContent(fd, type);
  if (parsed.errors.length) flashRedirect(LIST, { err: parsed.errors[0]! });
  const supabase = await userClient();
  let id = "", msg = "";
  try {
    const { data, error } = await supabase.rpc("create_document", {
      p_type: type, p_item: item, p_title: title, p_ppk: uuidOrNull(fd, "ppk"), p_ppbj: uuidOrNull(fd, "ppbj"), p_content: parsed.content,
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
  return runAction(detail(id), "Revisi baru disimpan.", async () =>
    supabase.rpc("save_document_revision", { p_doc: id, p_title: optStr(fd, "title", 300), p_content: parsed.content, p_note: optStr(fd, "note", 300) }),
  );
}

const simple = (rpc: string, perm: string | string[], ok: string, withReason = false) => async (fd: FormData): Promise<void> => {
  await (Array.isArray(perm) ? requireAnyModule(perm) : requireModule(perm));
  const id = docId(fd);
  const supabase = await userClient();
  const args: Record<string, unknown> = { p_doc: id };
  if (withReason) args.p_reason = str(fd, "reason", 300);
  return runAction(detail(id), ok, async () => supabase.rpc(rpc, args));
};

export async function submitDocumentAction(fd: FormData): Promise<void> {
  await requireAnyModule([...DOC_AUTHOR_PERMISSIONS]);
  const id = docId(fd);
  const supabase = await userClient();
  // Tanpa PPBJ pereviu, dokumen tidak akan pernah dapat direviu: tolak sejak awal dengan petunjuk jelas.
  const { data: d } = await supabase.from("procurement_documents").select("assigned_ppbj_id").eq("id", id).maybeSingle();
  if (d && !d.assigned_ppbj_id) flashRedirect(detail(id), { err: "Tentukan PPBJ (pereviu) pada bagian Penugasan sebelum mengajukan dokumen." });
  return runAction(detail(id), "Dokumen diajukan.", async () => supabase.rpc("submit_document", { p_doc: id }));
}

export async function setAssigneesAction(fd: FormData): Promise<void> {
  await requireAnyModule([...DOC_AUTHOR_PERMISSIONS]);
  const id = docId(fd);
  const supabase = await userClient();
  return runAction(detail(id), "Penugasan disimpan.", async () =>
    supabase.rpc("set_document_assignees", { p_doc: id, p_ppk: uuidOrNull(fd, "ppk"), p_ppbj: uuidOrNull(fd, "ppbj") }),
  );
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
