import { NextResponse, type NextRequest } from "next/server";
import { userClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { csvResponseHeaders, toCsv } from "@/lib/csv";
import { buildXlsx, xlsxHeaders, type SheetSpec } from "@/lib/spreadsheet";

export const dynamic = "force-dynamic";

const HEADER = ["kode_sub_kegiatan", "kode_rekening", "sumber_dana", "pptk", "uraian", "pagu"];

/**
 * Templat impor/penyesuaian anggaran (Excel atau CSV). Versi Excel menyertakan lembar "Referensi" berisi kode & nama
 * Program/Kegiatan/Sub Kegiatan, Rekening, Sumber Dana, dan PPTK dari Data Master agar kode tidak salah ketik.
 * Contoh baris memakai data master nyata bila ada.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !user.permissions.has("budget.import")) return new NextResponse("Tidak berwenang", { status: 403 });
  const sb = await userClient();
  const [subs, accts, funds, acts, progs, roles] = await Promise.all([
    sb.from("sub_activities").select("code, name, activity_id").eq("is_active", true).order("code").limit(5000),
    sb.from("expenditure_accounts").select("code, name").eq("is_active", true).order("code").limit(5000),
    sb.from("funding_sources").select("code, name").eq("is_active", true).order("code").limit(500),
    sb.from("activities").select("id, code, name, program_id").limit(5000),
    sb.from("programs").select("id, code, name").limit(5000),
    sb.from("user_roles").select("profiles!inner(username, full_name, status)").eq("role_code", "pptk").limit(2000),
  ]);

  const sample = [subs.data?.[0]?.code ?? "KODE-SUB-KEGIATAN", accts.data?.[0]?.code ?? "KODE-REKENING", funds.data?.[0]?.name ?? "NAMA-SUMBER-DANA", "", "Contoh uraian (boleh dikosongkan)", 1500000];
  if (req.nextUrl.searchParams.get("format") !== "xlsx") return new NextResponse(toCsv([HEADER, sample]), { headers: csvResponseHeaders("templat-impor-anggaran.csv") });

  const actById = new Map((acts.data ?? []).map((a) => [a.id as string, a]));
  const progById = new Map((progs.data ?? []).map((p) => [p.id as string, p]));
  const subRows = (subs.data ?? []).map((s) => {
    const a = actById.get(s.activity_id as string), p = a ? progById.get(a.program_id as string) : undefined;
    return [String(p?.code ?? ""), String(p?.name ?? ""), String(a?.code ?? ""), String(a?.name ?? ""), String(s.code), String(s.name)];
  });
  const pptkRows: string[][] = [];
  for (const r of (roles.data ?? []) as unknown as Array<{ profiles: { username: string; full_name: string; status: string } | { username: string; full_name: string; status: string }[] }>) {
    const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
    if (p && p.status === "active") pptkRows.push([p.username, p.full_name]);
  }
  pptkRows.sort((a, b) => a[1]!.localeCompare(b[1]!, "id"));

  const sheets: SheetSpec[] = [
    { name: "Anggaran", header: HEADER, rows: [sample], widths: [24, 24, 20, 30, 40, 18], moneyCols: [5] },
    { name: "Ref Sub Kegiatan", header: ["kode_program", "program", "kode_kegiatan", "kegiatan", "kode_sub_kegiatan", "sub_kegiatan"], rows: subRows, widths: [12, 36, 16, 40, 20, 50] },
    { name: "Ref Rekening", header: ["kode_rekening", "nama_rekening"], rows: (accts.data ?? []).map((a) => [String(a.code), String(a.name)]), widths: [24, 60] },
    { name: "Ref Sumber Dana", header: ["kode", "nama (boleh dipakai di kolom sumber_dana)"], rows: (funds.data ?? []).map((f) => [String(f.code), String(f.name)]), widths: [16, 40] },
    { name: "Ref PPTK", header: ["username", "nama_lengkap (boleh dipakai di kolom pptk)"], rows: pptkRows, widths: [24, 44] },
  ];
  const buf = await buildXlsx(sheets);
  return new NextResponse(new Uint8Array(buf), { headers: xlsxHeaders("templat-impor-anggaran.xlsx") });
}
