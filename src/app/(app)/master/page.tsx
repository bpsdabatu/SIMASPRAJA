import type { Metadata } from "next";
import Link from "next/link";
import { Download, FileSpreadsheet, Plus, Upload } from "lucide-react";
import { requireModule } from "@/lib/auth/guard";
import { userClient } from "@/lib/supabase/server";
import { MASTER, MASTER_KEYS, type MasterEntity } from "@/lib/master-config";
import { IMPORT_SPECS, STANDARD_PROCUREMENT_METHODS } from "@/lib/master-import";
import { SEED_LABEL, SEED_ORDER, seedCounts } from "@/lib/master-seed";
import { SEED_PPTK_NAMES } from "@/data/master-bapersuda";
import { Badge, Card, CardHeader } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { EmptyState, Flash, PageHeader, TableWrap } from "@/components/ui/page";
import { ConfirmSubmit, PrintButton, SubmitButton } from "@/components/ui/submit-button";
import { PrintFooter, PrintHeader } from "@/components/ui/report";
import { getOrganizationName } from "@/lib/lookups";
import { PptkAddForm } from "./pptk-add-form";
import { PptkImportForm } from "./pptk-import-form";
import { cn } from "@/lib/utils";
import { deleteMasterAction, importMasterAction, importMasterWorkbookAction, seedMasterBawaanAction, seedProcurementMethodsAction, saveMasterAction, toggleMasterAction } from "./actions";

export const metadata: Metadata = { title: "Data Master" };
export const dynamic = "force-dynamic";

type Row = Record<string, unknown> & { id: string; is_active?: boolean };
interface ParentOpt { id: string; label: string }

async function loadParents(cfg: MasterEntity): Promise<ParentOpt[]> {
  if (!cfg.parent) return [];
  const supabase = await userClient();
  if (cfg.parent.labelOf === "year") {
    const { data } = await supabase.from(cfg.parent.table).select("id, year").order("year", { ascending: false });
    return (data ?? []).map((r) => ({ id: r.id as string, label: String(r.year) }));
  }
  const { data } = await supabase.from(cfg.parent.table).select("id, code, name").eq("is_active", true).order("code");
  return (data ?? []).map((r) => ({ id: r.id as string, label: `${r.code} — ${r.name}` }));
}

