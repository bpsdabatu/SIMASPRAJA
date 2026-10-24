import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseCsv } from "../src/lib/csv";
import { normName, type Lookups } from "../src/lib/budget-import-core";
import {
  matchName, summarizeReasons,
  guessMethods, keyMaterial, parseDateFlexible, parseRealizationReport, planRealizationImport, reconcileRecap, stageForDate,
  versionLabel, type BudgetItemRef, type MasterMaps, type StageVersion,
} from "../src/lib/realization-import-core";
import { SEED_ACCOUNTS, SEED_PPTK_NAMES, SEED_SUB_ACTIVITIES } from "../src/data/master-bapersuda";

const text = readFileSync(path.join(__dirname, "fixtures/realisasi-2026.csv"), "utf8");
const parsed = parseRealizationReport(parseCsv(text));
if (!parsed.ok) throw new Error(parsed.error);

const V: StageVersion[] = [
  { id: "VM", stage: "murni", versionNo: 1, status: "superseded", dpaDate: "2026-01-02" },
  { id: "VP", stage: "pergeseran", versionNo: 1, status: "active", dpaDate: "2026-03-16" },
  { id: "VU", stage: "perubahan", versionNo: 1, status: "draft", dpaDate: null },
];

/** Master + butir dibangun dari berkas asli: satu butir untuk tiap kombinasi (sub, belanja, sumber dana, PPTK), ada pada Murni dan Pergeseran. */
function buildMaps(over: { pagu?: number; itemVersions?: string[] } = {}): MasterMaps {
  const subs = new Map(SEED_SUB_ACTIVITIES.map((s) => [s.code.toLowerCase(), `S:${s.code}`]));
  const accounts = new Map(SEED_ACCOUNTS.map((a) => [a.code.toLowerCase(), `A:${a.code}`]));
  const subsByName = new Map<string, string[]>(), accsByName = new Map<string, string[]>();
  for (const s of SEED_SUB_ACTIVITIES) subsByName.set(normName(s.name), [...(subsByName.get(normName(s.name)) ?? []), `S:${s.code}`]);
  for (const a of SEED_ACCOUNTS) accsByName.set(normName(a.name), [...(accsByName.get(normName(a.name)) ?? []), `A:${a.code}`]);
  const pptk = SEED_PPTK_NAMES.map((n, i) => ({ id: `U${i}`, fullName: n }));
  const look: Lookups = { subs, accounts, fundingByCode: new Map([["pad", "F-PAD"], ["dbh-cht", "F-CHT"]]), fundingByName: new Map([["pad", "F-PAD"], ["dbh cht", "F-CHT"]]), pptkByUsername: new Map(), pptk };
  const items: BudgetItemRef[] = [];
  const seen = new Set<string>();
  for (const r of parsed.ok ? parsed.rows : []) {
    const subId = subsByName.get(normName(r.subName))![0]!, accId = accsByName.get(normName(r.accName))![0]!;
    const fundId = look.fundingByName.get(normName(r.funding))!;
    const p = pptk.find((x) => normName(x.fullName).startsWith(normName(r.pptk)))!.id;
    const k = `${subId}|${accId}|${fundId}|${p}`;
    if (seen.has(k)) continue;
    seen.add(k);
    items.push({ id: `I${items.length}`, subId, accId, fundId, pptkId: p, description: null, hasRup: false });
  }
  const versionsFor = over.itemVersions ?? ["VM", "VP"];
  const itemsInVersion = new Map(versionsFor.map((v) => [v, new Set(items.map((i) => i.id))]));
  const paguByVersionItem = new Map<string, { pagu: number; used: number }>();
  for (const v of versionsFor) for (const i of items) paguByVersionItem.set(`${v}|${i.id}`, { pagu: over.pagu ?? 1e12, used: 0 });
  return { look, subsByName, accsByName, items, itemsInVersion, paguByVersionItem };
}

const opts = (o: Partial<Parameters<typeof planRealizationImport>[2]> = {}) => ({
  versions: V, year: 2026, today: "2026-10-21", basis: "transaksi" as const, userId: "ADMIN", isAdmin: true,
  existingKeys: new Set<string>(), existingSimilar: new Set<string>(), includeSimilar: false, ...o,
});

