import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { adminClient } from "@/lib/supabase/admin";
import { loadTempPasswords } from "@/lib/auth/temp-credential";
import { csvResponseHeaders, toCsv } from "@/lib/csv";
import { buildXlsx, xlsxHeaders } from "@/lib/spreadsheet";
import { ROLE_LABEL } from "@/lib/nav";
import { formatDateTimeWIB } from "@/lib/format";

export const dynamic = "force-dynamic";
const STATUS: Record<string, string> = { active: "Aktif", suspended: "Ditangguhkan", disabled: "Nonaktif" };

/** Rekap akun untuk ADMIN: username, nama, peran, status, dan kata sandi sementara (hanya bila belum diganti pengguna). Berkas bersifat rahasia. */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !user.permissions.has("users.manage")) return new NextResponse("Tidak berwenang", { status: 403 });
  const admin = adminClient();
  const { data, error } = await admin.from("profiles").select("id, username, full_name, nip, position_title, status, last_login_at, must_change_password, user_roles(role_code)")
    .eq("organization_id", user.organizationId).order("full_name").limit(2000);
  if (error) return new NextResponse("Data tidak dapat dimuat", { status: 500 });
  const rows = (data ?? []) as unknown as { id: string; username: string; full_name: string; nip: string | null; position_title: string | null; status: string; last_login_at: string | null; must_change_password: boolean; user_roles: { role_code: string }[] }[];
  const temp = await loadTempPasswords(rows.filter((r) => r.must_change_password).map((r) => r.id));
  const header = ["Username", "Nama Lengkap", "NIP", "Jabatan", "Peran", "Status", "Kata Sandi Sementara", "Keterangan Kata Sandi", "Terakhir Masuk"];
  const body = rows.map((r) => [
    r.username, r.full_name, r.nip ?? "", r.position_title ?? "", r.user_roles.map((x) => ROLE_LABEL[x.role_code] ?? x.role_code).join(", "), STATUS[r.status] ?? r.status,
    temp.map.get(r.id) ?? "", temp.map.get(r.id) ? "Sementara; wajib diganti saat masuk" : r.must_change_password ? "Belum diganti; lakukan Reset" : "Sudah diganti pengguna (tidak dapat dilihat)",
    r.last_login_at ? formatDateTimeWIB(r.last_login_at) : "Belum pernah",
  ]);
  const noStore = { "Cache-Control": "no-store" };
  if (req.nextUrl.searchParams.get("format") === "csv") return new NextResponse(toCsv([header, ...body]), { headers: { ...csvResponseHeaders("rekap-akun.csv"), ...noStore } });
  const buf = await buildXlsx([{ name: "Rekap Akun", title: ["Rekap Akun SIMASPRAJA — RAHASIA"], header, rows: body, widths: [18, 30, 22, 28, 22, 14, 22, 36, 22] }]);
  return new NextResponse(new Uint8Array(buf), { headers: xlsxHeaders("rekap-akun.xlsx") });
}
