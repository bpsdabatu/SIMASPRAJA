import { describe, expect, it } from "vitest";
import { sumMonths } from "../src/lib/cash-core";
import {
  fitMonthsToPagu, planCashAdjust, planCashImport, quarterToMonths, resolveCashHeaders, type CashItem,
} from "../src/lib/cash-import-core";

const ME = "U1";
const item = (over: Partial<CashItem> = {}): CashItem => ({
  itemId: "11111111-1111-1111-1111-111111111111", subCode: "4.01.01.2.02.0002", accountCode: "5.1.02.01.001.00024",
  fundingCode: "PAD", fundingName: "PAD", desc: "", pagu: 1_200_000, pptkId: ME, status: "none", months: Array(12).fill(0), ...over,
});
const M = ["jan", "feb", "mar", "apr", "mei", "jun", "jul", "agu", "sep", "okt", "nov", "des"];

describe("header kas", () => {
  it("id_butir atau kode, bulan atau triwulan", () => {
    expect(resolveCashHeaders(["id_butir", ...M]).problems).toEqual([]);
    const q = resolveCashHeaders(["Kode Sub Kegiatan", "Kode Rekening", "TW I", "TW II", "TW III", "TW IV"]);
    expect(q.problems).toEqual([]);
    expect(q.quarters).toEqual([2, 3, 4, 5]);
  });
  it("melaporkan header yang tidak lengkap", () => {
    const r = resolveCashHeaders(["uraian", "jan"]);
    expect(r.problems).toHaveLength(2);
  });
});

describe("hitung kas", () => {
  it("triwulan -> bulan tepat tanpa selisih sen", () => {
    const m = quarterToMonths([100, 0, 0.1, 1_000_000]);
    expect(m).toHaveLength(12);
    expect(sumMonths(m.slice(0, 3))).toBe(100);
    expect(sumMonths(m.slice(6, 9))).toBe(0.1);
    expect(sumMonths(m)).toBe(1_000_100.1);
  });
  it("fitMonthsToPagu: tidak diubah bila muat; dikecilkan proporsional dan tepat = pagu", () => {
    const m = [100, 200, 300, 0, 0, 0, 0, 0, 0, 0, 0, 400];
    expect(fitMonthsToPagu(m, 1000)).toEqual({ months: m, changed: false });
    const f = fitMonthsToPagu(m, 777.77);
    expect(f.changed).toBe(true);
    expect(sumMonths(f.months)).toBe(777.77);
    expect(f.months.every((v) => v >= 0)).toBe(true);
    expect(f.months[3]).toBe(0);
    expect(fitMonthsToPagu(m, 0).months.every((v) => v === 0)).toBe(true);
  });
  it("fitMonthsToPagu tetap tepat untuk angka ganjil", () => {
    for (const pagu of [1, 0.01, 333.33, 9999.99, 12000.83]) expect(sumMonths(fitMonthsToPagu(Array(12).fill(1000.07), pagu).months)).toBe(pagu);
  });
});