describe("urai laporan asli", () => {
  it("160 transaksi, tanggal & nominal terbaca, judul/rekap diabaikan dari rincian", () => {
    expect(parsed.ok && parsed.rows.length).toBe(160);
    const r = (parsed as { rows: ReturnType<typeof Array> }).rows as import("../src/lib/realization-import-core").RawRow[];
    expect(r[0]).toMatchObject({ no: "1", txDate: "2026-01-23", sp2dDate: "2026-02-10", amount: 560000, method: "Swakelola", pptk: "SARI ANAS PUTRI" });
    expect(r.filter((x) => x.parseError)).toHaveLength(0);
    expect(r.filter((x) => !x.sp2dDate)).toHaveLength(1);
  });
  it("uraian dibersihkan dari tab/baris baru dan spasi", () => {
    const r = (parsed as { rows: import("../src/lib/realization-import-core").RawRow[] }).rows;
    expect(r[9]!.desc).toBe("Hr jasa tenaga kebersihan");
    expect(r[159]!.desc.endsWith("22 September 2026")).toBe(true);
    expect(/[\t\n]/.test(r[159]!.desc)).toBe(false);
  });
  it("rekap cocok: 160 transaksi, Rp354.157.569, dan per metode", () => {
    const rows = (parsed as { rows: import("../src/lib/realization-import-core").RawRow[] }).rows;
    const rec = reconcileRecap(rows, (parsed as { recap: import("../src/lib/realization-import-core").Recap | null }).recap);
    expect(rec.ok).toBe(true);
    expect(rec.notes[0]).toContain("160 transaksi");
  });
  it("rekap yang tidak cocok dilaporkan", () => {
    const p = parseRealizationReport(parseCsv(text.replace("354157569", "354157570")));
    expect(p.ok && reconcileRecap(p.rows, p.recap).ok).toBe(false);
  });
  it("berkas tanpa judul tabel ditolak dengan pesan jelas", () => {
    const p = parseRealizationReport([["a", "b"], ["1", "2"]]);
    expect(p.ok).toBe(false);
  });
});

describe("tanggal", () => {
  it("format dd/mm/yyyy, ISO, kosong, dan tidak valid", () => {
    expect(parseDateFlexible("16/03/2026")).toBe("2026-03-16");
    expect(parseDateFlexible("2026-03-16")).toBe("2026-03-16");
    expect(parseDateFlexible("")).toBeNull();
    expect(parseDateFlexible("31/02/2026")).toBeUndefined();
    expect(parseDateFlexible("16 Maret 2026")).toBeUndefined();
  });
});

describe("tahapan menurut tanggal DPA", () => {
  it("batas 16 Maret: sehari sebelum = Murni, hari DPA = Pergeseran", () => {
    expect(stageForDate(V, "2026-03-15").version?.id).toBe("VM");
    expect(stageForDate(V, "2026-03-16").version?.id).toBe("VP");
    expect(stageForDate(V, "2026-12-31").version?.id).toBe("VP");
  });
  it("sebelum DPA pertama: Murni (tidak efektif); DPA Perubahan yang diisi nanti berlaku otomatis", () => {
    expect(stageForDate(V, "2025-12-31")).toMatchObject({ effective: false, version: { id: "VM" } });
    const withPerubahan = V.map((v) => (v.id === "VU" ? { ...v, dpaDate: "2026-10-26", status: "active" } : v));
    expect(stageForDate(withPerubahan, "2026-10-25").version?.id).toBe("VP");
    expect(stageForDate(withPerubahan, "2026-10-26").version?.id).toBe("VU");
  });
  it("label Pergeseran I/II", () => {
    const vs: StageVersion[] = [...V, { id: "VP2", stage: "pergeseran", versionNo: 2, status: "active", dpaDate: "2026-06-10" }];
    expect(versionLabel(vs[1]!, vs)).toBe("Pergeseran I");
    expect(versionLabel(vs[3]!, vs)).toBe("Pergeseran II");
    expect(versionLabel(vs[0]!, vs)).toBe("Murni");
  });
});

