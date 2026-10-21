import { describe, expect, it } from "vitest";
import {
  itemKey, normName, planBudgetImport, resolveBudgetHeaders, resolveFunding, resolvePptk, type ExistingItem, type Lookups,
} from "../src/lib/budget-import-core";

const look: Lookups = {
  subs: new Map([["4.01.01.2.02.0002", "S1"], ["4.01.01.2.06.0002", "S2"]]),
  accounts: new Map([["5.1.02.01.001.00024", "A1"], ["5.1.02.02.001.00067", "A2"]]),
  fundingByCode: new Map([["pad", "F1"], ["dbh-cht", "F2"]]),
  fundingByName: new Map([["pad", "F1"], ["dbh cht", "F2"]]),
  pptkByUsername: new Map([["tengko.wolok", "U1"]]),
  pptk: [
    { id: "U1", fullName: "TENGKO WOLOK, S.T." },
    { id: "U2", fullName: "DIYAH WAHYUNI, S.E., M.M." },
    { id: "U3", fullName: "SARI ANAS PUTRI, S.E." },
  ],
};
const opt = { mode: "tambah_perbarui" as const, targetYear: 2026, targetStage: "perubahan" };

describe("header impor anggaran", () => {
  it("menerima nama kolom lama dan baru", () => {
    const a = resolveBudgetHeaders(["kode_sub_kegiatan", "kode_rekening", "kode_sumber_dana", "username_pptk", "uraian", "pagu"]);
    expect(a.problems).toEqual([]);
    const b = resolveBudgetHeaders(["Kode Sub Kegiatan", "Kode Belanja", "Sumber Dana", "PPTK", "Uraian", "Pagu"]);
    expect(b.problems).toEqual([]);
    expect(b.idx).toMatchObject({ sub: 0, account: 1, funding: 2, pptk: 3, desc: 4, pagu: 5 });
  });
  it("melaporkan kolom wajib yang hilang", () => {
    const r = resolveBudgetHeaders(["kode_sub_kegiatan", "pagu"]);
    expect(r.problems.join(" ")).toContain("kode_rekening");
    expect(r.problems.join(" ")).toContain("sumber_dana");
  });
});

describe("pencocokan sumber dana & PPTK", () => {
  it("sumber dana lewat kode atau nama", () => {
    expect(resolveFunding("PAD", look)).toEqual({ ok: true, id: "F1" });
    expect(resolveFunding("dbh  cht", look)).toEqual({ ok: true, id: "F2" });
    expect(resolveFunding("DBH-CHT", look)).toEqual({ ok: true, id: "F2" });
    expect(resolveFunding("DAK", look).ok).toBe(false);
  });
  it("PPTK lewat username, nama lengkap, atau nama tanpa gelar", () => {
    expect(resolvePptk("tengko.wolok", look)).toEqual({ ok: true, id: "U1" });
    expect(resolvePptk("DIYAH WAHYUNI, S.E., M.M.", look)).toEqual({ ok: true, id: "U2" });
    expect(resolvePptk("diyah wahyuni,S.E.,M.M.", look)).toEqual({ ok: true, id: "U2" });
    expect(resolvePptk("Sari Anas Putri", look)).toEqual({ ok: true, id: "U3" });
    expect(resolvePptk("Orang Lain", look).ok).toBe(false);
  });
  it("nama tanpa gelar yang ambigu ditolak", () => {
    const amb = { ...look, pptk: [...look.pptk, { id: "U9", fullName: "SARI ANAS PUTRI, S.Pd." }] };
    const r = resolvePptk("Sari Anas Putri", amb);
    expect(r.ok).toBe(false);
  });
  it("normName menyamakan spasi dan koma", () => {
    expect(normName("A  B ,S.T.")).toBe("a b, s.t.");
  });
});

const header = ["kode_sub_kegiatan", "kode_rekening", "sumber_dana", "pptk", "uraian", "pagu"];
const idx = resolveBudgetHeaders(header).idx;

