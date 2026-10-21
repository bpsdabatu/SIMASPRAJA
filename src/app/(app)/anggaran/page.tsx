import type { Metadata } from "next";
import Link from "next/link";
import { Download, FileSpreadsheet, Plus, Upload } from "lucide-react";
import { requireModule } from "@/lib/auth/guard";
import { userClient } from "@/lib/supabase/server";
import { getOrganizationName, loadBudgetLookups, loadBudgetTree } from "@/lib/lookups";
import { fetchAll } from "@/lib/fetch-all";
import { STAGES, STAGE_LABEL, type Stage } from "@/lib/auth/context";
import { formatRupiah } from "@/lib/format";
import { Badge, Card, CardHeader } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { EmptyState, Flash, PageHeader, TableWrap } from "@/components/ui/page";
import { ConfirmSubmit, PrintButton, SubmitButton } from "@/components/ui/submit-button";
import { PrintFooter, PrintHeader, SignatureBlock } from "@/components/ui/report";
import {
  addFiscalYearAction, assignPptkAction, createVersionAction, deleteItemAction,
  setVersionDpaDateAction, setVersionStatusAction, updateItemDetailAction, updatePaguAction,
} from "./actions";
import { LiveFilter } from "@/components/live-filter";
import { BudgetItemForm } from "./budget-item-form";
import { BudgetImportPanel } from "./budget-import-panel";

export const metadata: Metadata = { title: "Input Anggaran" };
export const dynamic = "force-dynamic";

const STATUS_TONE = { draft: "amber", active: "green", final: "navy", superseded: "slate" } as const;
const STATUS_LABEL = { draft: "Draf", active: "Aktif", final: "Final", superseded: "Digantikan" } as const;
type VStatus = keyof typeof STATUS_TONE;

interface ItemRow {
  budget_item_id: string;
  pagu: string | number;
  adjustment_note: string | null;
  budget_items: {
    id: string; description: string | null; pptk_id: string | null;
    sub_activity_id: string; expenditure_account_id: string; funding_source_id: string;
    sub_activities: { code: string; name: string } | null;
    expenditure_accounts: { code: string; name: string } | null;
    funding_sources: { code: string; name: string } | null;
    pptk: { full_name: string } | null;
  } | null;
}
interface VersionRow {
  id: string; stage_code: Stage; version_no: number; status: VStatus; note: string | null; created_at: string;
  fiscal_years: { year: number } | null;
}

