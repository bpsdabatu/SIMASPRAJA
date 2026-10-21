import "server-only";
import { userClient } from "@/lib/supabase/server";

export interface Opt { id: string; label: string }

type Sb = Awaited<ReturnType<typeof userClient>>;

async function codeName(sb: Sb, table: string): Promise<Opt[]> {
  const { data } = await sb.from(table).select("id, code, name").eq("is_active", true).order("code").limit(1000);
  return (data ?? []).map((r) => ({ id: r.id as string, label: `${r.code} — ${r.name}` }));
}

/** Pengguna aktif berperan tertentu (membutuhkan hak baca user_roles: admin). Gagal -> daftar kosong. */
export async function usersWithRole(sb: Sb, role: "pptk" | "ppk" | "ppbj"): Promise<Opt[]> {
  const { data } = await sb
    .from("user_roles")
    .select("user_id, profiles!inner(id, full_name, status)")
    .eq("role_code", role);
  const out: Opt[] = [];
  for (const r of (data ?? []) as unknown as Array<{ profiles: { id: string; full_name: string; status: string } | { id: string; full_name: string; status: string }[] }>) {
    const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
    if (p && p.status === "active") out.push({ id: p.id, label: p.full_name });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, "id"));
}

export async function loadBudgetLookups(sb: Sb) {
  const [subActivities, accounts, funding, pptk] = await Promise.all([
    codeName(sb, "sub_activities"), codeName(sb, "expenditure_accounts"), codeName(sb, "funding_sources"),
    usersWithRole(sb, "pptk"),
  ]);
  return { subActivities, accounts, funding, pptk };
}

export async function loadSuppliersMethods(sb: Sb) {
  const [{ data: sup }, methods] = await Promise.all([
    sb.from("suppliers").select("id, name").eq("is_active", true).order("name").limit(1000),
    codeName(sb, "procurement_methods"),
  ]);
  return { suppliers: (sup ?? []).map((s) => ({ id: s.id as string, label: s.name as string })), methods };
}

export async function getOrganizationName(sb: Sb, organizationId: string): Promise<string> {
  const { data } = await sb.from("organizations").select("name").eq("id", organizationId).maybeSingle();
  return (data?.name as string | undefined) ?? "";
}

export interface TreeProgram { id: string; code: string; name: string }
export interface TreeActivity { id: string; programId: string; code: string; name: string }
export interface TreeSub { id: string; activityId: string; code: string; name: string }
export interface TreeFlat { id: string; code: string; name: string }
export interface BudgetTree {
  programs: TreeProgram[]; activities: TreeActivity[]; subs: TreeSub[];
  accounts: TreeFlat[]; funding: TreeFlat[]; pptk: Opt[];
}

/** Pohon master untuk formulir bertingkat Input Anggaran: Program → Kegiatan → Sub Kegiatan, plus rekening, sumber dana, PPTK (hanya yang aktif). */
export async function loadBudgetTree(sb: Sb): Promise<BudgetTree> {
  const act = (t: string, cols: string) => sb.from(t).select(cols).eq("is_active", true).order("code").limit(5000);
  const [pg, ac, su, ex, fu, pptk] = await Promise.all([
    act("programs", "id, code, name"), act("activities", "id, program_id, code, name"), act("sub_activities", "id, activity_id, code, name"),
    act("expenditure_accounts", "id, code, name"), act("funding_sources", "id, code, name"), usersWithRole(sb, "pptk"),
  ]);
  type R = Record<string, string>;
  const rows = (r: { data: unknown }) => (r.data ?? []) as unknown as R[];
  return {
    programs: rows(pg).map((r) => ({ id: r.id!, code: r.code!, name: r.name! })),
    activities: rows(ac).map((r) => ({ id: r.id!, programId: r.program_id!, code: r.code!, name: r.name! })),
    subs: rows(su).map((r) => ({ id: r.id!, activityId: r.activity_id!, code: r.code!, name: r.name! })),
    accounts: rows(ex).map((r) => ({ id: r.id!, code: r.code!, name: r.name! })),
    funding: rows(fu).map((r) => ({ id: r.id!, code: r.code!, name: r.name! })),
    pptk,
  };
}
