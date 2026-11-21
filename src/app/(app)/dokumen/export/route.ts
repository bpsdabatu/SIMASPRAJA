import { NextResponse, type NextRequest } from "next/server";
import { userClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { csvResponseHeaders, toCsv } from "@/lib/csv";
import { buildXlsx, xlsxHeaders } from "@/lib/spreadsheet";
import { DOC_TYPES } from "@/lib/documents";
import { DOC_STATUS } from "@/lib/status";
import { formatDateTimeWIB } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Unduh daftar Dokumen Pengadaan (filter status sama dengan halaman). RLS membatasi baris sesuai peran pengguna. */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !user.permissions.has("document.view")) return new NextResponse("Tidak berwenang", { status: 403 });
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") ?? "";
  const sb = await userClient();
  let q = sb.from("procurement_documents").select("id, doc_type, title, status, created_at, cancel_reason").order("created_at", { ascending: false }).limit(2000);
  if (status && DOC_STATUS[status]) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return new NextResponse("Data tidak dapat dimuat", { status: 500 });
  const rows = data ?? [];
  // Isi revisi terbaru (nomor, tanggal, perihal) agar keluaran memuat data dokumen, bukan hanya judul.
  const ids = rows.map((r) => r.id);
  const latest = new Map<string, Record<string, string>>();
  if (ids.length > 0) {
    const { data: revs } = await sb.from("document_revisions").select("document_id, revision_no, content").in("document_id", ids).order("revision_no", { ascending: false });
    for (const r of revs ?? []) if (!latest.has(r.document_id)) latest.set(r.document_id, (r.content ?? {}) as Record<string, string>);
  }
  const header = ["No", "Judul", "Jenis", "Nomor Dokumen", "Tanggal Dokumen", "Perihal / Paket", "HPS (Rp)", "Status", "Dibuat", "Alasan Pembatalan"];
  const body = rows.map((d, i) => {
    const c = latest.get(d.id) ?? {};
    return [i + 1, d.title, DOC_TYPES[d.doc_type]?.label ?? d.doc_type, c.nomor ?? "", c.tanggal ?? "", c.perihal ?? "", c.hps ?? "", DOC_STATUS[d.status]?.label ?? d.status, formatDateTimeWIB(d.created_at), d.cancel_reason ?? ""];
  });
  const base = `dokumen-pengadaan${status ? `-${status}` : ""}`;
  if (sp.get("format") === "csv") return new NextResponse(toCsv([header, ...body]), { headers: csvResponseHeaders(`${base}.csv`) });
  const buf = await buildXlsx([{ name: "Dokumen Pengadaan", title: ["Daftar Dokumen Pengadaan"], header, rows: body, widths: [6, 44, 30, 22, 16, 40, 18, 24, 22, 30], moneyCols: [] }]);
  return new NextResponse(new Uint8Array(buf), { headers: xlsxHeaders(`${base}.xlsx`) });
}
