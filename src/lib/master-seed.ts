import {
  SEED_ACCOUNTS, SEED_ACTIVITIES, SEED_FUNDING, SEED_PROGRAMS, SEED_SUB_ACTIVITIES,
  type SeedChild, type SeedNode,
} from "@/data/master-bapersuda";

/**
 * Perencana pemuatan Data Master bawaan (murni, tanpa akses database).
 * Prinsip ADITIF: hanya baris dengan kode yang BELUM ada yang ditambahkan. Baris yang sudah ada tidak pernah
 * diubah, dipindah induknya, atau dihapus. Bila kode sudah ada tetapi nama/induknya berbeda, hal itu dilaporkan
 * sebagai "selisih" agar admin yang memutuskan, bukan ditimpa diam-diam.
 */
export type SeedEntity = "programs" | "activities" | "sub_activities" | "expenditure_accounts" | "funding_sources";

export interface ExistingRow { code: string; name: string; parentCode?: string | null }
export type ExistingMaster = Record<SeedEntity, ExistingRow[]>;

export interface SeedInsert { code: string; name: string; parentCode?: string }
export interface SeedPlan {
  inserts: Record<SeedEntity, SeedInsert[]>;
  skipped: Record<SeedEntity, number>;
  /** Kode sudah ada tetapi isinya berbeda dari master bawaan (tidak diubah). */
  differences: string[];
}

export const SEED_LABEL: Record<SeedEntity, string> = {
  programs: "Program", activities: "Kegiatan", sub_activities: "Sub Kegiatan",
  expenditure_accounts: "Rekening Belanja", funding_sources: "Sumber Dana",
};

export const SEED_ORDER: SeedEntity[] = ["programs", "activities", "sub_activities", "expenditure_accounts", "funding_sources"];

export const seedCounts = () => ({
  programs: SEED_PROGRAMS.length, activities: SEED_ACTIVITIES.length, sub_activities: SEED_SUB_ACTIVITIES.length,
  expenditure_accounts: SEED_ACCOUNTS.length, funding_sources: SEED_FUNDING.length,
});

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

export function planSeed(existing: ExistingMaster): SeedPlan {
  const plan: SeedPlan = {
    inserts: { programs: [], activities: [], sub_activities: [], expenditure_accounts: [], funding_sources: [] },
    skipped: { programs: 0, activities: 0, sub_activities: 0, expenditure_accounts: 0, funding_sources: 0 },
    differences: [],
  };

  const run = (entity: SeedEntity, data: (SeedNode | SeedChild)[], matchByName = false) => {
    const byCode = new Map(existing[entity].map((r) => [norm(r.code), r]));
    const byName = new Map(existing[entity].map((r) => [norm(r.name), r]));
    for (const d of data) {
      const parentCode = "parent" in d ? d.parent : undefined;
      let hit = byCode.get(norm(d.code));
      if (!hit && matchByName) hit = byName.get(norm(d.name)); // sumber dana: cocokkan juga lewat nama
      if (hit) {
        plan.skipped[entity]++;
        if (norm(hit.name) !== norm(d.name)) {
          plan.differences.push(`${SEED_LABEL[entity]} ${hit.code}: di aplikasi "${hit.name}", di master bawaan "${d.name}" (tidak diubah)`);
        }
        if (parentCode && hit.parentCode && norm(hit.parentCode) !== norm(parentCode)) {
          plan.differences.push(`${SEED_LABEL[entity]} ${hit.code}: induk di aplikasi ${hit.parentCode}, di master bawaan ${parentCode} (tidak diubah)`);
        }
        continue;
      }
      plan.inserts[entity].push({ code: d.code, name: d.name, parentCode });
    }
  };

  run("programs", SEED_PROGRAMS);
  run("activities", SEED_ACTIVITIES);
  run("sub_activities", SEED_SUB_ACTIVITIES);
  run("expenditure_accounts", SEED_ACCOUNTS);
  run("funding_sources", SEED_FUNDING, true);
  return plan;
}

export const totalInserts = (p: SeedPlan) => SEED_ORDER.reduce((n, e) => n + p.inserts[e].length, 0);

/** Usulan username dari nama ("TENGKO WOLOK, S.T." -> "tengko.wolok"): gelar setelah koma dibuang. Hanya usulan; dapat diubah sebelum diunggah. */
export function usernameFromName(fullName: string): string {
  const base = fullName.split(",")[0] ?? "";
  return base.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean).join(".").slice(0, 32);
}
