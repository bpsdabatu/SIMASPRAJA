import "server-only";
import { adminClient } from "@/lib/supabase/admin";

/**
 * Penulisan anggaran kas OLEH ADMIN untuk butir milik PPTK (distribusi dari berkas unggahan).
 * ADMIN tidak punya izin cashplan.edit (hanya PPTK penugasan yang punya), jadi penulisan memakai service role dengan pemeriksaan eksplisit
 * yang setara save_cash_plan: butir ada pada versi, milik organisasi yang sama, sudah punya PPTK, status draf/dikembalikan/belum ada,
 * dan total kas ≤ pagu. Hasil selalu DRAF atas nama butir PPTK; PPTK memeriksa lalu mengajukan.
 */
export async function saveManyAsAdmin(actor: { id: string; organizationId: string }, versionId: string, rows: { itemId: string; months: number[]; label: string }[]) {
  const admin = adminClient();
  let saved = 0;
  const gagal: string[] = [];
  for (const r of rows) {
    try {
      const [iv, item, plan] = await Promise.all([
        admin.from("budget_item_versions").select("pagu").eq("budget_version_id", versionId).eq("budget_item_id", r.itemId).maybeSingle(),
        admin.from("budget_items").select("organization_id, pptk_id").eq("id", r.itemId).maybeSingle(),
        admin.from("cash_budget_plans").select("id, status").eq("budget_version_id", versionId).eq("budget_item_id", r.itemId).maybeSingle(),
      ]);
      if (iv.error || item.error || plan.error) { gagal.push(`${r.label}: data tidak dapat dibaca`); continue; }
      if (!iv.data || !item.data || item.data.organization_id !== actor.organizationId) { gagal.push(`${r.label}: butir tidak ditemukan pada versi ini`); continue; }
      if (!item.data.pptk_id) { gagal.push(`${r.label}: butir belum memiliki PPTK`); continue; }
      if (r.months.length !== 12 || r.months.some((v) => !Number.isFinite(v) || v < 0)) { gagal.push(`${r.label}: nilai tidak valid`); continue; }
      const total = r.months.reduce((a, v) => a + Math.round(v * 100), 0);
      if (total > Math.round(Number(iv.data.pagu) * 100)) { gagal.push(`${r.label}: total kas melebihi pagu`); continue; }
      let planId = plan.data?.id as string | undefined;
      if (plan.data && !["draft", "returned"].includes(plan.data.status as string)) { gagal.push(`${r.label}: berstatus ${plan.data.status}, tidak diubah`); continue; }
      if (!planId) {
        const ins = await admin.from("cash_budget_plans").insert({ organization_id: actor.organizationId, budget_version_id: versionId, budget_item_id: r.itemId, status: "draft", updated_by: actor.id }).select("id").single();
        if (ins.error || !ins.data) { gagal.push(`${r.label}: gagal membuat rencana kas`); continue; }
        planId = ins.data.id as string;
      }
      const del = await admin.from("cash_budget_periods").delete().eq("plan_id", planId).eq("period_type", "month");
      if (del.error) { gagal.push(`${r.label}: gagal mengganti periode`); continue; }
      const up = await admin.from("cash_budget_periods").insert(r.months.map((amount, i) => ({ plan_id: planId, period_type: "month", period_no: i + 1, amount })));
      if (up.error) { gagal.push(`${r.label}: gagal menyimpan periode`); continue; }
      saved++;
    } catch (e) {
      console.error("[kas-admin]", e instanceof Error ? e.message : "unknown");
      gagal.push(`${r.label}: terjadi kesalahan sistem`);
    }
  }
  if (saved > 0) await admin.from("audit_logs").insert({ action: "CASHPLAN_ADMIN_DISTRIBUTED", actor_id: actor.id, organization_id: actor.organizationId, table_name: "cash_budget_plans", context: { versionId, saved, failed: gagal.length } });
  return { saved, gagal };
}
