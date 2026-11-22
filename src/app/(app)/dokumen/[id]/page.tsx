import { Fragment } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireModule } from "@/lib/auth/guard";
import { userClient } from "@/lib/supabase/server";
import { getOrganizationName, usersWithRole } from "@/lib/lookups";
import { isUuid } from "@/lib/action-utils";
import { DOC_TYPES, type DocField } from "@/lib/documents";
import type { DocItem, Limit } from "@/lib/document-items";
import { loadItemBalance } from "@/lib/doc-balance";
import { BalanceCard } from "../balance-card";
import { RupPicker } from "../rup-picker";
import { formatRupiah } from "@/lib/format";
import { ItemsEditor } from "../items-editor";
import { ItemsView } from "../items-view";
import { DOC_STATUS, docStatus } from "@/lib/status";
import { formatDateTimeWIB } from "@/lib/format";
import { Badge, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Flash, PageHeader } from "@/components/ui/page";
import { ConfirmSubmit, PrintButton, SubmitButton } from "@/components/ui/submit-button";
import { PrintFooter, PrintHeader, SignatureBlock } from "@/components/ui/report";
import {
  addFindingAction, cancelDocumentAction, completeReviewAction, issueMinutesAction, resolveFindingAction,
  acceptDocumentAction, createDppFromNotaAction, createNotaPpkFromDppAction, returnDocumentAction, saveRevisionAction, setAssigneesAction, startReviewAction, submitDocumentAction,
} from "../actions";

export const metadata: Metadata = { title: "Detail Dokumen" };
export const dynamic = "force-dynamic";

interface Finding { id: string; finding: string; required_correction: string | null; is_resolved: boolean }
interface Review { id: string; outcome: string | null; reviewed_at: string | null; created_at: string; review_findings: Finding[]; review_minutes: { minutes_no: string | null; issued_at: string | null } | { minutes_no: string | null; issued_at: string | null }[] | null }

