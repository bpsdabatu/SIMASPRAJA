import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseCsv } from "../src/lib/csv";
import { parseMasterTable } from "../src/lib/master-import";
import { planSeed, seedCounts, usernameFromName, type ExistingMaster } from "../src/lib/master-seed";
import { SEED_ACCOUNTS, SEED_ACTIVITIES, SEED_PROGRAMS, SEED_SUB_ACTIVITIES } from "../src/data/master-bapersuda";

const fx = (f: string) => parseCsv(readFileSync(path.join(__dirname, "fixtures/master", f), "utf8"));
const empty: ExistingMaster = { programs: [], activities: [], sub_activities: [], expenditure_accounts: [], funding_sources: [] };

describe("berkas master dari zip dapat langsung diunggah", () => {
  it.each([
    ["programs", "ref_program.csv", 2], ["activities", "ref_kegiatan.csv", 9], ["sub_activities", "ref_sub_kegiatan.csv", 35],
    ["expenditure_accounts", "ref_belanja.csv", 157], ["funding_sources", "ref_sumber_dana.csv", 2],
  ])("%s dari %s", (entity, file, n) => {
    const r = parseMasterTable(entity, fx(file));
    expect(r.problems).toEqual([]);
    expect(r.rows).toHaveLength(n);
  });
  it("sumber dana tanpa kolom kode memperoleh kode dari nama", () => {
    const r = parseMasterTable("funding_sources", fx("ref_sumber_dana.csv"));
    expect(r.rows.map((x) => x.code)).toEqual(["PAD", "DBH-CHT"]);
  });
});

describe("data master bawaan", () => {
  it("hierarki kode konsisten dan tanpa spasi berlebih", () => {
    const progs = new Set(SEED_PROGRAMS.map((p) => p.code)), acts = new Set(SEED_ACTIVITIES.map((a) => a.code));
    for (const a of SEED_ACTIVITIES) { expect(progs.has(a.parent)).toBe(true); expect(a.code.split(".").slice(0, -2).join(".")).toBe(a.parent); }
    for (const s of SEED_SUB_ACTIVITIES) { expect(acts.has(s.parent)).toBe(true); expect(s.code.split(".").slice(0, -1).join(".")).toBe(s.parent); }
    for (const x of [...SEED_ACTIVITIES, ...SEED_SUB_ACTIVITIES, ...SEED_ACCOUNTS]) expect(x.name).toBe(x.name.replace(/\s+/g, " ").trim());
    expect(new Set(SEED_ACCOUNTS.map((a) => a.code)).size).toBe(SEED_ACCOUNTS.length);
  });
  it("DB kosong: semua ditambahkan; diulang: tidak ada yang ditambahkan (idempoten)", () => {
    const p = planSeed(empty);
    expect(p.inserts.sub_activities).toHaveLength(35);
    expect(p.differences).toEqual([]);
    const full: ExistingMaster = {
      programs: SEED_PROGRAMS, activities: SEED_ACTIVITIES.map((a) => ({ code: a.code, name: a.name, parentCode: a.parent })),
      sub_activities: SEED_SUB_ACTIVITIES.map((a) => ({ code: a.code, name: a.name, parentCode: a.parent })),
      expenditure_accounts: SEED_ACCOUNTS, funding_sources: [{ code: "PAD", name: "PAD" }, { code: "X1", name: "dbh  cht" }],
    };
    const again = planSeed(full);
    expect(Object.values(again.inserts).flat()).toHaveLength(0);
    expect(again.skipped).toEqual(seedCounts());
  });
  it("tidak menimpa: kode sama bernama beda hanya dilaporkan; sumber dana dicocokkan lewat nama", () => {
    const p = planSeed({ ...empty, programs: [{ code: "4.01.01", name: "Nama Lama" }], funding_sources: [{ code: "1.1.01", name: "PAD" }] });
    expect(p.inserts.programs.map((x) => x.code)).toEqual(["4.01.03"]);
    expect(p.differences[0]).toContain("tidak diubah");
    expect(p.inserts.funding_sources.map((x) => x.code)).toEqual(["DBH-CHT"]);
  });
  it("usulan username PPTK", () => {
    expect(usernameFromName("TENGKO WOLOK, S.T.")).toBe("tengko.wolok");
    expect(usernameFromName("DIYAH WAHYUNI, S.E., M.M.")).toBe("diyah.wahyuni");
  });
});