function FieldInputs({ cfg, parents, row }: { cfg: MasterEntity; parents: ParentOpt[]; row?: Row }) {
  const pid = row ? `-${row.id}` : "";
  return (
    <>
      {cfg.parent && (
        <Field label={cfg.parent.label} htmlFor={`parent${pid}`} className="sm:col-span-2">
          <Select id={`parent${pid}`} name={cfg.parent.key} required defaultValue={(row?.[cfg.parent.key] as string) ?? ""}>
            <option value="" disabled>Pilih {cfg.parent.label.toLowerCase()}</option>
            {parents.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </Select>
        </Field>
      )}
      {cfg.fields.map((f) => (
        <Field key={f.key} label={f.label} htmlFor={`${f.key}${pid}`} className={f.kind === "textarea" ? "sm:col-span-2" : undefined}>
          {f.kind === "textarea" ? (
            <Textarea id={`${f.key}${pid}`} name={f.key} maxLength={f.max} defaultValue={(row?.[f.key] as string) ?? ""} />
          ) : (
            <Input id={`${f.key}${pid}`} name={f.key} required={f.required} maxLength={f.max} defaultValue={(row?.[f.key] as string) ?? ""} className={f.mono ? "font-mono" : undefined} />
          )}
        </Field>
      ))}
    </>
  );
}

export default async function MasterPage({ searchParams }: { searchParams: Promise<{ tab?: string; ok?: string; err?: string; q?: string }> }) {
  const { user } = await requireModule("master.view");
  const sp = await searchParams;
  const canUsers = user.permissions.has("users.manage");
  const isPptk = sp.tab === "pptk" && canUsers;
  const tab = isPptk ? "programs" : sp.tab && MASTER[sp.tab] ? sp.tab : "programs";
  const cfg = MASTER[tab]!;
  const canManage = user.permissions.has("master.manage");
  const supabase = await userClient();
  const org = await getOrganizationName(supabase, user.organizationId);

  if (isPptk) return <PptkTab sp={sp} org={org} />;

  const q = (sp.q ?? "").trim().slice(0, 60);
  let query = supabase.from(cfg.table).select("*").order(cfg.orderBy).limit(500);
  if (q) {
    const first = cfg.fields[0]!.key;
    const col = first === "code" || first === "rup_code" ? first : "name";
    query = query.ilike(col, `%${q.replace(/[%_]/g, "")}%`);
  }
  const [{ data, error }, parents] = await Promise.all([query, loadParents(cfg)]);
  const rows = (data ?? []) as Row[];
  const parentLabel = new Map(parents.map((p) => [p.id, p.label]));

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PrintHeader orgName={org} title={`Data Master — ${cfg.label}`} subtitle="Referensi klasifikasi anggaran dan pengadaan" />
      <PageHeader
        eyebrow="Administrasi"
        title="Data Master"
        description="Referensi klasifikasi anggaran dan pengadaan. Unggah massal dari Excel/CSV, tambah, ubah, hapus (bila belum dipakai), atau nonaktifkan agar riwayat tetap utuh."
        actions={<>
          <a href={`/master/export?tab=${tab}&format=xlsx`} className={buttonVariants({ variant: "outline" })}><Download size={16} aria-hidden /> Excel</a>
          <a href={`/master/export?tab=${tab}&format=csv`} className={buttonVariants({ variant: "outline" })}><Download size={16} aria-hidden /> CSV</a>
          <PrintButton />
        </>}
      />
      <Flash ok={sp.ok} err={sp.err} />

      <MasterTabs tab={tab} canUsers={canUsers} />

      {canManage && tab === "programs" && (
        <Card className="no-print overflow-hidden">
          <div className="grid gap-4 bg-gradient-to-r from-navy-50 via-white to-gold-50 p-5 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <p className="text-sm font-semibold text-navy-900">Muat data master bawaan Bagian Perekonomian dan SDA</p>
              <p className="mt-1 text-sm text-slate-600">
                {SEED_ORDER.map((k) => `${seedCounts()[k]} ${SEED_LABEL[k].toLowerCase()}`).join(" · ")}. Aditif dan aman diulang: hanya kode yang belum ada yang ditambahkan;
                data yang sudah ada (termasuk yang sudah dipakai anggaran/transaksi) tidak diubah. PPTK dibuat sebagai akun melalui tab PPTK.
              </p>
            </div>
            <form action={seedMasterBawaanAction}><SubmitButton variant="accent" pendingText="Memuat...">Muat data bawaan</SubmitButton></form>
          </div>
        </Card>
      )}

      {tab === "procurement_methods" && (
        <Card className="no-print p-5">
          <p className="text-sm font-semibold text-navy-900">Metode pengadaan baku (Perpres 16/2018 jo. Perpres 12/2021 dan Perpres 46/2025)</p>
          <p className="mt-1 text-sm text-slate-600">Isi tab ini dengan <b>cara/metode pemilihan</b> yang dipakai pada pengadaan barang/jasa; dipilih pada transaksi realisasi. Metode pemilihan penyedia: E-Purchasing, Pengadaan Langsung, Penunjukan Langsung, Tender Cepat, Tender, Seleksi (khusus jasa konsultansi); atau Swakelola Tipe I–IV. Pilihan metode bergantung pada jenis pengadaan, nilai, dan keadaan; ambang nilai berubah-ubah, jadi rujuk ketentuan LKPP terbaru.</p>
          <ul className="mt-2 grid gap-x-6 gap-y-0.5 text-xs text-slate-600 sm:grid-cols-2">{STANDARD_PROCUREMENT_METHODS.map(([c, n]) => <li key={c}><span className="font-mono text-slate-500">{c}</span> — {n}</li>)}</ul>
          {canManage && <form action={seedProcurementMethodsAction} className="mt-3"><SubmitButton variant="accent" pendingText="Menambah...">Isi metode baku (yang belum ada saja)</SubmitButton></form>}
        </Card>
      )}

      {canManage && (
        <Card className="no-print">
          <details>
            <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 text-sm font-semibold text-navy-800 [&::-webkit-details-marker]:hidden">
              <Upload size={16} aria-hidden /> Unggah satu berkas Excel berisi banyak sheet (Program, Kegiatan, Sub Kegiatan, Belanja, Sumber Dana)
            </summary>
            <form action={importMasterWorkbookAction} encType="multipart/form-data" className="space-y-4 border-t border-slate-100 p-5">
              <p className="text-sm text-slate-600">Sheet dikenali dari namanya (<code className="rounded bg-slate-100 px-1">PROGRAM, KEGIATAN, SUB KEGIATAN, BELANJA, SUMBER DANA</code>) dan diproses berurutan. Kolom: <code className="rounded bg-slate-100 px-1">Kode, Nama</code>. Kode induk (program/kegiatan) diturunkan otomatis dari kode. Aman diulang: kode yang sudah ada dilewati.</p>
              <Field label="Berkas Excel (.xlsx)" htmlFor="wb-file"><Input id="wb-file" name="file" type="file" accept=".xlsx" required className="h-auto py-2" /></Field>
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" name="updateExisting" value="true" className="h-4 w-4 rounded border-slate-300" /> Perbarui nama bila kode sudah ada</label>
              <SubmitButton variant="accent" pendingText="Mengimpor...">Unggah berkas</SubmitButton>
            </form>
          </details>
        </Card>
      )}

      {canManage && IMPORT_SPECS[tab] && (
        <Card className="no-print">
          <details>
            <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 text-sm font-semibold text-navy-800 [&::-webkit-details-marker]:hidden">
              <Upload size={16} aria-hidden /> Unggah {cfg.label} dari Excel / CSV
            </summary>
            <form action={importMasterAction} encType="multipart/form-data" className="space-y-4 border-t border-slate-100 p-5">
              <input type="hidden" name="entity" value={tab} />
              <p className="text-sm text-slate-600">
                Kolom: <code className="rounded bg-slate-100 px-1">{IMPORT_SPECS[tab]!.columns.map((c) => c.label).join("; ")}</code>.
                {cfg.parent ? ` Kode ${cfg.parent.label.toLowerCase()} harus sudah ada di Data Master.` : ""} Bila ada satu baris bermasalah, impor dibatalkan seluruhnya.
              </p>
              <div className="flex flex-wrap gap-2">
                <a href={`/master/template?tab=${tab}&format=xlsx`} className={buttonVariants({ variant: "outline", size: "sm" })}><FileSpreadsheet size={14} aria-hidden /> Templat Excel</a>
                <a href={`/master/template?tab=${tab}&format=csv`} className={buttonVariants({ variant: "outline", size: "sm" })}><FileSpreadsheet size={14} aria-hidden /> Templat CSV</a>
              </div>
              <Field label="Berkas Excel (.xlsx) atau CSV" htmlFor="master-file"><Input id="master-file" name="file" type="file" accept=".xlsx,.csv,.txt" required className="h-auto py-2" /></Field>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" name="updateExisting" value="true" className="h-4 w-4 rounded border-slate-300" />
                Perbarui nama/uraian bila kode sudah ada (bila tidak dicentang, baris dengan kode yang sudah ada dilewati)
              </label>
              <SubmitButton variant="accent" pendingText="Mengimpor...">Unggah</SubmitButton>
            </form>
          </details>
        </Card>
      )}

      {canManage && (
        <Card className="no-print">
          <details>
            <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 text-sm font-semibold text-navy-800 [&::-webkit-details-marker]:hidden">
              <Plus size={16} aria-hidden /> Tambah {cfg.label}
            </summary>
            <form action={saveMasterAction} className="grid gap-4 border-t border-slate-100 p-5 sm:grid-cols-2">
              <input type="hidden" name="entity" value={tab} />
              <FieldInputs cfg={cfg} parents={parents} />
              <div className="sm:col-span-2"><SubmitButton pendingText="Menyimpan...">Simpan</SubmitButton></div>
            </form>
          </details>
        </Card>
      )}

      <Card>
        <CardHeader
          title={`${cfg.label} (${rows.length}${rows.length === 500 ? "+" : ""})`}
          actions={
            <form className="no-print flex gap-2" action="/master">
              <input type="hidden" name="tab" value={tab} />
              <Input name="q" defaultValue={q} placeholder="Cari..." aria-label="Cari" className="h-9 w-48" />
              <Button type="submit" variant="outline" size="sm" className="h-9">Cari</Button>
            </form>
          }
        />
        {error ? <EmptyState title="Data tidak dapat dimuat">Muat ulang halaman atau hubungi administrator.</EmptyState>
          : rows.length === 0 ? <EmptyState title={`Belum ada ${cfg.label.toLowerCase()}`}>{canManage ? "Gunakan tombol Tambah di atas." : "Hubungi administrator untuk mengisi data master."}</EmptyState>
          : (
          <TableWrap>
            <table className="table-base">
              <thead>
                <tr>
                  {cfg.parent && <th>{cfg.parent.label}</th>}
                  {cfg.fields.map((f) => <th key={f.key}>{f.label}</th>)}
                  <th>Status</th>
                  {canManage && <th className="no-print text-right">Aksi</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.is_active === false ? "opacity-60" : undefined}>
                    {cfg.parent && <td className="text-slate-600">{parentLabel.get(r[cfg.parent.key] as string) ?? "—"}</td>}
                    {cfg.fields.map((f) => <td key={f.key} className={f.mono ? "font-mono text-[13px]" : undefined}>{(r[f.key] as string) || "—"}</td>)}
                    <td><Badge tone={r.is_active === false ? "slate" : "green"}>{r.is_active === false ? "Nonaktif" : "Aktif"}</Badge></td>
                    {canManage && (
                      <td className="no-print text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <details className="relative text-left">
                            <summary className="inline-flex h-8 cursor-pointer list-none items-center rounded-lg bg-navy-50 px-3 text-xs font-semibold text-navy-700 hover:bg-navy-100 [&::-webkit-details-marker]:hidden">Ubah</summary>
                            <form action={saveMasterAction} className="absolute right-0 z-20 mt-2 grid w-[min(92vw,26rem)] gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-lift sm:grid-cols-2">
                              <input type="hidden" name="entity" value={tab} />
                              <input type="hidden" name="id" value={r.id} />
                              <FieldInputs cfg={cfg} parents={parents} row={r} />
                              <div className="sm:col-span-2"><SubmitButton size="sm" pendingText="Menyimpan...">Simpan perubahan</SubmitButton></div>
                            </form>
                          </details>
                          <form action={toggleMasterAction}>
                            <input type="hidden" name="entity" value={tab} />
                            <input type="hidden" name="id" value={r.id} />
                            <input type="hidden" name="active" value={r.is_active === false ? "true" : "false"} />
                            <SubmitButton size="sm" variant="outline">{r.is_active === false ? "Aktifkan" : "Nonaktifkan"}</SubmitButton>
                          </form>
                          <form action={deleteMasterAction}>
                            <input type="hidden" name="entity" value={tab} />
                            <input type="hidden" name="id" value={r.id} />
                            <ConfirmSubmit size="sm" variant="danger" message={`Hapus ${cfg.label.toLowerCase()} ini? Penghapusan hanya berhasil bila data belum dipakai data lain; bila sudah dipakai, gunakan Nonaktifkan.`}>Hapus</ConfirmSubmit>
                          </form>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      <PrintFooter />
    </div>
  );
}

function MasterTabs({ tab, canUsers }: { tab: string; canUsers: boolean }) {
  return (
    <nav aria-label="Jenis master" className="no-print flex flex-wrap gap-2">
      {[...MASTER_KEYS, ...(canUsers ? ["pptk"] : [])].map((k) => (
        <Link key={k} href={`/master?tab=${k}`} aria-current={k === tab ? "page" : undefined}
          className={cn("rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
            k === tab ? "bg-navy-700 text-white shadow-sm" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-navy-50")}>
          {k === "pptk" ? "PPTK" : MASTER[k]!.label}
        </Link>
      ))}
    </nav>
  );
}

interface PptkRow { username: string; full_name: string; nip: string | null; position_title: string | null; status: string }

async function PptkTab({ sp, org }: { sp: { ok?: string; err?: string }; org: string }) {
  const supabase = await userClient();
  const { data, error } = await supabase.from("user_roles").select("profiles!inner(username, full_name, nip, position_title, status)").eq("role_code", "pptk").limit(5000);
  const rows = (data ?? []).map((r) => (Array.isArray(r.profiles) ? r.profiles[0] : r.profiles) as unknown as PptkRow).filter(Boolean)
    .sort((a, b) => a.full_name.localeCompare(b.full_name, "id"));
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PrintHeader orgName={org} title="Data Master — PPTK" subtitle="Pejabat Pelaksana Teknis Kegiatan" />
      <PageHeader
        eyebrow="Administrasi"
        title="Data Master"
        description="PPTK adalah akun pengguna berperan PPTK. Unggah daftar dari Excel/CSV untuk membuat akun sekaligus; ubah, tangguhkan, atau atur ulang kata sandi melalui Pengguna & Peran."
        actions={<>
          <a href="/master/export?tab=pptk&format=xlsx" className={buttonVariants({ variant: "outline" })}><Download size={16} aria-hidden /> Excel</a>
          <a href="/master/export?tab=pptk&format=csv" className={buttonVariants({ variant: "outline" })}><Download size={16} aria-hidden /> CSV</a>
          <PrintButton />
        </>}
      />
      <Flash ok={sp.ok} err={sp.err} />
      <MasterTabs tab="pptk" canUsers />
      <Card className="no-print">
        <CardHeader title="Tambah satu PPTK" description="Akun PPTK yang dibuat di sini juga muncul di Pengguna & Peran, dan sebaliknya (satu sumber data: akun berperan PPTK)." />
        <div className="p-5"><PptkAddForm /></div>
      </Card>
      <Card className="no-print">
        <CardHeader title="Unggah PPTK dari Excel / CSV" actions={<>
          <a href="/master/template?tab=pptk&format=xlsx" className={buttonVariants({ variant: "outline", size: "sm" })}><FileSpreadsheet size={14} aria-hidden /> Templat Excel</a>
          <a href="/master/template?tab=pptk&format=csv" className={buttonVariants({ variant: "outline", size: "sm" })}><FileSpreadsheet size={14} aria-hidden /> Templat CSV</a>
          <a href="/master/template?tab=pptk&format=xlsx&prefill=bawaan" className={buttonVariants({ variant: "soft", size: "sm" })} title="Berisi nama PPTK dari master bawaan; username hanya usulan"><FileSpreadsheet size={14} aria-hidden /> Templat berisi {SEED_PPTK_NAMES.length} PPTK bawaan</a>
          <Link href="/pengguna" className={buttonVariants({ variant: "soft", size: "sm" })}>Kelola di Pengguna &amp; Peran</Link>
        </>} />
        <div className="p-5"><PptkImportForm /></div>
      </Card>
      <Card>
        <CardHeader title={`PPTK (${rows.length})`} />
        {error ? <EmptyState title="Data tidak dapat dimuat">Muat ulang halaman atau hubungi administrator.</EmptyState>
          : rows.length === 0 ? <EmptyState title="Belum ada PPTK">Unggah daftar PPTK di atas atau buat akun di Pengguna &amp; Peran.</EmptyState>
          : (
          <TableWrap>
            <table className="table-base">
              <thead><tr><th>Username</th><th>Nama lengkap</th><th>NIP</th><th>Jabatan</th><th>Status</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.username} className={r.status !== "active" ? "opacity-60" : undefined}>
                  <td>@{r.username}</td><td>{r.full_name}</td><td>{r.nip || "—"}</td><td>{r.position_title || "—"}</td>
                  <td><Badge tone={r.status === "active" ? "green" : "slate"}>{r.status === "active" ? "Aktif" : "Nonaktif"}</Badge></td>
                </tr>))}</tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      <PrintFooter />
    </div>
  );
}
