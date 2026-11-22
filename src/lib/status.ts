export type Tone = "slate" | "teal" | "red" | "amber" | "navy" | "green" | "gold";

export const TX_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draf", tone: "amber" },
  submitted: { label: "Diajukan", tone: "navy" },
  contracted: { label: "Berkontrak", tone: "navy" },
  payment_processing: { label: "Belum SP2D", tone: "red" },
  realisasi: { label: "Realisasi", tone: "green" },
  returned: { label: "Dikembalikan", tone: "red" },
  cancelled: { label: "Dibatalkan", tone: "slate" },
};

export const DOC_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draf", tone: "amber" },
  submitted: { label: "Diajukan", tone: "navy" },
  under_review: { label: "Sedang direviu", tone: "gold" },
  returned_for_correction: { label: "Perlu perbaikan", tone: "red" },
  resubmitted: { label: "Diajukan ulang", tone: "navy" },
  review_completed: { label: "Reviu selesai", tone: "green" },
  approved: { label: "Disetujui", tone: "green" },
  issued: { label: "BA terbit", tone: "green" },
  archived: { label: "Arsip", tone: "slate" },
  cancelled: { label: "Dibatalkan", tone: "slate" },
};

/** Label status menurut jenis dokumen (tujuan nota dinas berbeda: PPK atau PPBJ). */
const DOC_STATUS_BY_TYPE: Record<string, Record<string, { label: string; tone?: Tone }>> = {
  nota_dinas_pptk: {
    submitted: { label: "Diajukan ke PPK" }, resubmitted: { label: "Diajukan ulang ke PPK" },
    returned_for_correction: { label: "Dikembalikan PPK" }, issued: { label: "Diterima PPK", tone: "green" },
  },
  nota_dinas_ppk: {
    submitted: { label: "Diajukan ke PPBJ" }, resubmitted: { label: "Diajukan ulang ke PPBJ" },
    returned_for_correction: { label: "Dikembalikan" }, issued: { label: "Diterima PPBJ", tone: "green" },
  },
  dpp: { submitted: { label: "Diajukan ke PPBJ" }, resubmitted: { label: "Diajukan ulang ke PPBJ" }, issued: { label: "BA Reviu terbit", tone: "green" } },
};
export function docStatus(type: string, status: string): { label: string; tone: Tone } {
  const base = DOC_STATUS[status] ?? { label: status, tone: "slate" as Tone };
  const o = DOC_STATUS_BY_TYPE[type]?.[status];
  return o ? { label: o.label, tone: o.tone ?? base.tone } : base;
}