describe("impor kas", () => {
  const head = resolveCashHeaders(["kode_sub_kegiatan", "kode_rekening", "sumber_dana", "tw1", "tw2", "tw3", "tw4"]);
  it("menyimpan lewat kode + triwulan", () => {
    const r = planCashImport([[], ["4.01.01.2.02.0002", "5.1.02.01.001.00024", "PAD", "300000", "300000", "300000", "300000"]], head, [item()], ME);
    expect(r.problems).toEqual([]);
    expect(r.rows[0]).toMatchObject({ status: "simpan", total: 1_200_000 });
    expect(r.rows[0]!.months).toHaveLength(12);
  });
  it("menolak total melebihi pagu, butir milik orang lain, dan butir ganda", () => {
    const over = planCashImport([[], ["4.01.01.2.02.0002", "5.1.02.01.001.00024", "", "500000", "500000", "500000", "0"]], head, [item()], ME);
    expect(over.problems[0]).toContain("melebihi pagu");
    const notMine = planCashImport([[], ["4.01.01.2.02.0002", "5.1.02.01.001.00024", "", "1", "0", "0", "0"]], head, [item({ pptkId: "U2" })], ME);
    expect(notMine.problems[0]).toContain("bukan butir penugasan Anda");
    const dup = planCashImport([[], ["4.01.01.2.02.0002", "5.1.02.01.001.00024", "", "1", "0", "0", "0"], ["4.01.01.2.02.0002", "5.1.02.01.001.00024", "", "2", "0", "0", "0"]], head, [item()], ME);
    expect(dup.problems[0]).toContain("ganda");
  });
  it("ambigu dijernihkan oleh sumber dana; tetap ambigu bila tidak bisa", () => {
    const a = item(), b = item({ itemId: "22222222-2222-2222-2222-222222222222", fundingCode: "DBH-CHT", fundingName: "DBH CHT" });
    const ok = planCashImport([[], ["4.01.01.2.02.0002", "5.1.02.01.001.00024", "DBH CHT", "1", "0", "0", "0"]], head, [a, b], ME);
    expect(ok.rows[0]!.itemId).toBe(b.itemId);
    const amb = planCashImport([[], ["4.01.01.2.02.0002", "5.1.02.01.001.00024", "", "1", "0", "0", "0"]], head, [a, b], ME);
    expect(amb.problems[0]).toContain("ambigu");
  });
  it("butir diajukan/final dikunci (bukan galat), nol dilewati, sama dikenali", () => {
    const h = resolveCashHeaders(["id_butir", ...M]);
    const row = (id: string, v: string) => [[], [id, v, v, v, "", "", "", "", "", "", "", "", ""]];
    const locked = planCashImport(row(item().itemId, "10"), h, [item({ status: "submitted" })], ME);
    expect(locked.rows[0]!.status).toBe("dikunci");
    expect(locked.problems).toEqual([]);
    expect(planCashImport(row(item().itemId, "0"), h, [item()], ME).rows[0]!.status).toBe("kosong");
    const cur = item({ months: [10, 10, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
    expect(planCashImport(row(cur.itemId, "10"), h, [cur], ME).rows[0]!.status).toBe("sama");
  });
});

describe("penyesuaian antartahapan", () => {
  const T = (o: Partial<{ itemId: string; pagu: number; mine: boolean; status: CashItem["status"]; months: number[] }> = {}) =>
    ({ itemId: "A", label: "x", pagu: 1000, mine: true, status: "none" as const, months: Array(12).fill(0), ...o });
  const src = (pagu: number, months: number[]) => ({ pagu, months });

  it("salin bila muat, kecilkan bila pagu turun, dan lindungi isian yang ada", () => {
    const m = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 0, 0]; // 1000
    const same = planCashAdjust([T({ pagu: 1500 })], new Map([["A", src(1000, m)]]), false);
    expect(same.rows[0]).toMatchObject({ status: "salin", newTotal: 1000 });
    const down = planCashAdjust([T({ pagu: 600 })], new Map([["A", src(1000, m)]]), false);
    expect(down.rows[0]).toMatchObject({ status: "kurangi", newTotal: 600 });
    expect(sumMonths(down.rows[0]!.months!)).toBe(600);
    const filled = planCashAdjust([T({ months: [5, ...Array(11).fill(0)] })], new Map([["A", src(1000, m)]]), false);
    expect(filled.rows[0]!.status).toBe("terisi");
    const forced = planCashAdjust([T({ months: [5, ...Array(11).fill(0)] })], new Map([["A", src(1000, m)]]), true);
    expect(forced.rows[0]!.status).toBe("salin");
  });
  it("lewati butir baru, dikunci, dan bukan milik sendiri", () => {
    const m = Array(12).fill(10);
    const r = planCashAdjust([T({ itemId: "A", status: "final" }), T({ itemId: "B" }), T({ itemId: "C", mine: false })], new Map([["A", src(120, m)]]), false);
    expect(r.rows.map((x) => x.status)).toEqual(["dikunci", "tanpa_sumber"]);
    expect(r.others).toBe(1);
  });
});
