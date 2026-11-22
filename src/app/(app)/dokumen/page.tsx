import type { Metadata } from "next";
import Link from "next/link";
import { Download, Plus, Upload } from "lucide-react";
import { requireModule } from "@/lib/auth/guard";
import { userClient } from "@/lib/supabase/server";
import { usersWithRole } from "@/lib/lookups";
import { canAuthorDocuments, DOC_TYPES } from "@/lib/documents";
import { formatRupiah } from "@/lib/format";
import { RupPicker } from "./rup-picker";
import { RupImportPanel } from "./rup-import-panel";
import { DOC_STATUS, docStatus } from "@/lib/status";
import { AssignmentFields } from "./assignment-fields";
import { formatDateTimeWIB } from "@/lib/format";
import { Badge, Card, CardHeader } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { EmptyState, Flash, PageHeader, TableWrap } from "@/components/ui/page";
import { ConfirmSubmit, SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/utils";
import { cancelDocumentAction, createDocumentAction } from "./actions";

export const metadata: Metadata = { title: "Dokumen Pengadaan" };
export const dynamic = "force-dynamic";

export default async function DokumenPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; status?: string }> }) {
  const { user, context } = await requireModule("document.view");
  const sp = await searchParams;
  const status = sp.status && DOC_STATUS[sp.status] ? sp.status : "";
  const sb = await userClient();
  let q = sb.from("procurement_documents").select("id, doc_type, title, status, created_at, budget_item_id, created_by").order("created_at", { ascending: false }).limit(500);
  if (status) q = q.eq("status", status); else q = q.neq("status", "cancelled"); // dokumen "dihapus" (dibatalkan) hanya tampil bila difilter
  const canCreate = canAuthorDocuments(user.permissions);
  const myTypes = Object.entries(DOC_TYPES).filter(([, t]) => t.creatorRoles.length > 0 && !t.createdFrom && (t.createPermission ? user.permissions.has(t.createPermission) : t.creatorRoles.some((r) => (user.roles as string[]).includes(r))));
  const recipients = Object.fromEntries(Object.entries(DOC_TYPES).filter(([, t]) => t.recipient).map(([k, t]) => [k, t.recipient!])) as Record<string, "ppk" | "ppbj">;
  const canImportRup = user.permissions.has("master.manage") || user.permissions.has("document.create_ppk");
  const { data: fyRow } = await sb.from("fiscal_years").select("id").eq("year", context.year).maybeSingle();
  const [{ count: rupCount }, { data: rupLast }, { data: balRows }] = await Promise.all([
    fyRow ? sb.from("rup_references").select("id", { count: "exact", head: true }).eq("fiscal_year_id", fyRow.id) : Promise.resolve({ count: 0 }),
    fyRow ? sb.from("rup_references").select("imported_at").eq("fiscal_year_id", fyRow.id).not("imported_at", "is", null).order("imported_at", { ascending: false }).limit(1) : Promise.resolve({ data: [] as { imported_at: string }[] }),
    canCreate ? sb.from("v_budget_balance").select("budget_item_id, sisa_anggaran, pending_sp2d").eq("budget_version_id", context.versionId).limit(3000) : Promise.resolve({ data: [] as { budget_item_id: string; sisa_anggaran: number; pending_sp2d: number }[] }),
  ]);
  const sisaOf = new Map((balRows ?? []).map((b) => [b.budget_item_id as string, Number(b.sisa_anggaran) - Number(b.pending_sp2d)]));
  const lastImport = rupLast?.[0]?.imported_at ? new Date(rupLast[0].imported_at as string).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : null;
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

      {!canCreate && <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">Alur: PPTK menyusun Nota Dinas kepada PPK; PPK menyusun dan menetapkan DPP (dibantu PPTK) lalu membuat Nota Dinas kepada PPBJ; PPBJ mereviu DPP bersama PPK. Peran Anda dapat melihat daftar, mengunduh, dan memproses dokumen yang ditugaskan.</p>}
      {canCreate && myTypes.length === 0 && <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">DPP disusun PPK dari Nota Dinas PPTK yang telah Anda terima: buka Nota Dinas tersebut, lalu pilih “Susun DPP dari Nota Dinas ini”. Nota Dinas PPK kepada PPBJ dibuat dari halaman DPP.</p>}
      {canCreate && myTypes.length > 0 && (
        <Card>
          <details open={(data ?? []).length === 0}>
            <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 text-sm font-semibold text-navy-800 [&::-webkit-details-marker]:hidden"><Plus size={16} aria-hidden /> Tambah Nota Dinas PPTK kepada PPK</summary>
            {mine.length === 0 ? <p className="border-t border-slate-100 px-5 py-4 text-sm text-slate-600">Belum ada butir anggaran yang dapat Anda akses pada konteks ini.</p> : (
              <form action={createDocumentAction} className="grid gap-4 border-t border-slate-100 p-5 sm:grid-cols-2">
                <Field label="Jenis dokumen" htmlFor="type"><Select id="type" name="type" required>{myTypes.map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}</Select></Field>
                <Field label="Butir anggaran" htmlFor="itemId">
                  <Select id="itemId" name="itemId" required defaultValue=""><option value="" disabled>Pilih butir</option>
                    {mine.map((i) => <option key={i.budget_item_id} value={i.budget_item_id}>{i.budget_items?.sub_activities?.code} · {i.budget_items?.expenditure_accounts?.code}{i.budget_items?.description ? ` · ${i.budget_items.description}` : ""}{sisaOf.has(i.budget_item_id) ? ` · Sisa tersedia ${formatRupiah(sisaOf.get(i.budget_item_id)!)}` : ""}</option>)}</Select>
                </Field>
                <RupPicker mode="create" className="sm:col-span-2" />
                <Field label="Judul" htmlFor="title" className="sm:col-span-2"><Input id="title" name="title" required maxLength={300} /></Field>
                <AssignmentFields ppk={ppk} ppbj={ppbj} recipients={recipients} initial={myTypes[0]?.[0] ?? ""} />
                {(ppk.length === 0 || ppbj.length === 0) && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 sm:col-span-2">Belum ada pengguna aktif berperan {[ppk.length === 0 && "PPK", ppbj.length === 0 && "PPBJ"].filter(Boolean).join(" dan ")}. Minta admin menambahkannya di menu Pengguna & Peran; penugasan dapat ditentukan kemudian pada halaman detail dokumen.</p>}
                <p className="text-xs text-slate-500 sm:col-span-2">Isi dokumen dan penugasan dapat dilengkapi/diubah pada halaman detail selama masih draf.</p>
                <div className="sm:col-span-2"><SubmitButton pendingText="Membuat...">Buat draf</SubmitButton></div>
              </form>
            )}
          </details>
        </Card>
      )}

      {(canImportRup || (rupCount ?? 0) > 0) && (
        <Card>
          <details open={canImportRup && (rupCount ?? 0) === 0}>
            <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 text-sm font-semibold text-navy-800 [&::-webkit-details-marker]:hidden"><Upload size={16} aria-hidden /> Data RUP dari SiRUP ({(rupCount ?? 0).toLocaleString("id-ID")} paket) — agar penyusunan dokumen tinggal mencari Kode RUP / nama paket</summary>
            {canImportRup ? <div className="border-t border-slate-100"><RupImportPanel year={context.year} count={rupCount ?? 0} lastImport={lastImport} /></div> : <p className="border-t border-slate-100 px-5 py-4 text-sm text-slate-600">Data RUP diunggah oleh Admin atau PPK. Saat menyusun dokumen, cari paket berdasarkan Kode RUP atau nama paket.</p>}
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
              <thead><tr><th>Judul</th><th>Jenis</th><th>Status</th><th>Dibuat</th><th className="text-right">Aksi</th></tr></thead>
              <tbody>{(data ?? []).map((d) => {
                const st = docStatus(d.doc_type, d.status);
                return (<tr key={d.id}><td><Link href={`/dokumen/${d.id}`} className="font-medium text-navy-700 hover:underline">{d.title}</Link></td><td>{DOC_TYPES[d.doc_type]?.label ?? d.doc_type}</td><td><Badge tone={st.tone}>{st.label}</Badge></td><td className="text-[13px] text-slate-600">{formatDateTimeWIB(d.created_at)}</td>
                  <td className="whitespace-nowrap text-right">
                    {(() => {
                      const mine = d.created_by === user.id && (d.status === "draft" || d.status === "returned_for_correction");
                      return (
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <Link href={mine ? `/dokumen/${d.id}#isi` : `/dokumen/${d.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8")}>{mine ? "Edit" : "Buka"}</Link>
                          {mine && (
                            <details className="relative">
                              <summary className="inline-flex h-8 cursor-pointer list-none items-center rounded-lg border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 hover:bg-red-50 [&::-webkit-details-marker]:hidden">Hapus</summary>
                              <form action={cancelDocumentAction} className="absolute right-0 z-20 mt-1 w-72 space-y-2 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-lift">
                                <input type="hidden" name="docId" value={d.id} /><input type="hidden" name="back" value="list" />
                                <Input name="reason" required maxLength={300} placeholder="Alasan penghapusan" aria-label="Alasan penghapusan" />
                                <ConfirmSubmit size="sm" variant="danger" message="Hapus dokumen ini? Dokumen ditandai Dibatalkan dan tidak muncul lagi pada daftar (riwayat tetap tersimpan untuk audit).">Hapus dokumen</ConfirmSubmit>
                              </form>
                            </details>
                          )}
                        </div>
                      );
                    })()}
                  </td></tr>);
              })}</tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