describe("rencana impor dari berkas asli", () => {
  const rows = (parsed as { rows: import("../src/lib/realization-import-core").RawRow[] }).rows;

  it("dasar tanggal TRANSAKSI: Murni 43 baris, Pergeseran 115; 2 baris galat tanggal", () => {
    const o = planRealizationImport(rows, buildMaps(), opts());
    expect(o.counts).toMatchObject({ baru: 158, galat: 2, ada: 0, mirip: 0 });
    expect(o.problems.map((p) => p.split(":")[0])).toEqual(["Baris 86", "Baris 160"]);
    const m = o.byStage.find((s) => s.stage === "murni")!, p = o.byStage.find((s) => s.stage === "pergeseran")!;
    expect([m.count, m.amount]).toEqual([43, 74084945]);
    expect([p.count, p.amount]).toEqual([115, 279486124]);
    expect(o.straddle).toBe(10);
    expect(o.total.amount).toBe(353571069);
  });
  it("dasar tanggal SP2D: Murni 33, Pergeseran 125", () => {
    const o = planRealizationImport(rows, buildMaps(), opts({ basis: "sp2d" }));
    const m = o.byStage.find((s) => s.stage === "murni")!, p = o.byStage.find((s) => s.stage === "pergeseran")!;
    expect([m.count, m.amount]).toEqual([33, 68966565]);
    expect([p.count, p.amount]).toEqual([125, 284604504]);
  });
  it("galat 86 dan 160 berisi alasan yang jelas", () => {
    const o = planRealizationImport(rows, buildMaps(), opts());
    expect(o.problems[0]).toContain("setelah tanggal SP2D");
    expect(o.problems[1]).toContain("melebihi hari ini");
  });
  it("Pergeseran masih draf: seluruh baris setelah 16 Maret ditolak, bukan diam-diam ke Murni", () => {
    const vs = V.map((v) => (v.id === "VP" ? { ...v, status: "draft" } : v));
    const o = planRealizationImport(rows, buildMaps(), opts({ versions: vs }));
    expect(o.counts.baru).toBe(43);
    expect(o.problems.some((p) => p.includes("masih berstatus draf"))).toBe(true);
  });
  it("butir tidak ada pada versi Murni: baris Januari-Maret ditolak", () => {
    const o = planRealizationImport(rows, buildMaps({ itemVersions: ["VP"] }), opts());
    expect(o.counts.baru).toBe(115);
    expect(o.problems.some((p) => p.includes("tidak ada pada tahapan Murni"))).toBe(true);
  });
  it("idempoten: kunci yang sudah ada dilewati", () => {
    const first = planRealizationImport(rows, buildMaps(), opts());
    const keys = new Set(first.rows.filter((r) => r.status === "baru").map((r) => r.importKey!));
    const again = planRealizationImport(rows, buildMaps(), opts({ existingKeys: keys }));
    expect(again.counts).toMatchObject({ baru: 0, ada: 158, galat: 2 });
  });
  it("transaksi kembar yang sah dalam satu berkas memperoleh kunci berbeda (urutan kemunculan)", () => {
    expect(keyMaterial("I1", "2026-06-09", 294150, 1)).not.toBe(keyMaterial("I1", "2026-06-09", 294150, 2));
    const first = planRealizationImport(rows, buildMaps(), opts());
    const ks = first.rows.filter((r) => r.status === "baru").map((r) => r.importKey!);
    expect(new Set(ks).size).toBe(ks.length);
  });
  it("transaksi mirip input manual dilewati, kecuali diizinkan", () => {
    const first = planRealizationImport(rows, buildMaps(), opts());
    const r0 = first.rows.find((r) => r.status === "baru")!;
    const sim = new Set([`${r0.itemId}|${r0.txDate}|${Math.round(r0.amount * 100)}`]);
    expect(planRealizationImport(rows, buildMaps(), opts({ existingSimilar: sim })).counts.mirip).toBeGreaterThanOrEqual(1);
    expect(planRealizationImport(rows, buildMaps(), opts({ existingSimilar: sim, includeSimilar: true })).counts.mirip).toBe(0);
  });
  it("pagu: baris yang melampaui sisa pagu ditolak sebelum disimpan", () => {
    const o = planRealizationImport(rows, buildMaps({ pagu: 1_000_000 }), opts());
    expect(o.problems.some((p) => p.includes("melebihi sisa pagu"))).toBe(true);
  });
  it("PPTK biasa hanya boleh butirnya sendiri", () => {
    const o = planRealizationImport(rows, buildMaps(), opts({ isAdmin: false, userId: "U0" }));
    const mine = rows.filter((r) => normName(SEED_PPTK_NAMES[0]!).startsWith(normName(r.pptk))).length;
    expect(o.counts.baru + o.counts.galat).toBe(160);
    expect(o.counts.baru).toBeLessThanOrEqual(mine);
    expect(o.problems.some((p) => p.includes("bukan butir penugasan Anda"))).toBe(true);
  });
  it("PPTK berbeda dari penugasan butir: satu kandidat -> diterima dengan catatan; beberapa butir tanpa yang cocok -> ditolak", () => {
    const maps = buildMaps();
    maps.items = maps.items.map((i) => ({ ...i, pptkId: "U-LAIN" }));
    const o = planRealizationImport(rows.slice(0, 1), maps, opts());
    expect(o.counts.baru).toBe(1);
    expect(o.rows[0]!.notes.join(" ")).toContain("berbeda dari PPTK penugasan butir");
    const m2 = buildMaps();
    m2.items = m2.items.flatMap((i) => [{ ...i, pptkId: "U-LAIN" }, { ...i, id: `${i.id}-b`, pptkId: "U-LAIN2" }]);
    m2.itemsInVersion = new Map([...m2.itemsInVersion].map(([k, v]) => [k, new Set([...v, ...[...v].map((x) => `${x}-b`)])]));
    expect(planRealizationImport(rows.slice(0, 1), m2, opts()).problems[0]).toContain("tidak ada yang ditugaskan ke PPTK");
  });
});