export default async function DokumenDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { user, context } = await requireModule("document.view");
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const sb = await userClient();
  const { data: doc } = await sb.from("procurement_documents").select("id, doc_type, title, status, cancel_reason, created_by, assigned_ppk_id, assigned_ppbj_id, created_at, budget_item_id, source_document_id").eq("id", id).maybeSingle();
  if (!doc) notFound();
  const [{ data: revs }, { data: reviewsRaw }, { data: events }, org] = await Promise.all([
    sb.from("document_revisions").select("revision_no, content, change_note, created_at, created_by").eq("document_id", id).order("revision_no", { ascending: false }),
    sb.from("document_reviews").select("id, outcome, reviewed_at, created_at, review_findings(id, finding, required_correction, is_resolved), review_minutes(minutes_no, issued_at)").eq("document_id", id).order("created_at", { ascending: false }),
    sb.from("workflow_events").select("id, from_status, to_status, reason, occurred_at").eq("entity_type", "procurement_documents").eq("entity_id", id).order("occurred_at"),
    getOrganizationName(sb, user.organizationId),
  ]);
  const type = DOC_TYPES[doc.doc_type];
  const latest = revs?.[0];
  const content = (latest?.content ?? {}) as Record<string, string> & { items?: DocItem[] };
  const docItems: DocItem[] = Array.isArray(content.items) ? content.items : [];
  const balance = doc.budget_item_id ? await loadItemBalance(sb, context.versionId, doc.budget_item_id) : null;
  const limits: Limit[] = balance ? [{ label: "Sisa anggaran tersedia", value: balance.tersedia }, { label: "Pagu butir anggaran", value: balance.pagu }] : [];
  const rupPagu = Number(content.rup_pagu) > 0 ? Number(content.rup_pagu) : null;
  // Alur dokumen: sumber (mis. Nota Dinas PPTK untuk DPP) dan turunan (mis. DPP dari Nota, Nota Dinas PPK dari DPP).
  const [{ data: derived }, { data: sourceDoc }, { data: itemRow }] = await Promise.all([
    sb.from("procurement_documents").select("id, doc_type, title, status").eq("source_document_id", id).neq("status", "cancelled"),
    doc.source_document_id ? sb.from("procurement_documents").select("id, doc_type, title, status").eq("id", doc.source_document_id).maybeSingle() : Promise.resolve({ data: null }),
    doc.budget_item_id ? sb.from("budget_items").select("pptk_id").eq("id", doc.budget_item_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const isItemPptk = itemRow?.pptk_id === user.id;
  const reviews = (reviewsRaw ?? []) as unknown as Review[];
  const openReview = reviews.find((r) => r.outcome === null);
  const st = docStatus(doc.doc_type, doc.status);
  const owner = doc.created_by === user.id;
  const open = doc.status === "draft" || doc.status === "returned_for_correction";
  const editable = owner && open; // penyusun: ubah isi, penugasan, ajukan, hapus
  const isReviewer = doc.assigned_ppbj_id === user.id; // PPBJ tujuan
  const isPpk = doc.assigned_ppk_id === user.id;
  const P = user.permissions;
  // DPP disusun PPK (penyusun & penetap) dibantu PPTK pada butir anggarannya; pengajuan, penugasan, dan hapus tetap hak penyusun.
  const coAuthor = doc.doc_type === "dpp" && !owner && ((isPpk && P.has("document.create_ppk")) || (isItemPptk && P.has("document.create_pptk")));
  const contentEditable = (editable || (coAuthor && open));
  const authorIds = [...new Set((revs ?? []).map((r) => (r as { created_by: string }).created_by).concat([doc.created_by]))];
  const assigneeIds = [...new Set([doc.assigned_ppk_id, doc.assigned_ppbj_id, ...authorIds].filter((x): x is string => !!x))];
  const [{ data: assigneeRows }, ppkOpts, ppbjOpts] = await Promise.all([
    assigneeIds.length ? sb.from("profiles").select("id, full_name").in("id", assigneeIds) : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    editable ? usersWithRole(sb, "ppk") : Promise.resolve([]),
    editable ? usersWithRole(sb, "ppbj") : Promise.resolve([]),
  ]);
  const recipient = type?.recipient;
  const showPpkSelect = recipient === "ppk" || (doc.doc_type === "dpp" && doc.assigned_ppk_id !== doc.created_by);
  const showPpbjSelect = recipient === "ppbj";
  const hasChild = (t: string) => (derived ?? []).some((d) => d.doc_type === t);
  const canMakeDpp = doc.doc_type === "nota_dinas_pptk" && doc.status === "issued" && isPpk && P.has("document.create_ppk") && !hasChild("dpp");
  const canMakeNota = doc.doc_type === "dpp" && (owner || isPpk) && P.has("document.create_ppk") && !hasChild("nota_dinas_ppk") && doc.status !== "cancelled";
  const nameOf = (uid: string | null) => (uid ? (assigneeRows ?? []).find((r) => r.id === uid)?.full_name ?? "—" : "Belum ditentukan");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link href="/dokumen" className="no-print inline-flex items-center gap-1 text-sm text-slate-500 hover:text-navy-700"><ArrowLeft size={14} aria-hidden /> Kembali ke daftar</Link>
      <PrintHeader orgName={org} title={type?.label ?? "Dokumen"} subtitle={doc.title} />
      <PageHeader eyebrow={type?.label} title={doc.title} actions={<><Badge tone={st.tone} className="px-3 py-1 text-sm">{st.label}</Badge><PrintButton /></>} />
      <Flash ok={sp.ok} err={sp.err} />
      {doc.cancel_reason && <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm">Alasan pembatalan: {doc.cancel_reason}</p>}

      <span id="isi" className="block scroll-mt-20" />
      <Card>
        <CardHeader title={`Isi dokumen${latest ? ` — revisi ${latest.revision_no}` : ""}`} description={latest?.change_note ?? undefined} />
        {doc.doc_type === "dpp" && (
          <p className="no-print border-b border-slate-100 bg-slate-50 px-5 py-2.5 text-xs text-slate-600">
            DPP disusun dan ditetapkan oleh PPK <strong>{nameOf(doc.assigned_ppk_id ?? doc.created_by)}</strong>, dibantu PPTK pada butir anggaran ini. Keduanya dapat mengubah isi selama draf/dikembalikan; setiap perubahan tercatat sebagai revisi atas nama pengubah. Pengajuan ke PPBJ oleh penyusun.
          </p>
        )}
        {contentEditable ? (
          <form action={saveRevisionAction} className="grid gap-4 p-5 sm:grid-cols-2">
            <input type="hidden" name="docId" value={id} /><input type="hidden" name="type" value={doc.doc_type} /><input type="hidden" name="base" value={latest?.revision_no ?? 0} />
            {type?.fields.some((f) => f.key === "kode_rup") && <RupPicker mode="fill" className="sm:col-span-2" />}
            <Field label="Judul" htmlFor="title" className="sm:col-span-2"><Input id="title" name="title" defaultValue={doc.title} maxLength={300} readOnly={coAuthor} />{coAuthor && <p className="mt-1 text-xs text-slate-500">Judul hanya dapat diubah penyusun.</p>}</Field>
            {type?.basis && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 sm:col-span-2">{doc.doc_type === "dpp" ? "Dasar penyusunan: " : "Alur: "}{type.basis}{doc.doc_type === "dpp" ? " Templat resmi instansi dapat menggantikan susunan ini." : ""}</p>}
            {type?.fields.map((f) => {
              if (f.render === "computed") return null;
              if (f.render === "editor") return (<div key={f.key} className="contents">{f.section && <h3 className="border-b border-slate-200 pb-1 text-sm font-semibold text-navy-800 sm:col-span-2">{f.section}</h3>}<ItemsEditor defaultItems={docItems} defaultPpn={content.ppn_persen ?? ""} limits={limits} rupPagu={rupPagu} legacyHps={docItems.length === 0 && content.hps ? content.hps : undefined} /></div>);
              return (
                <div key={f.key} className="contents">
                  {f.section && <h3 className="border-b border-slate-200 pb-1 pt-2 text-sm font-semibold text-navy-800 sm:col-span-2">{f.section}</h3>}
                  <Field label={f.label} htmlFor={`f_${f.key}`} hint={f.hint} className={f.kind === "textarea" ? "sm:col-span-2" : undefined}>
                    {f.kind === "textarea" ? <Textarea id={`f_${f.key}`} name={`f_${f.key}`} rows={4} defaultValue={content[f.key] ?? ""} />
                      : f.kind === "select" ? <Select id={`f_${f.key}`} name={`f_${f.key}`} defaultValue={content[f.key] ?? ""}><option value="">— Pilih —</option>{(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}</Select>
                      : <Input id={`f_${f.key}`} name={`f_${f.key}`} type={f.kind === "date" ? "date" : "text"} required={f.required} defaultValue={content[f.key] ?? ""} />}
                  </Field>
                </div>
              );
            })}
            <Field label="Catatan perubahan" htmlFor="note" className="sm:col-span-2"><Input id="note" name="note" maxLength={300} placeholder="mis. HPS dilampirkan" /></Field>
            <div className="sm:col-span-2"><SubmitButton pendingText="Menyimpan...">Simpan sebagai revisi baru</SubmitButton></div>
          </form>
        ) : (
          <div>
            {type?.basis && <p className="px-5 pt-4 text-xs text-slate-500">{doc.doc_type === "dpp" ? "Dasar penyusunan: " : "Alur: "}{type.basis}</p>}
            <dl className="grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2">
              {type?.fields.map((f: DocField) => {
                if (f.render === "editor") return null;
                if (f.render === "computed") return docItems.length === 0 && content[f.key] ? <div key={f.key}><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{f.label}</dt><dd className="mt-0.5 text-sm text-slate-900">{Number.isFinite(Number(content[f.key])) ? formatRupiah(content[f.key]) : content[f.key]}</dd></div> : null;
                return (
                  <Fragment key={f.key}>
                    {f.section && <h3 className="border-b border-slate-200 pb-1 pt-2 text-sm font-semibold text-navy-800 sm:col-span-2">{f.section}</h3>}
                    <div className={f.kind === "textarea" ? "sm:col-span-2" : undefined}>
                      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{f.label}</dt>
                      <dd className="mt-0.5 whitespace-pre-wrap text-sm text-slate-900">{content[f.key] || "—"}</dd>
                    </div>
                  </Fragment>
                );
              })}
            </dl>
            {type?.hasItems && <div className="border-t border-slate-100"><ItemsView items={docItems} ppnPersen={content.ppn_persen} limits={[...limits, ...(rupPagu ? [{ label: "Pagu RUP (SiRUP)", value: rupPagu }] : [])]} /></div>}
          </div>
        )}
        {(owner && editable || owner && doc.status === "draft") && (
          <div className="no-print flex flex-wrap gap-2 border-t border-slate-100 p-5">
            {editable && (
              <form action={submitDocumentAction}><input type="hidden" name="docId" value={id} /><ConfirmSubmit variant="accent" message={doc.doc_type === "nota_dinas_pptk" ? "Ajukan Nota Dinas ini kepada PPK? Setelah diajukan isi tidak dapat diubah." : doc.doc_type === "dpp" ? "Ajukan DPP kepada PPBJ untuk direviu (Nota Dinas PPK ikut diajukan)? Setelah diajukan isi tidak dapat diubah." : "Ajukan Nota Dinas ini kepada PPBJ? Setelah diajukan isi tidak dapat diubah."}>{doc.doc_type === "nota_dinas_pptk" ? "Ajukan ke PPK" : "Ajukan ke PPBJ"}</ConfirmSubmit></form>
            )}
            <form action={cancelDocumentAction} className="flex gap-2"><input type="hidden" name="docId" value={id} />
              <Input name="reason" required maxLength={300} placeholder="Alasan penghapusan" aria-label="Alasan penghapusan" className="h-10 w-60" /><ConfirmSubmit variant="danger" message="Hapus dokumen ini? Dokumen ditandai Dibatalkan dan tidak muncul lagi pada daftar (riwayat tetap tersimpan untuk audit).">Hapus</ConfirmSubmit></form>
          </div>
        )}
      </Card>


      {balance && <BalanceCard b={balance} />}

      <Card>
        <CardHeader title="Penugasan" description={doc.doc_type === "nota_dinas_pptk" ? "PPK tujuan Nota Dinas ini." : "PPK penyusun/penetap dan PPBJ tujuan (pereviu). PPBJ wajib ditentukan sebelum diajukan."} />
        {editable ? (
          <form action={setAssigneesAction} className="no-print grid gap-4 p-5 sm:grid-cols-2">
            <input type="hidden" name="docId" value={id} />
            {showPpkSelect ? <Field label={doc.doc_type === "nota_dinas_pptk" ? "PPK tujuan" : "PPK"} htmlFor="as-ppk"><Select id="as-ppk" name="ppk" defaultValue={doc.assigned_ppk_id ?? ""}><option value="">— Belum ditentukan —</option>{ppkOpts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select></Field>
              : <div><p className="text-xs font-medium uppercase tracking-wide text-slate-500">PPK (penyusun/penetap)</p><p className="mt-1 text-sm text-slate-900">{nameOf(doc.assigned_ppk_id)}</p></div>}
            {showPpbjSelect && <Field label="PPBJ (tujuan/pereviu)" htmlFor="as-ppbj"><Select id="as-ppbj" name="ppbj" defaultValue={doc.assigned_ppbj_id ?? ""}><option value="">— Belum ditentukan —</option>{ppbjOpts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select></Field>}
            {((showPpkSelect && ppkOpts.length === 0) || (showPpbjSelect && ppbjOpts.length === 0)) && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 sm:col-span-2">Daftar {[showPpkSelect && ppkOpts.length === 0 && "PPK", showPpbjSelect && ppbjOpts.length === 0 && "PPBJ"].filter(Boolean).join(" dan ")} kosong: belum ada pengguna aktif dengan peran tersebut, atau migrasi database 0018 belum dijalankan.</p>}
            <div className="sm:col-span-2"><SubmitButton variant="outline" pendingText="Menyimpan...">Simpan penugasan</SubmitButton></div>
          </form>
        ) : (
          <dl className="grid gap-x-6 gap-y-3 p-5 sm:grid-cols-2">
            <div><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{doc.doc_type === "nota_dinas_pptk" ? "PPK tujuan" : "PPK"}</dt><dd className="mt-0.5 text-sm text-slate-900">{nameOf(doc.assigned_ppk_id)}</dd></div>
            {showPpbjSelect && <div><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">PPBJ (tujuan/pereviu)</dt><dd className="mt-0.5 text-sm text-slate-900">{nameOf(doc.assigned_ppbj_id)}</dd></div>}
          </dl>
        )}
      </Card>

      {(sourceDoc || (derived ?? []).length > 0 || canMakeDpp || canMakeNota) && (
        <Card>
          <CardHeader title="Alur dokumen" description="Nota Dinas PPTK kepada PPK → DPP (disusun dan ditetapkan PPK) → Nota Dinas PPK kepada PPBJ (pengantar reviu DPP)." />
          <ul className="divide-y divide-slate-100 text-sm">
            {sourceDoc && <li className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"><span><span className="text-xs uppercase tracking-wide text-slate-500">Berasal dari</span> · <Link className="font-medium text-navy-700 hover:underline" href={`/dokumen/${sourceDoc.id}`}>{DOC_TYPES[sourceDoc.doc_type]?.label}: {sourceDoc.title}</Link></span><Badge tone={docStatus(sourceDoc.doc_type, sourceDoc.status).tone}>{docStatus(sourceDoc.doc_type, sourceDoc.status).label}</Badge></li>}
            {(derived ?? []).map((d) => <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"><span><span className="text-xs uppercase tracking-wide text-slate-500">Turunan</span> · <Link className="font-medium text-navy-700 hover:underline" href={`/dokumen/${d.id}`}>{DOC_TYPES[d.doc_type]?.label}: {d.title}</Link></span><Badge tone={docStatus(d.doc_type, d.status).tone}>{docStatus(d.doc_type, d.status).label}</Badge></li>)}
          </ul>
          {(canMakeDpp || canMakeNota) && (
            <div className="no-print flex flex-wrap gap-2 border-t border-slate-100 p-5">
              {canMakeDpp && <form action={createDppFromNotaAction}><input type="hidden" name="docId" value={id} /><SubmitButton variant="primary" pendingText="Membuat DPP...">Susun DPP dari Nota Dinas ini</SubmitButton></form>}
              {canMakeNota && <form action={createNotaPpkFromDppAction}><input type="hidden" name="docId" value={id} /><SubmitButton variant="primary" pendingText="Membuat nota...">Buat Nota Dinas PPK kepada PPBJ</SubmitButton></form>}
            </div>
          )}
        </Card>
      )}

      {(revs ?? []).length > 1 && (
        <details className="no-print rounded-xl border border-slate-200 bg-white">
          <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-navy-800">Riwayat revisi ({(revs ?? []).length})</summary>
          <ul className="divide-y divide-slate-100 border-t border-slate-100 text-sm">
            {(revs ?? []).map((r) => (
              <li key={r.revision_no} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-2.5">
                <span><strong>Revisi {r.revision_no}</strong> · {nameOf((r as { created_by: string }).created_by)}{r.change_note ? ` — ${r.change_note}` : ""}</span>
                <span className="text-xs text-slate-500">{formatDateTimeWIB(r.created_at)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="no-print space-y-6">
        {(isReviewer && doc.doc_type === "dpp" && ["submitted", "resubmitted"].includes(doc.status) && P.has("document.review")) && (
          <Card className="p-5"><form action={startReviewAction}><input type="hidden" name="docId" value={id} /><SubmitButton variant="primary">Mulai reviu</SubmitButton></form></Card>
        )}
        {((doc.doc_type === "nota_dinas_pptk" && isPpk && P.has("document.return")) || (doc.doc_type === "nota_dinas_ppk" && isReviewer && P.has("document.review"))) && ["submitted", "resubmitted"].includes(doc.status) && (
          <Card className="p-5"><form action={acceptDocumentAction} className="flex flex-wrap items-center gap-3"><input type="hidden" name="docId" value={id} />
            <ConfirmSubmit variant="primary" message={doc.doc_type === "nota_dinas_pptk" ? "Terima Nota Dinas PPTK ini? Setelah diterima, PPK dapat menyusun DPP darinya." : "Terima Nota Dinas PPK ini? DPP terlampir selanjutnya direviu PPBJ bersama PPK."}>Terima Nota Dinas</ConfirmSubmit>
            <span className="text-xs text-slate-500">{doc.doc_type === "nota_dinas_pptk" ? "Atau kembalikan ke PPTK untuk diperbaiki (di bawah)." : "Reviu isi DPP dilakukan pada dokumen DPP terlampir."}</span></form></Card>
        )}
        {isPpk && !owner && ["submitted", "resubmitted"].includes(doc.status) && P.has("document.return") && (
          <Card className="p-5"><form action={returnDocumentAction} className="flex flex-wrap gap-2"><input type="hidden" name="docId" value={id} />
            <Input name="reason" required maxLength={300} placeholder="Alasan pengembalian oleh PPK" aria-label="Alasan" className="h-10 w-72" /><SubmitButton variant="outline">Kembalikan ke penyusun</SubmitButton></form></Card>
        )}

        {isReviewer && doc.status === "under_review" && openReview && (
          <Card>
            <CardHeader title="Reviu berjalan" description="Catat temuan, lalu kembalikan untuk perbaikan atau selesaikan reviu bila tidak ada temuan terbuka." />
            <div className="space-y-4 p-5">
              <form action={addFindingAction} className="grid gap-3 sm:grid-cols-2"><input type="hidden" name="docId" value={id} /><input type="hidden" name="reviewId" value={openReview.id} />
                <Field label="Temuan" htmlFor="finding"><Textarea id="finding" name="finding" required maxLength={1000} rows={2} /></Field>
                <Field label="Perbaikan yang diminta" htmlFor="correction"><Textarea id="correction" name="correction" maxLength={1000} rows={2} /></Field>
                <div><SubmitButton variant="outline" size="sm">Tambah temuan</SubmitButton></div></form>
              <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-4">
                <form action={completeReviewAction}><input type="hidden" name="docId" value={id} /><ConfirmSubmit variant="primary" message="Selesaikan reviu? Semua temuan harus sudah selesai.">Selesaikan reviu</ConfirmSubmit></form>
                <form action={returnDocumentAction} className="flex gap-2"><input type="hidden" name="docId" value={id} />
                  <Input name="reason" required maxLength={300} placeholder="Ringkasan alasan pengembalian" aria-label="Alasan" className="h-10 w-72" /><SubmitButton variant="outline">Kembalikan untuk perbaikan</SubmitButton></form>
              </div>
            </div>
          </Card>
        )}

        {isReviewer && doc.status === "review_completed" && P.has("document.issue_ba") && (
          <Card className="p-5"><form action={issueMinutesAction} className="grid gap-3 sm:grid-cols-2"><input type="hidden" name="docId" value={id} />
            <Field label="Nomor Berita Acara" htmlFor="minutesNo"><Input id="minutesNo" name="minutesNo" required maxLength={100} /></Field>
            <Field label="Catatan" htmlFor="note"><Input id="note" name="note" maxLength={1000} /></Field>
            <div><ConfirmSubmit variant="accent" message="Terbitkan Berita Acara Reviu?">Terbitkan Berita Acara</ConfirmSubmit></div></form></Card>
        )}

        {reviews.length > 0 && (
          <Card>
            <CardHeader title="Riwayat reviu" />
            <ul className="divide-y divide-slate-100">
              {reviews.map((r) => {
                const m = Array.isArray(r.review_minutes) ? r.review_minutes[0] : r.review_minutes;
                return (
                  <li key={r.id} className="space-y-2 px-5 py-4 text-sm">
                    <p><b>{formatDateTimeWIB(r.created_at)}</b> — hasil: {r.outcome === "completed" ? "selesai" : r.outcome === "returned" ? "dikembalikan" : "berjalan"}{m?.minutes_no && <Badge tone="green" className="ml-2">BA {m.minutes_no}</Badge>}</p>
                    {r.review_findings.map((f) => (
                      <div key={f.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                        <div><p>{f.finding}</p>{f.required_correction && <p className="text-xs text-slate-600">Perbaikan: {f.required_correction}</p>}</div>
                        {f.is_resolved ? <Badge tone="green">Selesai</Badge> : isReviewer && r.outcome === null ? (
                          <form action={resolveFindingAction}><input type="hidden" name="docId" value={id} /><input type="hidden" name="findingId" value={f.id} /><SubmitButton size="sm" variant="soft">Tandai selesai</SubmitButton></form>
                        ) : <Badge tone="amber">Terbuka</Badge>}
                      </div>
                    ))}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        <Card>
          <CardHeader title="Riwayat revisi & status" />
          <ul className="divide-y divide-slate-100 text-sm">
            {(revs ?? []).map((r) => <li key={r.revision_no} className="px-5 py-2.5">Revisi {r.revision_no} — {formatDateTimeWIB(r.created_at)}{r.change_note ? ` — ${r.change_note}` : ""}</li>)}
            {(events ?? []).map((e) => <li key={e.id} className="px-5 py-2.5 text-slate-600">{formatDateTimeWIB(e.occurred_at)} · {e.from_status ? `${docStatus(doc.doc_type, e.from_status).label} → ` : ""}<b>{docStatus(doc.doc_type, e.to_status).label}</b>{e.reason ? ` — ${e.reason}` : ""}</li>)}
          </ul>
        </Card>
      </div>
      <SignatureBlock />
      <PrintFooter />
    </div>
  );
}
