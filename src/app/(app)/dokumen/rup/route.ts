import { NextResponse, type NextRequest } from "next/server";
import { userClient } from "@/lib/supabase/server";
import { requireContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** Pencarian RUP (Kode RUP atau nama paket) untuk tahun anggaran konteks aktif. Dibatasi RLS (master.view). */
export async function GET(req: NextRequest) {
  let ctx;
  try { ctx = await requireContext(); } catch { return NextResponse.json({ error: "Tidak berwenang" }, { status: 401 }); }
  if (!ctx.user.permissions.has("document.view")) return NextResponse.json({ error: "Tidak berwenang" }, { status: 403 });
  // hanya huruf/angka/spasi/tanda baca aman agar tidak mengubah sintaks filter PostgREST
  const q = (req.nextUrl.searchParams.get("q") ?? "").normalize("NFKC").replace(/[^\p{L}\p{N}\s._\-/]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  if (q.length < 2) return NextResponse.json({ results: [] });
  const sb = await userClient();
  const { data: fy } = await sb.from("fiscal_years").select("id").eq("year", ctx.context.year).maybeSingle();
  if (!fy) return NextResponse.json({ results: [] });
  const like = `%${q.replace(/[%_]/g, "")}%`;
  const { data, error } = await sb.from("rup_references")
    .select("id, rup_code, package_name, pagu, jenis_pengadaan, metode_pemilihan, sumber_dana, lokasi, satuan_kerja, waktu_pekerjaan")
    .eq("fiscal_year_id", fy.id).eq("is_active", true).or(`rup_code.ilike.${like},package_name.ilike.${like}`).order("package_name").limit(15);
  if (error) return NextResponse.json({ results: [], error: "Pencarian gagal" }, { status: 500 });
  return NextResponse.json({ results: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
