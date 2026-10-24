import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import { requireContext } from "@/lib/auth/session";
import { userClient } from "@/lib/supabase/server";
import { formatRupiah } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { RealizationImportPanel } from "./import-panel";

export const metadata: Metadata = { title: "Impor Realisasi" };
export const dynamic = "force-dynamic";

interface Batch { id: string; file_name: string; basis: string; rows_in_file: number; total_in_file: string | number; created_at: string; profiles: { full_name: string } | { full_name: string }[] | null }

export default async function ImporRealisasiPage() {
  const { user, context } = await requireContext();
  const isAdmin = user.permissions.has("realization.correct");
  if (!isAdmin) {
    return <Card><div className="p-6 text-sm text-slate-600">Impor realisasi dari berkas hanya dapat dilakukan oleh Admin. PPTK menginput realisasi per transaksi di menu Input Realisasi.</div></Card>;
  }
  const supabase = await userClient();
  const { data: cv } = await supabase.from("budget_versions").select("fiscal_year_id").eq("id", context.versionId).maybeSingle();
  const [batches, counts] = await Promise.all([
    cv ? supabase.from("realization_import_batches").select("id, file_name, basis, rows_in_file, total_in_file, created_at, profiles:created_by(full_name)").eq("fiscal_year_id", cv.fiscal_year_id).order("created_at", { ascending: false }).limit(15) : Promise.resolve({ data: [] as Batch[], error: null }),
    cv ? supabase.from("realization_transactions").select("import_batch_id").not("import_batch_id", "is", null).limit(10000) : Promise.resolve({ data: [] as { import_batch_id: string }[] }),
  ]);
  // ---- daftar periksa prasyarat ----
  const head = (t: string) => supabase.from(t).select("id", { count: "exact", head: true });
  const [cSub, cAcc, cFund, cPptk, cItems, vers] = await Promise.all([
    head("sub_activities").eq("is_active", true), head("expenditure_accounts").eq("is_active", true), head("funding_sources").eq("is_active", true),
    supabase.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role_code", "pptk"),
    cv ? supabase.from("budget_items").select("id", { count: "exact", head: true }).eq("fiscal_year_id", cv.fiscal_year_id) : Promise.resolve({ count: 0 }),
    cv ? supabase.from("budget_versions").select("stage_code, version_no, status, dpa_date").eq("fiscal_year_id", cv.fiscal_year_id).order("created_at") : Promise.resolve({ data: [] as { stage_code: string; version_no: number; status: string; dpa_date: string | null }[] }),
  ]);
  const nSub = cSub.count ?? 0, nAcc = cAcc.count ?? 0, nFund = cFund.count ?? 0, nPptk = cPptk.count ?? 0, nItems = (cItems as { count: number | null }).count ?? 0;
  const versions = ((vers as { data: { stage_code: string; version_no: number; status: string; dpa_date: string | null }[] | null }).data ?? []);
  const dpaOk = versions.some((v) => v.dpa_date);
  const checks = [
    { ok: nSub > 0 && nAcc > 0 && nFund > 0, text: `Data Master: ${nSub} sub kegiatan, ${nAcc} rekening belanja, ${nFund} sumber dana`, fix: "/master", fixLabel: "Data Master" },
    { ok: nPptk > 0, text: `Akun PPTK: ${nPptk}${nPptk === 0 ? " (boleh dibuat dari berkas saat Periksa dulu)" : ""}`, fix: "/master?tab=pptk", fixLabel: "Tambah PPTK" },
    { ok: nItems > 0, text: `Butir anggaran TA ${context.year}: ${nItems}`, fix: "/anggaran", fixLabel: "Input Anggaran" },
    { ok: dpaOk, text: versions.length ? `Tanggal DPA: ${versions.map((v) => `${v.stage_code} v${v.version_no} ${v.dpa_date ? v.dpa_date.split("-").reverse().join("/") : "belum diisi"}`).join(" · ")}` : "Belum ada versi anggaran", fix: "/anggaran", fixLabel: "Isi tanggal DPA" },
  ];
  const perBatch = new Map<string, number>();
  for (const r of (counts.data ?? []) as { import_batch_id: string }[]) perBatch.set(r.import_batch_id, (perBatch.get(r.import_batch_id) ?? 0) + 1);
  const list = ((batches.data ?? []) as unknown as Batch[]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Impor Realisasi"
        description={`Tahun Anggaran ${context.year}. Tahapan (Murni/Pergeseran/Perubahan) ditentukan otomatis dari tanggal penetapan DPA.`}
        actions={<Link href="/realisasi" className="no-print inline-flex items-center gap-1 text-sm font-medium text-navy-700 hover:underline"><ArrowLeft size={14} aria-hidden /> Input Realisasi</Link>}
      />
      <Card>
        <CardHeader title="Prasyarat sebelum impor" description={`Konteks yang dibuka: Tahun Anggaran ${context.year}. Semua harus hijau agar baris dapat diterima.`} />
        <ul className="grid gap-2 p-4 sm:grid-cols-2">
          {checks.map((c) => (
            <li key={c.text} className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${c.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"}`}>
              {c.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden /> : <XCircle size={16} className="mt-0.5 shrink-0" aria-hidden />}
              <span className="min-w-0 flex-1">{c.text}</span>
              {!c.ok && <Link href={c.fix} className="shrink-0 text-xs font-semibold underline">{c.fixLabel}</Link>}
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Unggah laporan realisasi" description="Khusus Admin. Setiap unggahan tercatat sebagai batch (berkas, pelaku, waktu); mengunggah ulang berkas yang sama tidak menggandakan data." />
        <div className="p-5"><RealizationImportPanel canCreateMethods={user.permissions.has("master.manage")} /></div>
      </Card>
      <Card>
        <CardHeader title="Riwayat impor" description="15 unggahan terakhir pada tahun anggaran ini." />
        {list.length === 0 ? <p className="p-5 text-sm text-slate-500">Belum ada impor.</p> : (
          <div className="overflow-x-auto"><table className="table-base">
            <thead><tr><th>Waktu</th><th>Berkas</th><th>Dasar tahapan</th><th>Pelaku</th><th className="text-right">Baris berkas</th><th className="text-right">Nilai berkas</th><th className="text-right">Tersimpan</th></tr></thead>
            <tbody>{list.map((b) => (
              <tr key={b.id}>
                <td className="whitespace-nowrap tabular-nums">{new Date(b.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" })}</td>
                <td className="max-w-[16rem] truncate" title={b.file_name}>{b.file_name}</td>
                <td>{b.basis === "sp2d" ? "Tgl SP2D" : "Tgl transaksi"}</td>
                <td>{(Array.isArray(b.profiles) ? b.profiles[0] : b.profiles)?.full_name ?? "—"}</td>
                <td className="num">{b.rows_in_file}</td>
                <td className="num">{formatRupiah(Number(b.total_in_file))}</td>
                <td className="num font-medium">{perBatch.get(b.id) ?? 0}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
