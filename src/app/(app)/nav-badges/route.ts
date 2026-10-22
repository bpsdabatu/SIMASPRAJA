import { NextResponse } from "next/server";
import { getBudgetContext, getSessionUser } from "@/lib/auth/session";
import { userClient } from "@/lib/supabase/server";
import { loadNavBadges } from "@/lib/nav-badges";

export const dynamic = "force-dynamic";

/** Lencana jumlah pekerjaan per menu. Dimuat SETELAH halaman tampil (tidak lagi memblokir render setiap pindah menu). Hanya untuk pengguna masuk. */
export async function GET() {
  const [user, context] = await Promise.all([getSessionUser(), getBudgetContext()]);
  if (!user || !context) return NextResponse.json({}, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  const badges = await loadNavBadges(await userClient(), context.versionId, user.permissions);
  return NextResponse.json(badges, { headers: { "Cache-Control": "private, no-store" } });
}
