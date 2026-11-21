import type { Metadata } from "next";
import Link from "next/link";
import { Download, Plus } from "lucide-react";
import { requireModule } from "@/lib/auth/guard";
import { userClient } from "@/lib/supabase/server";
import { usersWithRole } from "@/lib/lookups";
import { canAuthorDocuments, DOC_TYPES } from "@/lib/documents";
import { DOC_STATUS } from "@/lib/status";
import { formatDateTimeWIB } from "@/lib/format";
import { Badge, Card, CardHeader } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { EmptyState, Flash, PageHeader, TableWrap } from "@/components/ui/page";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/utils";
import { createDocumentAction } from "./actions";

export const metadata: Metadata = { title: "Dokumen Pengadaan" };
export const dynamic = "force-dynamic";

export default async function DokumenPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; status?: string }> }) {
  const { user, context } = await requireModule("document.view");
  const sp = await searchParams;
  const status = sp.status && DOC_STATUS[sp.status] ? sp.status : "";
  const sb = await userClient();
  let q = sb.from("procurement_documents").select("id, doc_type, title, status, created_at, budget_item_id").order("created_at", { ascending: false }).limit(500);
  if (status) q = q.eq("status", status);
  const canCreate = canAuthorDocuments(user.permissions);
  const myTypes = Object.entries(DOC_TYPES).filter(([, t]) => t.creatorRoles.some((r) => (user.roles as string[]).includes(r)));
  const [{ data, error }, { data: items }, ppk, ppbj] = await Promise.all([
    q,
    canCreate ? sb.from("budget_item_versions").select("budget_item_id, budget_items(pptk_id, description, sub_activities(code,name), expenditure_accounts(code))").eq("budget_version_id", context.versionId).limit(1000) : Promise.resolve({ data: [] }),
    canCreate ? usersWithRole(sb, "ppk") : Promise.resolve([]),
    canCreate ? usersWithRole(sb, "ppbj") : Promise.resolve([]),
  ]);
  type It = { budget_item_id: string; budget_items: { pptk_id: string | null; description: string | null; sub_activities: { code: string } | null; expenditure_accounts: { code: string } | null } | null };
  const mine = ((items ?? []) as unknown as It[]).filter((i) => i.budget_items && ((user.roles as string[]).includes("ppk") || i.budget_items.pptk_id === user.id));

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader eyebrow="Pengadaan" title="Dokumen Pengadaan" description="Alur Nota Dinas dan DPP: penyusunan, pengajuan, reviu PPBJ dengan temuan, perbaikan berversi, hingga Berita Acara Reviu. Templat resmi akan disesuaikan setelah berkas instansi diterima." />
      <Flash ok={sp.ok} err={sp.err} />

      {!canCreate && <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">Dokumen baru disusun oleh PPTK (Nota Dinas PPTK, DPP) dan PPK (Nota Dinas PPK). Peran Anda dapat melihat daftar, mengunduh, dan memproses dokumen yang ditugaskan.</p>}
      {canCreate && myTypes.length > 0 && (
        <Card>
          <details open={(data ?? []).length === 0}>
            <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 text-sm font-semibold text-navy-800 [&::-webkit-details-marker]:hidden"><Plus size={16} aria-hidden /> Tambah Dokumen (Nota Dinas / DPP)</summary>
            {mine.length === 0 ? <p className="border-t border-slate-100 px-5 py-4 text-sm text-slate-600">Belum ada butir anggaran yang dapat Anda akses pada konteks ini.</p> : (
              <form action={createDocumentAction} className="grid gap-4 border-t border-slate-100 p-5 sm:grid-cols-2">
                <Field label="Jenis dokumen" htmlFor="type"><Select id="type" name="type" required>{myTypes.map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}</Select></Field>
                <Field label="Butir anggaran" htmlFor="itemId">
                  <Select id="itemId" name="itemId" required defaultValue=""><option value="" disabled>Pilih butir</option>
                    {mine.map((i) => <option key={i.budget_item_id} value={i.budget_item_id}>{i.budget_items?.sub_activities?.code} · {i.budget_items?.expenditure_accounts?.code}{i.budget_items?.description ? ` · ${i.budget_items.description}` : ""}</option>)}</Select>
                </Field>
                <Field label="Judul" htmlFor="title" className="sm:col-span-2"><Input id="title" name="title" required maxLength={300} /></Field>
                <Field label="PPK" htmlFor="ppk"><Select id="ppk" name="ppk" defaultValue=""><option value="">— Belum ditentukan —</option>{ppk.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select></Field>
                <Field label="PPBJ (pereviu)" htmlFor="ppbj"><Select id="ppbj" name="ppbj" defaultValue=""><option value="">— Belum ditentukan —</option>{ppbj.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select></Field>
                <p className="text-xs text-slate-500 sm:col-span-2">Isi dokumen diisi pada halaman detail setelah draf dibuat.</p>
                <div className="sm:col-span-2"><SubmitButton pendingText="Membuat...">Buat draf</SubmitButton></div>
              </form>
            )}
          </details>
        </Card>
      )}

      <Card>
        <CardHeader title={`Dokumen (${data?.length ?? 0})`} actions={
          <form action="/dokumen" className="flex flex-wrap gap-2">
            <Select name="status" defaultValue={status} aria-label="Filter status" className="h-9 w-48"><option value="">Semua status</option>{Object.entries(DOC_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
            <button className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-9")}>Terapkan</button>
            <a href={`/dokumen/export${status ? `?status=${status}` : ""}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-9 gap-1")}><Download size={14} aria-hidden /> Excel</a>
            <a href={`/dokumen/export?format=csv${status ? `&status=${status}` : ""}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-9 gap-1")}><Download size={14} aria-hidden /> CSV</a>
          </form>} />
        {error ? <EmptyState title="Data tidak dapat dimuat">Muat ulang halaman.</EmptyState> : (data ?? []).length === 0 ? <EmptyState title="Belum ada dokumen">Dokumen yang Anda susun atau reviu akan tampil di sini.</EmptyState> : (
          <TableWrap>
            <table className="table-base">
              <thead><tr><th>Judul</th><th>Jenis</th><th>Status</th><th>Dibuat</th></tr></thead>
              <tbody>{(data ?? []).map((d) => {
                const st = DOC_STATUS[d.status] ?? { label: d.status, tone: "slate" as const };
                return (<tr key={d.id}><td><Link href={`/dokumen/${d.id}`} className="font-medium text-navy-700 hover:underline">{d.title}</Link></td><td>{DOC_TYPES[d.doc_type]?.label ?? d.doc_type}</td><td><Badge tone={st.tone}>{st.label}</Badge></td><td className="text-[13px] text-slate-600">{formatDateTimeWIB(d.created_at)}</td></tr>);
              })}</tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