export default async function AnggaranPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; q?: string }> }) {
  const { user, context } = await requireModule("budget.view");
  const sp = await searchParams;
  const canEdit = user.permissions.has("budget.edit");
  const canImport = user.permissions.has("budget.import");
  const supabase = await userClient();

  const [{ data: versionsRaw }, itemsRes, lookups, org, dpaRes, tree] = await Promise.all([
    supabase.from("budget_versions").select("id, stage_code, version_no, status, note, created_at, fiscal_years(year)")
      .order("created_at", { ascending: false }).limit(60),
    fetchAll<ItemRow>((from, to) => supabase.from("budget_item_versions")
      .select("budget_item_id, pagu, adjustment_note, budget_items(id, description, pptk_id, sub_activity_id, expenditure_account_id, funding_source_id, sub_activities(code,name), expenditure_accounts(code,name), funding_sources(code,name), pptk:profiles!budget_items_pptk_id_fkey(full_name))")
      .eq("budget_version_id", context.versionId).order("budget_item_id").range(from, to)),
    canEdit ? loadBudgetLookups(supabase) : Promise.resolve(null),
    getOrganizationName(supabase, user.organizationId),
    // Terpisah agar halaman tetap berfungsi bila migrasi 0009 (kolom dpa_date) belum diterapkan.
    supabase.from("budget_versions").select("id, dpa_date, dpa_note").limit(200),
    canEdit ? loadBudgetTree(supabase) : Promise.resolve(null),
  ]);
  const dpaOf = new Map(((dpaRes.data ?? []) as Array<{ id: string; dpa_date: string | null; dpa_note: string | null }>).map((r) => [r.id, r]));
  const canFinalize = user.permissions.has("budget.finalize");
  const dmy = (iso: string) => new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

  const versions = (versionsRaw ?? []) as unknown as VersionRow[];
  const current = versions.find((v) => v.id === context.versionId);
  const editable = canEdit && (current?.status === "draft" || current?.status === "active");
  const editableVersions = versions
    .filter((v) => v.status === "draft" || v.status === "active")
    .map((v) => ({ id: v.id, label: `TA ${v.fiscal_years?.year} · ${STAGE_LABEL[v.stage_code]} v${v.version_no} (${STATUS_LABEL[v.status]})` }));
  const q = (sp.q ?? "").trim().toLowerCase().slice(0, 60);

  const error = itemsRes.error;
  let items = itemsRes.rows.filter((r) => r.budget_items);
  items.sort((a, b) => {
    const ka = `${a.budget_items!.sub_activities?.code ?? ""}|${a.budget_items!.expenditure_accounts?.code ?? ""}`;
    const kb = `${b.budget_items!.sub_activities?.code ?? ""}|${b.budget_items!.expenditure_accounts?.code ?? ""}`;
    return ka.localeCompare(kb, "id", { numeric: true });
  });
  const total = items.reduce((s, r) => s + Number(r.pagu), 0);
  if (q) {
    items = items.filter((r) => {
      const b = r.budget_items!;
      return [b.sub_activities?.code, b.sub_activities?.name, b.expenditure_accounts?.code, b.expenditure_accounts?.name, b.description, b.pptk?.full_name]
        .some((x) => (x ?? "").toLowerCase().includes(q));
    });
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PrintHeader orgName={org} title="Input Anggaran" subtitle={`Tahun Anggaran ${context.year} — ${STAGE_LABEL[context.stage]}${current ? ` v${current.version_no}` : ""}`} />
      <PageHeader
        eyebrow={`TA ${context.year} · ${STAGE_LABEL[context.stage]}`}
        title="Input Anggaran"
        description="Pagu per butir anggaran pada versi yang sedang dibuka, memakai referensi dari Data Master. Versi final tidak dapat diubah; gunakan versi tahapan berikutnya untuk perubahan."
        actions={<>
          {canImport && editable && (
            <a href="/anggaran/template?format=xlsx" className={buttonVariants({ variant: "outline" })}><FileSpreadsheet size={16} aria-hidden /> Templat Excel</a>
          )}
          <a href={`/anggaran/export?format=xlsx&q=${encodeURIComponent(sp.q ?? "")}`} className={buttonVariants({ variant: "outline" })}><Download size={16} aria-hidden /> Excel</a>
          <a href={`/anggaran/export?format=csv&q=${encodeURIComponent(sp.q ?? "")}`} className={buttonVariants({ variant: "outline" })}><Download size={16} aria-hidden /> CSV</a>
          <PrintButton />
        </>}
      />
      <Flash ok={sp.ok} err={sp.err} />

      {canEdit && (
        <Card className="no-print">
          <details>
            <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 text-sm font-semibold text-navy-800 [&::-webkit-details-marker]:hidden"><Plus size={16} aria-hidden /> Tambah tahun anggaran</summary>
            <form action={addFiscalYearAction} className="grid gap-4 border-t border-slate-100 p-5 sm:grid-cols-4">
              <Field label="Tahun anggaran" htmlFor="fy-year" hint={`Sudah ada: ${[...new Set(versions.map((v) => v.fiscal_years?.year).filter(Boolean))].sort().join(", ") || "belum ada"}`}>
                <Input id="fy-year" name="year" type="number" min={2000} max={2100} required defaultValue={context.year + 1} />
              </Field>
              <Field label="Catatan" htmlFor="fy-note" className="sm:col-span-2"><Input id="fy-note" name="note" maxLength={300} placeholder="mis. APBD Murni" /></Field>
              <div className="flex items-end"><SubmitButton pendingText="Menambah...">Tambah tahun</SubmitButton></div>
              <p className="text-xs text-slate-500 sm:col-span-4">Tahun baru dibuat bersama versi tahapan Murni berstatus draf. Tahapan Pergeseran/Perubahan ditambahkan lewat &ldquo;Buat versi baru&rdquo; di bawah.</p>
            </form>
          </details>
        </Card>
      )}

      <Card className="no-print">
        <CardHeader
          title="Versi anggaran"
          description={current ? `Sedang dibuka: ${STAGE_LABEL[current.stage_code]} v${current.version_no} — ${STATUS_LABEL[current.status]}` : undefined}
        />
        <TableWrap>
          <table className="table-base">
            <thead><tr><th>Tahun</th><th>Tahapan</th><th>Versi</th><th>Status</th><th>Tanggal DPA</th><th>Catatan</th>{canEdit && <th className="text-right">Aksi</th>}</tr></thead>
            <tbody>
              {versions.length === 0 && <tr><td colSpan={7}><EmptyState title="Belum ada versi anggaran">{canEdit ? "Buat versi pertama di bawah." : "Hubungi administrator."}</EmptyState></td></tr>}
              {versions.map((v) => (
                <tr key={v.id} className={v.id === context.versionId ? "bg-gold-50/50" : undefined}>
                  <td className="font-semibold">{v.fiscal_years?.year}</td>
                  <td>{STAGE_LABEL[v.stage_code]}</td>
                  <td>v{v.version_no}{v.id === context.versionId && <Badge tone="gold" className="ml-2">dibuka</Badge>}</td>
                  <td><Badge tone={STATUS_TONE[v.status]}>{STATUS_LABEL[v.status]}</Badge></td>
                  <td className="min-w-44">
                    {(() => {
                      const d = dpaOf.get(v.id);
                      const may = canEdit && (v.status === "draft" || v.status === "active" || canFinalize);
                      return (<>
                        {d?.dpa_date ? <span title={d.dpa_note ?? undefined}>{dmy(d.dpa_date)}</span> : <Badge tone="amber">belum diisi</Badge>}
                        {may && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-xs text-navy-700 underline">{d?.dpa_date ? "Koreksi" : "Isi tanggal"}</summary>
                            <form action={setVersionDpaDateAction} className="mt-2 grid w-64 gap-2">
                              <input type="hidden" name="versionId" value={v.id} />
                              <Input name="dpaDate" type="date" required defaultValue={d?.dpa_date ?? ""} aria-label="Tanggal penetapan DPA" />
                              <Input name="reason" maxLength={300} required={!!d?.dpa_date} placeholder={d?.dpa_date ? "Alasan koreksi (wajib)" : "Keterangan (opsional)"} aria-label="Alasan" />
                              <SubmitButton size="sm" variant="soft">Simpan tanggal DPA</SubmitButton>
                            </form>
                          </details>
                        )}
                      </>);
                    })()}
                  </td>
                  <td className="max-w-xs truncate text-slate-600">{v.note ?? "—"}</td>
                  {canEdit && (
                    <td className="text-right">
                      <div className="flex justify-end gap-2">
                        {v.status === "draft" && (
                          <form action={setVersionStatusAction}>
                            <input type="hidden" name="versionId" value={v.id} /><input type="hidden" name="to" value="active" />
                            <SubmitButton size="sm" variant="soft">Aktifkan</SubmitButton>
                          </form>
                        )}
                        {v.status === "active" && user.permissions.has("budget.finalize") && (
                          <form action={setVersionStatusAction}>
                            <input type="hidden" name="versionId" value={v.id} /><input type="hidden" name="to" value="final" />
                            <ConfirmSubmit size="sm" variant="primary" message="Finalisasi versi ini? Setelah final, pagu dan butir tidak dapat diubah lagi.">Finalisasi</ConfirmSubmit>
                          </form>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        {canEdit && (
          <details className="border-t border-slate-100">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 text-sm font-semibold text-navy-800 [&::-webkit-details-marker]:hidden"><Plus size={16} aria-hidden /> Buat versi baru</summary>
            <form action={createVersionAction} className="grid gap-4 p-5 sm:grid-cols-4">
              <Field label="Tahun anggaran" htmlFor="v-year"><Input id="v-year" name="year" type="number" min={2000} max={2100} required defaultValue={context.year} /></Field>
              <Field label="Tahapan" htmlFor="v-stage">
                <Select id="v-stage" name="stage" required defaultValue="murni">{STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</Select>
              </Field>
              <Field label="Salin pagu dari versi" htmlFor="v-copy" className="sm:col-span-2">
                <Select id="v-copy" name="copyFrom" defaultValue="">
                  <option value="">— Kosong (tanpa salinan) —</option>
                  {versions.map((v) => <option key={v.id} value={v.id}>{v.fiscal_years?.year} {STAGE_LABEL[v.stage_code]} v{v.version_no} ({STATUS_LABEL[v.status]})</option>)}
                </Select>
              </Field>
              <Field label="Catatan" htmlFor="v-note" className="sm:col-span-4"><Input id="v-note" name="note" maxLength={300} placeholder="mis. Pergeseran triwulan II" /></Field>
              <div className="sm:col-span-4"><SubmitButton pendingText="Membuat...">Buat versi (draf)</SubmitButton></div>
            </form>
          </details>
        )}
      </Card>

      {editable && lookups && (
        <Card className="no-print">
          <details>
            <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 text-sm font-semibold text-navy-800 [&::-webkit-details-marker]:hidden"><Plus size={16} aria-hidden /> Tambah butir anggaran (input manual)</summary>
            {tree && <BudgetItemForm versionId={context.versionId} tree={tree} />}
          </details>
          {canImport && (
            <details className="border-t border-slate-100">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 text-sm font-semibold text-navy-800 [&::-webkit-details-marker]:hidden"><Upload size={16} aria-hidden /> Impor / penyesuaian dari Excel atau CSV (per tahun &amp; tahapan)</summary>
              <BudgetImportPanel
                defaultVersionId={editableVersions.some((v) => v.id === context.versionId) ? context.versionId : editableVersions[0]?.id ?? ""}
                versions={editableVersions}
              />
            </details>
          )}
        </Card>
      )}

      <Card>
        <CardHeader
          title={`Butir anggaran (${items.length})`}
          description={`Total pagu versi ini: ${formatRupiah(total)}`}
          actions={<>
            <LiveFilter tableId="tbl-butir" placeholder="Saring cepat…" />
            <form action="/anggaran" className="no-print flex gap-2">
              <Input name="q" defaultValue={sp.q ?? ""} placeholder="Cari kode / uraian / PPTK" aria-label="Cari" className="h-9 w-56" />
              <button className={buttonVariants({ variant: "outline", size: "sm" }) + " h-9"}>Cari</button>
            </form>
          </>}
        />
        {error ? <EmptyState title="Data tidak dapat dimuat">Muat ulang halaman atau hubungi administrator.</EmptyState>
          : items.length === 0 ? <EmptyState title="Belum ada butir anggaran">{editable ? "Tambahkan butir pertama atau impor dari CSV." : "Belum ada data pada versi ini."}</EmptyState>
          : (
          <TableWrap>
            <table id="tbl-butir" className="table-base">
              <thead><tr><th>Sub kegiatan</th><th>Rekening</th><th>Sumber dana</th><th>PPTK</th><th className="text-right">Pagu</th>{editable && <th className="no-print text-right">Aksi</th>}</tr></thead>
              <tbody>
                {items.map((r) => {
                  const b = r.budget_items!;
                  return (
                    <tr key={r.budget_item_id} data-s={[b.sub_activities?.code, b.sub_activities?.name, b.expenditure_accounts?.code, b.expenditure_accounts?.name, b.funding_sources?.name, b.description, b.pptk?.full_name].join(" ").toLowerCase()}>
                      <td><span className="font-mono text-[13px] text-slate-500">{b.sub_activities?.code}</span><br />{b.sub_activities?.name}{b.description && <span className="block text-xs text-slate-500">{b.description}</span>}</td>
                      <td><span className="font-mono text-[13px] text-slate-500">{b.expenditure_accounts?.code}</span><br />{b.expenditure_accounts?.name}</td>
                      <td>{b.funding_sources?.name}</td>
                      <td>{b.pptk?.full_name ?? <Badge tone="amber">Belum ditugaskan</Badge>}</td>
                      <td className="num font-medium">{formatRupiah(r.pagu)}{r.adjustment_note && <span className="block text-xs font-normal text-slate-500">{r.adjustment_note}</span>}</td>
                      {editable && (
                        <td className="no-print text-right">
                          <details className="relative text-left">
                            <summary className="ml-auto inline-flex h-8 cursor-pointer list-none items-center rounded-lg bg-navy-50 px-3 text-xs font-semibold text-navy-700 hover:bg-navy-100 [&::-webkit-details-marker]:hidden">Ubah</summary>
                            <div className="absolute right-0 z-20 mt-2 w-[min(92vw,22rem)] space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-lift">
                              <form action={updatePaguAction} className="space-y-3">
                                <input type="hidden" name="versionId" value={context.versionId} /><input type="hidden" name="itemId" value={r.budget_item_id} />
                                <Field label="Pagu (Rp)" htmlFor={`p-${r.budget_item_id}`}><Input id={`p-${r.budget_item_id}`} name="pagu" type="number" min={0} step="0.01" required defaultValue={String(r.pagu)} /></Field>
                                <Field label="Catatan perubahan" htmlFor={`n-${r.budget_item_id}`}><Input id={`n-${r.budget_item_id}`} name="note" maxLength={300} /></Field>
                                <SubmitButton size="sm">Simpan pagu</SubmitButton>
                              </form>
                              {lookups && (
                                <form action={assignPptkAction} className="space-y-3 border-t border-slate-100 pt-3">
                                  <input type="hidden" name="versionId" value={context.versionId} /><input type="hidden" name="itemId" value={r.budget_item_id} />
                                  <Field label="PPTK" htmlFor={`t-${r.budget_item_id}`}>
                                    <Select id={`t-${r.budget_item_id}`} name="pptk" defaultValue={b.pptk_id ?? ""}>
                                      <option value="">— Belum ditugaskan —</option>
                                      {lookups.pptk.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                                    </Select>
                                  </Field>
                                  <SubmitButton size="sm" variant="outline">Simpan penugasan</SubmitButton>
                                </form>
                              )}
                              {lookups && (
                                <form action={updateItemDetailAction} className="space-y-3 border-t border-slate-100 pt-3">
                                  <input type="hidden" name="versionId" value={context.versionId} /><input type="hidden" name="itemId" value={r.budget_item_id} />
                                  <Field label="Sub kegiatan" htmlFor={`s-${r.budget_item_id}`}>
                                    <Select id={`s-${r.budget_item_id}`} name="subActivity" required defaultValue={b.sub_activity_id}>{lookups.subActivities.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select>
                                  </Field>
                                  <Field label="Rekening belanja" htmlFor={`a-${r.budget_item_id}`}>
                                    <Select id={`a-${r.budget_item_id}`} name="account" required defaultValue={b.expenditure_account_id}>{lookups.accounts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select>
                                  </Field>
                                  <Field label="Sumber dana" htmlFor={`f-${r.budget_item_id}`}>
                                    <Select id={`f-${r.budget_item_id}`} name="funding" required defaultValue={b.funding_source_id}>{lookups.funding.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select>
                                  </Field>
                                  <Field label="Uraian" htmlFor={`d-${r.budget_item_id}`}><Input id={`d-${r.budget_item_id}`} name="description" maxLength={500} defaultValue={b.description ?? ""} /></Field>
                                  <SubmitButton size="sm" variant="outline">Simpan rincian</SubmitButton>
                                </form>
                              )}
                              <form action={deleteItemAction} className="border-t border-slate-100 pt-3">
                                <input type="hidden" name="versionId" value={context.versionId} /><input type="hidden" name="itemId" value={r.budget_item_id} />
                                <ConfirmSubmit size="sm" variant="danger" message="Hapus butir anggaran ini dari versi yang sedang dibuka? Draf anggaran kas butir ini ikut terhapus. Tidak bisa dihapus bila sudah ada transaksi realisasi.">Hapus butir</ConfirmSubmit>
                              </form>
                            </div>
                          </details>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr><td colSpan={4} className="px-3 py-3 text-right text-sm font-semibold">Total{q ? " (semua butir)" : ""}</td><td className="num px-3 py-3 font-bold text-navy-900">{formatRupiah(total)}</td>{editable && <td />}</tr></tfoot>
            </table>
          </TableWrap>
        )}
      </Card>
      <SignatureBlock />
      <PrintFooter />
    </div>
  );
}