describe("metode pengadaan", () => {
  const methods = [
    { id: "m1", code: "EPC", name: "E-Purchasing (Katalog Elektronik)" }, { id: "m2", code: "PGL", name: "Pengadaan Langsung" },
    { id: "m3", code: "SWK-1", name: "Swakelola Tipe I (dikerjakan sendiri)" }, { id: "m4", code: "SWK-2", name: "Swakelola Tipe II (oleh lain)" },
  ];
  it("awalan unik terpetakan, ambigu dan tidak ada ditandai", () => {
    const rows = (parsed as { rows: import("../src/lib/realization-import-core").RawRow[] }).rows;
    const g = guessMethods(rows, methods);
    const by = Object.fromEntries(g.map((x) => [x.fileName, x]));
    expect(by["e-Purchasing"]!.resolvedId).toBe("m1");
    expect(by["Pengadaan Langsung"]!.resolvedId).toBe("m2");
    expect(by["Swakelola"]!.resolvedId).toBeNull();
    expect(by["Swakelola"]!.candidates.map((c) => c.id)).toEqual(["m3", "m4"]);
    expect(by["Pengecualian"]!.resolvedId).toBeNull();
    expect(by["Pengecualian"]!.candidates).toEqual([]);
    expect(by["Swakelola"]!.count).toBe(42);
  });
});

describe("pencocokan nama yang toleran", () => {
  const funds = [{ id: "F1", name: "Pendapatan Asli Daerah", code: "1.1.01" }, { id: "F2", name: "Dana Bagi Hasil Cukai Hasil Tembakau", code: "1.1.02" }];
  it("singkatan, tanpa tanda baca, dan kode dikenali", () => {
    expect(matchName("PAD", funds).id).toBe("F1");
    expect(matchName("DBH CHT", funds).id).toBe("F2");
    expect(matchName("dbh-cht", funds).id).toBe("F2");
    expect(matchName("1.1.01", funds).id).toBe("F1");
    expect(matchName("pendapatan  asli daerah", funds).id).toBe("F1");
  });
  it("tidak menebak: tidak ada atau ambigu -> null dengan saran", () => {
    expect(matchName("DAK Fisik", funds).id).toBeNull();
    const dup = [{ id: "A", name: "Pajak dan Perizinan" }, { id: "B", name: "Pajak, dan Perizinan" }];
    const r = matchName("Pajak. dan Perizinan", dup);
    expect(matchName("pajak dan perizinan", dup).id).toBe("A");
    expect(r.id).toBeNull();
    expect(r.suggestions.length).toBe(2);
    const sub = [{ id: "S", name: "Penyediaan Gaji dan Tunjangan ASN" }, { id: "T", name: "Administrasi Umum" }];
    expect(matchName("Penyediaan Gaji & Tunjangan ASN", sub).id).toBe("S");
    expect(matchName("Gaji Tunjangan", sub).suggestions.map((x) => x.id)).toContain("S");
  });
});

describe("tanggal serial Excel", () => {
  it("46045 -> 2026-01-23", () => { expect(parseDateFlexible("46045")).toBe("2026-01-23"); expect(parseDateFlexible("46097")).toBe("2026-03-16"); });
  it("angka kecil bukan tanggal", () => { expect(parseDateFlexible("123")).toBeUndefined(); });
});

