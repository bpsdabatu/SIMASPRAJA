import { describe, expect, it, vi } from "vitest";
import { quarterSums, quartersToMonths, spreadQuarters, sumMonths } from "../src/lib/cash-core";
import {
  planCashByStage, planCashImport, quarterOfDate, resolveCashHeaders, splitProportional,
  type AdjustSource, type AdjustTarget, type CashItem,
} from "../src/lib/cash-import-core";
import { parseCashPdfLines } from "../src/lib/cash-pdf-core";

vi.mock("server-only", () => ({}));

const q = (months: number[] | undefined) => quarterSums(months ?? Array(12).fill(0));
const tgt = (id: string, pagu: number, months: number[], over: Partial<AdjustTarget> = {}): AdjustTarget => ({ itemId: id, label: id, pagu, mine: true, status: "none", months, subCode: "S1", ...over });
const src = (pagu: number, qs: number[], subCode = "S1"): AdjustSource => ({ pagu, months: quartersToMonths(qs), subCode });

describe("kas triwulan", () => {
  it("TW -> 12 bulan -> TW kembali tepat", () => {
    const m = quartersToMonths([100, 0, 0.1, 1_000_000.01]);
    expect(m).toHaveLength(12);
    expect(quarterSums(m)).toEqual([100, 0, 0.1, 1_000_000.01]);
  });
  it("bagi rata 4 TW menjumlah tepat", () => {
    const s = spreadQuarters(1_000_000.01);
    expect(s).toHaveLength(4);
    expect(s.reduce((a, b) => a + Math.round(b * 100), 0)).toBe(100_000_001);
  });
  it("triwulan DPA", () => {
    expect(quarterOfDate("2026-03-16")).toBe(0);
    expect(quarterOfDate("2026-04-01")).toBe(1);
    expect(quarterOfDate("2026-12-31")).toBe(3);
    expect(quarterOfDate(null)).toBeNull();
  });
  it("splitProportional jumlah tepat", () => {
    expect(splitProportional(100, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(splitProportional(100, [0, 0]).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe("penyesuaian menurut tahapan", () => {
  const A = "a", B = "b", C = "c", N = "n";
  const source = new Map<string, AdjustSource>([
    [A, src(1200, [300, 300, 300, 300])], [B, src(400, [100, 100, 100, 100])], [C, src(800, [200, 200, 200, 200])],
  ]);

  it("Perubahan: pagu tetap -> kas tetap; pagu berubah -> disesuaikan", () => {
    const targets = [tgt(A, 1200, []), tgt(B, 500, []), tgt(C, 600, [])];
    const out = planCashByStage("perubahan", targets, source, "2026-07-10", false);
    const by = Object.fromEntries(out.rows.map((r) => [r.itemId, r]));
    expect(by[A]!.status).toBe("salin");
    expect(q(by[A]!.months)).toEqual([300, 300, 300, 300]);
    expect(by[B]!.status).toBe("tambah"); // +100 ke TW III–IV proporsional (100:100)
    expect(q(by[B]!.months)).toEqual([100, 100, 150, 150]);
    expect(by[C]!.status).toBe("kurangi"); // -200 dari TW IV mundur sampai TW III (DPA Juli = TW III)
    expect(q(by[C]!.months)).toEqual([200, 200, 200, 0]);
    expect(sumMonths(by[C]!.months!)).toBe(600);
  });

  it("pagu turun tetapi kas masih muat -> kas tetap", () => {
    const s = new Map([[A, { pagu: 2000, months: quartersToMonths([100, 100, 100, 100]), subCode: "S1" }]]);
    const out = planCashByStage("perubahan", [tgt(A, 1500, [])], s, "2026-07-10", false);
    expect(out.rows[0]!.status).toBe("salin");
    expect(q(out.rows[0]!.months)).toEqual([100, 100, 100, 100]);
  });

  it("pengurangan menyentuh triwulan sebelum DPA hanya bila terpaksa", () => {
    const out = planCashByStage("perubahan", [tgt(C, 100, [])], source, "2026-07-10", false);
    expect(q(out.rows[0]!.months)).toEqual([100, 0, 0, 0]); // 800 -> 100: potong TW IV, III, lalu mundur TW II
    expect(sumMonths(out.rows[0]!.months!)).toBe(100);
  });

  it("butir baru: pagu dibagi rata dari triwulan DPA; tanpa sumber bila belum ada kas", () => {
    const out = planCashByStage("pergeseran", [tgt(N, 400, [], { subCode: "S1" }), tgt(A, 1200, [])], source, "2026-04-20", false);
    const n = out.rows.find((r) => r.itemId === N)!;
    expect(n.status).toBe("baru");
    expect(q(n.months)).toEqual([0, 134, 133, 133]);
    expect(sumMonths(n.months!)).toBe(400);
    expect(q(n.months)[0]).toBe(0);
  });

  it("Pergeseran: total pagu per sub kegiatan harus tetap, selain itu diperingatkan", () => {
    const ok = planCashByStage("pergeseran", [tgt(A, 1000, [], { subCode: "S1" }), tgt(B, 600, [], { subCode: "S1" }), tgt(C, 800, [], { subCode: "S1" })], source, "2026-04-20", false);
    expect(ok.warnings?.some((w) => w.includes("Pergeseran:"))).toBe(false); // 1200+400+800 = 1000+600+800
    const bad = planCashByStage("pergeseran", [tgt(A, 1300, [], { subCode: "S1" }), tgt(B, 400, [], { subCode: "S1" }), tgt(C, 800, [], { subCode: "S1" })], source, "2026-04-20", false);
    expect(bad.warnings?.some((w) => w.includes("S1"))).toBe(true);
  });

  it("melindungi isian yang ada dan butir diajukan/final; peringatan tanpa tanggal DPA", () => {
    const out = planCashByStage("perubahan", [tgt(A, 1200, quartersToMonths([10, 0, 0, 0])), tgt(B, 400, [], { status: "final" })], source, null, false);
    expect(out.rows.map((r) => r.status)).toEqual(["terisi", "dikunci"]);
    expect(out.warnings?.[0]).toMatch(/Tanggal DPA/);
  });

  it("hasil tidak pernah melebihi pagu baru", () => {
    for (const newPagu of [0, 50, 399, 400, 401, 1000, 5000]) {
      const out = planCashByStage("perubahan", [tgt(B, newPagu, [])], source, "2026-04-20", false);
      for (const r of out.rows) if (r.months) expect(Math.round(sumMonths(r.months) * 100)).toBeLessThanOrEqual(Math.round(newPagu * 100));
    }
  });
});

describe("impor kas oleh ADMIN (semua PPTK) per triwulan", () => {
  const items: CashItem[] = [
    { itemId: "11111111-1111-1111-1111-111111111111", subCode: "4.01.01.2.02.0002", accountCode: "5.1.02.01.001.00012", fundingCode: "PAD", fundingName: "PAD", desc: "", pagu: 1200, pptkId: "U1", pptkName: "Budi", status: "none", months: Array(12).fill(0) },
    { itemId: "22222222-2222-2222-2222-222222222222", subCode: "4.01.01.2.02.0003", accountCode: "5.1.02.01.001.00018", fundingCode: "PAD", fundingName: "PAD", desc: "", pagu: 900, pptkId: "U2", pptkName: "Sari", status: "none", months: Array(12).fill(0) },
    { itemId: "33333333-3333-3333-3333-333333333333", subCode: "4.01.01.2.02.0004", accountCode: "5.1.02.01.001.00019", fundingCode: "PAD", fundingName: "PAD", desc: "", pagu: 100, pptkId: null, status: "none", months: Array(12).fill(0) },
  ];
  const run = (rows: string[][], scope = "semua") => {
    const head = resolveCashHeaders(rows[0]!);
    expect(head.problems).toEqual([]);
    return planCashImport(rows, head, items, scope);
  };
  it("mendistribusikan ke PPTK berbeda dan menormalkan ke triwulan", () => {
    const out = run([
      ["kode_program", "kode_kegiatan", "kode_sub_kegiatan", "kode_rekening", "pagu", "tw1", "tw2", "tw3", "tw4"],
      ["4.01.01", "4.01.01.2.02", "4.01.01.2.02.0002", "5.1.02.01.001.00012", "1.200", "300", "300", "300", "300"],
      ["4.01.01", "4.01.01.2.02", "4.01.01.2.02.0003", "5.1.02.01.001.00018", "900", "900", "", "", ""],
    ]);
    expect(out.problems).toEqual([]);
    expect(out.counts.simpan).toBe(2);
    expect(quarterSums(out.rows[1]!.months!)).toEqual([900, 0, 0, 0]);
  });
  it("kolom bulan dijumlahkan per triwulan", () => {
    const h = ["kode_sub_kegiatan", "kode_rekening", ...["jan", "feb", "mar", "apr", "mei", "jun", "jul", "agu", "sep", "okt", "nov", "des"]];
    const out = run([h, ["4.01.01.2.02.0002", "5.1.02.01.001.00012", "100", "200", "0", "0", "0", "300", "0", "0", "0", "0", "0", "600"]]);
    expect(quarterSums(out.rows[0]!.months!)).toEqual([300, 300, 0, 600]);
  });
  it("menolak butir tanpa PPTK, pagu berbeda, dan kegiatan tidak cocok; PPTK biasa tidak boleh mengisi butir orang lain", () => {
    const base = ["kode_kegiatan", "kode_sub_kegiatan", "kode_rekening", "pagu", "tw1", "tw2", "tw3", "tw4"];
    expect(run([base, ["4.01.01.2.02", "4.01.01.2.02.0004", "5.1.02.01.001.00019", "100", "100", "", "", ""]]).problems[0]).toMatch(/belum memiliki PPTK/);
    expect(run([base, ["4.01.01.2.02", "4.01.01.2.02.0002", "5.1.02.01.001.00012", "999", "100", "", "", ""]]).problems[0]).toMatch(/pagu pada berkas/);
    expect(run([base, ["9.99.99.9.99", "4.01.01.2.02.0002", "5.1.02.01.001.00012", "1200", "100", "", "", ""]]).problems[0]).toMatch(/kode kegiatan/);
    expect(run([base, ["4.01.01.2.02", "4.01.01.2.02.0003", "5.1.02.01.001.00018", "900", "100", "", "", ""]], "U1").problems[0]).toMatch(/bukan butir penugasan/);
  });
  it("total melebihi pagu ditolak", () => {
    const out = run([["kode_sub_kegiatan", "kode_rekening", "tw1", "tw2", "tw3", "tw4"], ["4.01.01.2.02.0002", "5.1.02.01.001.00012", "1000", "1000", "0", "0"]]);
    expect(out.problems[0]).toMatch(/melebihi pagu/);
  });
});

describe("baca PDF kas", () => {
  it("mengenali TW, pagu+TW, bulan, dan tanda minus", () => {
    const r = parseCashPdfLines([
      "4.01.01.2.02.0002 Penyediaan Administrasi Pelaksanaan Tugas ASN",
      "5.1.02.01.001.00012 Belanja Bahan-Bahan Lainnya 12.000.000,00 3.000.000 3.000.000 3.000.000 3.000.000",
      "5.1.02.01.001.00018 Belanja Suku Cadang 1.000.000 - 1.000.000 2.000.000",
      "4.01.01.2.02.0003 Pelaksanaan Penatausahaan",
      "5.1.02.01.001.00019 Belanja X 1 1 1 1 1 1 1 1 1 1 1 1",
    ]);
    expect(r.problems).toEqual([]);
    expect(r.found).toBe(3);
    expect(r.table[0]).toEqual(["kode_sub_kegiatan", "kode_rekening", "pagu", "tw1", "tw2", "tw3", "tw4"]);
    expect(r.table[1]).toEqual(["4.01.01.2.02.0002", "5.1.02.01.001.00012", "12000000", "3000000", "3000000", "3000000", "3000000"]);
    expect(r.table[2]!.slice(3)).toEqual(["1000000", "0", "1000000", "2000000"]);
    expect(r.table[3]!.slice(3)).toEqual(["3", "3", "3", "3"]);
  });
  it("melaporkan pola angka tak dikenal dan PDF tanpa data", () => {
    const r = parseCashPdfLines(["4.01.01.2.02.0002 Sub", "5.1.02.01.001.00012 X 1 2 3"]);
    expect(r.problems[0]).toMatch(/3 angka/);
    expect(parseCashPdfLines(["tidak ada data"]).problems[0]).toMatch(/Tidak ada baris/);
  });
});

describe("kata sandi sementara terenkripsi", () => {
  it("bolak-balik, acak per enkripsi, gagal bila kunci beda atau rusak", async () => {
    vi.mock("../src/lib/supabase/admin", () => ({ adminClient: () => ({}) }));
    vi.mock("../src/lib/env", () => ({ serverEnv: () => ({ APP_SECRET: "x".repeat(40) }) }));
    const { sealTempPassword, openTempPassword } = await import("../src/lib/auth/temp-credential");
    const a = await sealTempPassword("rahasia-1", "Abc123!xyz");
    const b = await sealTempPassword("rahasia-1", "Abc123!xyz");
    expect(a).not.toBe(b);
    expect(a).not.toContain("Abc123");
    expect(await openTempPassword("rahasia-1", a)).toBe("Abc123!xyz");
    expect(await openTempPassword("rahasia-2", a)).toBeNull();
    expect(await openTempPassword("rahasia-1", a.slice(0, -4) + "AAAA")).toBeNull();
  });
});
