import "server-only";
import { userClient } from "@/lib/supabase/server";

type Sb = Awaited<ReturnType<typeof userClient>>;

export interface TxLine {
  id: string; date: string; description: string; supplier: string | null; status: string;
  total: number; diakui: number; sp2d: { number: string; date: string | null }[];
}
export interface ItemBalance {
  pagu: number; diakui: number; pending: number; komitmen: number;
  /** pagu − realisasi diakui (definisi LRA/Dasbor: SP2D bertanggal). */
  sisa: number;
  /** sisa − yang sudah dibayarkan tetapi menunggu SP2D (lebih hati-hati untuk paket baru). */
  tersedia: number;
  history: TxLine[];
}

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * Realisasi suatu butir anggaran dari menu Input Realisasi: yang SUDAH DIAKUI (SP2D bertanggal, transaksi berstatus realisasi — view
 * v_budget_balance/v_eligible_realization, definisi tunggal yang sama dengan LRA & Dasbor) dan riwayat transaksinya. Dibatasi RLS pemanggil.
 */
export async function loadItemBalance(sb: Sb, versionId: string, itemId: string): Promise<ItemBalance | null> {
  const [bal, tx] = await Promise.all([
    sb.from("v_budget_balance").select("pagu, eligible_realization, pending_sp2d, contract_commitment, sisa_anggaran").eq("budget_version_id", versionId).eq("budget_item_id", itemId).maybeSingle(),
    sb.from("realization_transactions")
      .select("id, transaction_date, description, status, suppliers(name), payment_records(id, amount, sp2d_records(sp2d_number, sp2d_date, voided_at))")
      .eq("budget_version_id", versionId).eq("budget_item_id", itemId).neq("status", "cancelled")
      .order("transaction_date", { ascending: false }).limit(100),
  ]);
  if (!bal.data) return null;
  const pagu = Number(bal.data.pagu), diakui = Number(bal.data.eligible_realization), pending = Number(bal.data.pending_sp2d);
  type Pay = { amount: number | string; sp2d_records: { sp2d_number: string | null; sp2d_date: string | null; voided_at: string | null } | { sp2d_number: string | null; sp2d_date: string | null; voided_at: string | null }[] | null };
  type Row = { id: string; transaction_date: string; description: string; status: string; suppliers: { name: string } | { name: string }[] | null; payment_records: Pay[] | null };
  const history: TxLine[] = ((tx.data ?? []) as unknown as Row[]).map((t) => {
    let total = 0, ok = 0;
    const sp2d: TxLine["sp2d"] = [];
    for (const p of t.payment_records ?? []) {
      const amt = Number(p.amount);
      total += amt;
      const s = one(p.sp2d_records);
      if (s && !s.voided_at) {
        sp2d.push({ number: s.sp2d_number ?? "", date: s.sp2d_date });
        if (t.status === "realisasi" && s.sp2d_date) ok += amt;
      }
    }
    return { id: t.id, date: t.transaction_date, description: t.description, supplier: one(t.suppliers)?.name ?? null, status: t.status, total, diakui: ok, sp2d };
  });
  return { pagu, diakui, pending, komitmen: Number(bal.data.contract_commitment), sisa: Number(bal.data.sisa_anggaran), tersedia: Number(bal.data.sisa_anggaran) - pending, history };
}