describe("rencana impor/penyesuaian", () => {
  it("baru, ubah, sama dan mode tambah saja", () => {
    const existing = new Map<string, ExistingItem>([
      [itemKey("S1", "A1", "F1", null), { itemId: "I1", pagu: 1000000, pptkId: "U1" }],
      [itemKey("S2", "A2", "F2", null), { itemId: "I2", pagu: 500000, pptkId: null }],
    ]);
    const table = [
      header,
      ["4.01.01.2.02.0002", "5.1.02.01.001.00024", "PAD", "tengko.wolok", "", "1.500.000"],       // ubah pagu
      ["4.01.01.2.06.0002", "5.1.02.02.001.00067", "DBH CHT", "", "", "500000"],                  // sama
      ["4.01.01.2.06.0002", "5.1.02.01.001.00024", "PAD", "SARI ANAS PUTRI, S.E.", "ATK", "250000"], // baru
    ];
    const r = planBudgetImport(table, idx, look, existing, opt);
    expect(r.problems).toEqual([]);
    expect(r.rows.map((x) => x.status)).toEqual(["ubah", "sama", "baru"]);
    expect(r.rows[0]).toMatchObject({ oldPagu: 1000000, pagu: 1500000, itemId: "I1" });
    expect(r.counts).toMatchObject({ baru: 1, ubah: 1, sama: 1, galat: 0 });

    const only = planBudgetImport(table, idx, look, existing, { ...opt, mode: "tambah_saja" });
    expect(only.rows.map((x) => x.status)).toEqual(["lewati", "lewati", "baru"]);
  });

  it("penugasan PPTK pada butir lama tanpa perubahan pagu dihitung sebagai ubah", () => {
    const existing = new Map<string, ExistingItem>([[itemKey("S2", "A2", "F2", null), { itemId: "I2", pagu: 500000, pptkId: null }]]);
    const r = planBudgetImport([header, ["4.01.01.2.06.0002", "5.1.02.02.001.00067", "DBH CHT", "tengko.wolok", "", "500000"]], idx, look, existing, opt);
    expect(r.rows[0]).toMatchObject({ status: "ubah", pptkChange: true, pptkId: "U1" });
  });

  it("mengumpulkan semua galat per baris dan menolak butir ganda", () => {
    const table = [
      header,
      ["SALAH", "5.1.02.01.001.00024", "PAD", "", "", "100"],
      ["4.01.01.2.02.0002", "5.1.02.01.001.00024", "XYZ", "siapa", "", "-5"],
      ["4.01.01.2.02.0002", "5.1.02.01.001.00024", "PAD", "", "", "100"],
      ["4.01.01.2.02.0002", "5.1.02.01.001.00024", "PAD", "", "", "200"],
    ];
    const r = planBudgetImport(table, idx, look, new Map(), opt);
    expect(r.counts.galat).toBe(3);
    expect(r.problems[0]).toContain("Baris 2");
    expect(r.problems[1]).toMatch(/sumber dana.*PPTK.*pagu/);
    expect(r.problems[2]).toContain("ganda dengan baris 4");
  });

  it("kolom tahun/tahapan harus sama dengan versi tujuan", () => {
    const h = [...header, "tahun", "tahapan"];
    const i = resolveBudgetHeaders(h).idx;
    const ok = planBudgetImport([h, ["4.01.01.2.02.0002", "5.1.02.01.001.00024", "PAD", "", "", "100", "2026", "Perubahan"]], i, look, new Map(), opt);
    expect(ok.problems).toEqual([]);
    const bad = planBudgetImport([h, ["4.01.01.2.02.0002", "5.1.02.01.001.00024", "PAD", "", "", "100", "2025", "Murni"]], i, look, new Map(), opt);
    expect(bad.problems[0]).toMatch(/tahun.*2025.*tahapan.*Murni/);
  });
});
