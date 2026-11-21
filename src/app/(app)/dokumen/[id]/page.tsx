import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireModule } from "@/lib/auth/guard";
import { userClient } from "@/lib/supabase/server";
import { getOrganizationName } from "@/lib/lookups";
import { isUuid } from "@/lib/action-utils";
import { DOC_TYPES } from "@/lib/documents";
import { DOC_STATUS } from "@/lib/status";
import { formatDateTimeWIB } from "@/lib/format";
import { Badge, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Flash, PageHeader } from "@/components/ui/page";
import { ConfirmSubmit, PrintButton, SubmitButton } from "@/components/ui/submit-button";
import { PrintFooter, PrintHeader, SignatureBlock } from "@/components/ui/report";
import {
  addFindingAction, cancelDocumentAction, completeReviewAction, issueMinutesAction, resolveFindingAction,
  returnDocumentAction, saveRevisionAction, startReviewAction, submitDocumentAction,
} from "../actions";

export const metadata: Metadata = { title: "Detail Dokumen" };
export const dynamic = "force-dynamic";

interface Finding { id: string; finding: string; required_correction: string | null; is_resolved: boolean }
interface Review { id: string; outcome: string | null; reviewed_at: string | null; created_at: string; review_findings: Finding[]; review_minutes: { minutes_no: string | null; issued_at: string | null } | { minutes_no: string | null; issued_at: string | null }[] | null }

export default async function DokumenDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { user } = await requireModule("document.view");
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const sb = await userClient();
  const { data: doc } = await sb.from("procurement_documents").select("id, doc_type, title, status, cancel_reason, created_by, assigned_ppk_id, assigned_ppbj_id, created_at").eq("id", id).maybeSingle();
  if (!doc) notFound();
  const [{ data: revs }, { data: reviewsRaw }, { data: events }, org] = await Promise.all([
    sb.from("document_revisions").select("revision_no, content, change_note, created_at").eq("document_id", id).order("revision_no", { ascending: false }),
    sb.from("document_reviews").select("id, outcome, reviewed_at, created_at, review_findings(id, finding, required_correction, is_resolved), review_minutes(minutes_no, issued_at)").eq("document_id", id).order("created_at", { ascending: false }),
    sb.from("workflow_events").select("id, from_status, to_status, reason, occurred_at").eq("entity_type", "procurement_documents").eq("entity_id", id).order("occurred_at"),
    getOrganizationName(sb, user.organizationId),
  ]);
  const type = DOC_TYPES[doc.doc_type];
  const latest = revs?.[0];
  const content = (latest?.content ?? {}) as Record<string, string>;
  const reviews = (reviewsRaw ?? []) as unknown as Review[];
  const openReview = reviews.find((r) => r.outcome === null);
  const st = DOC_STATUS[doc.status] ?? { label: doc.status, tone: "slate" as const };
  const owner = doc.created_by === user.id;
  const editable = owner && (doc.status === "draft" || doc.status === "returned_for_correction");
  const isReviewer = doc.assigned_ppbj_id === user.id;
  const isPpk = doc.assigned_ppk_id === user.id;
  const P = user.permissions;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link href="/dokumen" className="no-print inline-flex items-center gap-1 text-sm text-slate-500 hover:text-navy-700"><ArrowLeft size={14} aria-hidden /> Kembali ke daftar</Link>
      <PrintHeader orgName={org} title={type?.label ?? "Dokumen"} subtitle={doc.title} />
      <PageHeader eyebrow={type?.label} title={doc.title} actions={<><Badge tone={st.tone} className="px-3 py-1 text-sm">{st.label}</Badge><PrintButton /></>} />
      <Flash ok={sp.ok} err={sp.err} />
      {doc.cancel_reason && <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm">Alasan pembatalan: {doc.cancel_reason}</p>}

      <Card>
        <CardHeader title={`Isi dokumen${latest ? ` — revisi ${latest.revision_no}` : ""}`} description={latest?.change_note ?? undefined} />
        {editable ? (
          <form action={saveRevisionAction} className="grid gap-4 p-5 sm:grid-cols-2">
            <input type="hidden" name="docId" value={id} /><input type="hidden" name="type" value={doc.doc_type} />
            <Field label="Judul" htmlFor="title" className="sm:col-span-2"><Input id="title" name="title" defaultValue={doc.title} maxLength={300} /></Field>
            {type?.fields.map((f) => (
              <Field key={f.key} label={f.label} htmlFor={`f_${f.key}`} className={f.kind === "textarea" ? "sm:col-span-2" : undefined}>
                {f.kind === "textarea" ? <Textarea id={`f_${f.key}`} name={`f_${f.key}`} rows={5} defaultValue={content[f.key] ?? ""} />
                  : <Input id={`f_${f.key}`} name={`f_${f.key}`} type={f.kind === "date" ? "date" : "text"} required={f.required} defaultValue={content[f.key] ?? ""} />}
              </Field>
            ))}
            <Field label="Catatan perubahan" htmlFor="note" className="sm:col-span-2"><Input id="note" name="note" maxLength={300} placeholder="mis. HPS dilampirkan" /></Field>
            <div className="sm:col-span-2"><SubmitButton pendingText="Menyimpan...">Simpan sebagai revisi baru</SubmitButton></div>
          </form>
        ) : (
          <dl className="grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2">
            {type?.fields.map((f) => (
              <div key={f.key} className={f.kind === "textarea" ? "sm:col-span-2" : undefined}>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{f.label}</dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-sm text-slate-900">{content[f.key] || "—"}</dd>
              </div>
            ))}
          </dl>
        )}
        {(owner && editable || owner && doc.status === "draft") && (
          <div className="no-print flex flex-wrap gap-2 border-t border-slate-100 p-5">
            {editable && (
              <form action={submitDocumentAction}><input type="hidden" name="docId" value={id} /><ConfirmSubmit variant="accent" message="Ajukan dokumen ini untuk reviu? Setelah diajukan isi tidak dapat diubah.">Ajukan</ConfirmSubmit></form>
            )}
            <form action={cancelDocumentAction} className="flex gap-2"><input type="hidden" name="docId" value={id} />
              <Input name="reason" required maxLength={300} placeholder="Alasan pembatalan" aria-label="Alasan pembatalan" className="h-10 w-60" /><ConfirmSubmit variant="danger" message="Batalkan dokumen ini?">Batalkan</ConfirmSubmit></form>
          </div>
        )}
      </Card>

      <div className="no-print space-y-6">
        {(isReviewer && ["submitted", "resubmitted"].includes(doc.status) && P.has("document.review")) && (
          <Card className="p-5"><form action={startReviewAction}><input type="hidden" name="docId" value={id} /><SubmitButton variant="primary">Mulai reviu</SubmitButton></form></Card>
        )}
        {isPpk && ["submitted", "resubmitted"].includes(doc.status) && P.has("document.return") && (
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
            {(events ?? []).map((e) => <li key={e.id} className="px-5 py-2.5 text-slate-600">{formatDateTimeWIB(e.occurred_at)} · {e.from_status ? `${DOC_STATUS[e.from_status]?.label ?? e.from_status} → ` : ""}<b>{DOC_STATUS[e.to_status]?.label ?? e.to_status}</b>{e.reason ? ` — ${e.reason}` : ""}</li>)}
          </ul>
        </Card>
      </div>
      <SignatureBlock />
      <PrintFooter />
    </div>
  );
}