describe("ringkasan penyebab galat", () => {
  it("mengelompokkan dan memberi petunjuk", () => {
    const rows = [
      { no: "1", line: 1, message: "sumber dana \"PAD\" tidak ditemukan di Data Master" },
      { no: "2", line: 2, message: "sumber dana \"PAD\" tidak ditemukan di Data Master" },
      { no: "3", line: 3, message: "butir anggaran (sub kegiatan + belanja + sumber dana) belum ada di Input Anggaran" },
      { no: "4", line: 4, message: "PPTK \"X\" tidak ditemukan sebagai akun berperan PPTK (buat dulu di Data Master › PPTK)" },
      { no: "5", line: 5, message: "tanggal transaksi 2026-06-11 setelah tanggal SP2D 2026-06-09" },
      { no: "6", line: 6, message: "tanggal transaksi 2025-01-01 di luar tahun anggaran 2026" },
    ];
    const s = Object.fromEntries(summarizeReasons(rows).map((x) => [x.code, x.count]));
    expect(s).toEqual({ master: 2, butir: 1, pptk: 1, tanggal: 1, tahun: 1 });
  });
});

describe("berkas dengan nama PPTK bergelar (kasus nyata: belum ada akun PPTK)", () => {
  const g = parseRealizationReport(parseCsv(readFileSync(path.join(__dirname, "fixtures/realisasi-2026-gelar.csv"), "utf8")));
  if (!g.ok) throw new Error(g.error);
  const rows = g.rows;

  /** Butir ada (tanpa PPTK), tetapi TIDAK ada satu pun akun PPTK. */
  function noPptkMaps(): MasterMaps {
    const m = buildMaps();
    m.look = { ...m.look, pptk: [], pptkByUsername: new Map() };
    // satu butir per kombinasi (sub, belanja, sumber dana), sebagaimana di basis data yang menugaskan satu PPTK per butir
    const seen = new Set<string>();
    m.items = m.items.filter((i) => { const k = `${i.subId}|${i.accId}|${i.fundId}`; if (seen.has(k)) return false; seen.add(k); return true; }).map((i) => ({ ...i, pptkId: null }));
    m.itemsInVersion = new Map([...m.itemsInVersion].map(([k]) => [k, new Set(m.items.map((i) => i.id))]));
    return m;
  }
  it("Admin tanpa akun PPTK: 158 baris tetap valid (tidak lagi ditolak), dengan catatan", () => {
    const o = planRealizationImport(rows, noPptkMaps(), opts());
    expect(o.counts).toMatchObject({ baru: 158, galat: 2 });
    expect(o.problems.every((p) => /setelah tanggal SP2D|melebihi hari ini/.test(p))).toBe(true);
    expect(o.rows.find((r) => r.status === "baru")!.notes.join(" ")).toContain("belum terdaftar sebagai akun");
    expect(o.byStage.map((s) => [s.stage, s.count, s.amount])).toEqual([["murni", 43, 74084945], ["pergeseran", 115, 279486124]]);
  });
  it("tanpa akun PPTK, butir kembar (beda PPTK) tidak dapat dibedakan -> ditolak dengan petunjuk", () => {
    const m = noPptkMaps();
    const first = m.items[0]!;
    m.items.push({ ...first, id: "I-KEMBAR" });
    m.itemsInVersion.get("VM")!.add("I-KEMBAR");
    const target = rows.find((r) => normName(r.subName) === normName(SEED_SUB_ACTIVITIES.find((s) => `S:${s.code}` === first.subId)!.name));
    const o = planRealizationImport(target ? [target] : [], m, opts());
    expect(o.problems[0]).toContain("buat akun PPTK");
  });
  it("dengan akun PPTK bergelar persis: nama dikenali dan butir ber-PPTK dicocokkan", () => {
    const maps = buildMaps();
    maps.look = { ...maps.look, pptk: SEED_PPTK_NAMES.map((n, i) => ({ id: `U${i}`, fullName: n })) };
    maps.items = maps.items.map((i) => ({ ...i, pptkId: i.pptkId }));
    const o = planRealizationImport(rows, maps, opts());
    expect(o.counts.baru).toBe(158);
    expect(o.rows.filter((r) => r.status === "baru").every((r) => r.notes.every((n) => !n.includes("belum terdaftar")))).toBe(true);
  });
});
