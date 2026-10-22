import { NextResponse } from "next/server";
import { userClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { buildXlsx, xlsxHeaders, type SheetSpec } from "@/lib/spreadsheet";

export const dynamic = "force-dynamic";

/** Templat impor realisasi: kolom sama dengan laporan "Pencarian Realisasi per Metode" + lembar referensi nama persis dari Data Master. */
export async function GET() {
  const user = await getSessionUser();
  if (!user || !(user.permissions.has("realization.edit") || user.permissions.has("realization.correct"))) return new NextResponse("Tidak berwenang", { status: 403 });
  const sb = await userClient();
  const [subs, accts, funds, methods, roles] = await Promise.all([
    sb.from("sub_activities").select("code, name").eq("is_active", true).order("code").limit(5000),
    sb.from("expenditure_accounts").select("code, name").eq("is_active", true).order("code").limit(5000),
    sb.from("funding_sources").select("code, name").eq("is_active", true).order("code").limit(500),
    sb.from("procurement_methods").select("code, name").eq("is_active", true).order("code").limit(200),
    sb.from("user_roles").select("profiles!inner(username, full_name, status)").eq("role_code", "pptk").limit(2000),
  ]);
  const pptk: string[][] = [];
  for (const r of (roles.data ?? []) as unknown as Array<{ profiles: { username: string; full_name: string; status: string } | { username: string; full_name: string; status: string }[] }>) {
    const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
    if (p && p.status === "active") pptk.push([p.username, p.full_name]);
  }
  const first = (d: { name: unknown }[] | null, fb: string) => (d && d[0] ? String(d[0].name) : fb);
  const sheets: SheetSpec[] = [
    {
      name: "Rincian Transaksi",
      header: ["No", "Tgl Transaksi", "Uraian", "Sub Kegiatan", "Nama Belanja", "Sumber Dana", "Metode Pemilihan", "Nominal (Rp)", "Tgl SP2D", "PPTK"],
      rows: [[1, "23/01/2026", "Contoh uraian transaksi", first(subs.data, "Nama Sub Kegiatan"), first(accts.data, "Nama Belanja"), first(funds.data, "PAD"), first(methods.data, "Pengadaan Langsung"), 560000, "10/02/2026", pptk[0]?.[1] ?? "NAMA PPTK"]],
      widths: [6, 14, 36, 50, 50, 14, 22, 16, 14, 28], moneyCols: [7],
    },
    { name: "Ref Sub Kegiatan", header: ["kode", "nama (isi persis di kolom Sub Kegiatan)"], rows: (subs.data ?? []).map((s) => [String(s.code), String(s.name)]), widths: [22, 80] },
    { name: "Ref Belanja", header: ["kode_rekening", "nama (isi persis di kolom Nama Belanja)"], rows: (accts.data ?? []).map((a) => [String(a.code), String(a.name)]), widths: [24, 80] },
    { name: "Ref Sumber Dana", header: ["kode", "nama"], rows: (funds.data ?? []).map((f) => [String(f.code), String(f.name)]), widths: [16, 40] },
    { name: "Ref PPTK", header: ["username", "nama_lengkap (nama tanpa gelar juga dikenali)"], rows: pptk, widths: [24, 44] },
    { name: "Ref Metode", header: ["kode", "nama"], rows: (methods.data ?? []).map((m) => [String(m.code), String(m.name)]), widths: [12, 60] },
  ];
  const buf = await buildXlsx(sheets);
  return new NextResponse(new Uint8Array(buf), { headers: xlsxHeaders("templat-impor-realisasi.xlsx") });
}
