import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { DOC_TYPES } from "../src/lib/documents";
import { docStatus } from "../src/lib/status";

vi.mock("server-only", () => ({}));

const seed = readFileSync("supabase/migrations/0001_core_identity.sql", "utf8");
const perms = new Set([...seed.matchAll(/\('([a-z_]+\.[a-z_]+)','[a-z_]+','/g)].map((m) => m[1]!));

describe("alur dokumen sesuai pembagian tugas pengadaan", () => {
  it("Nota Dinas PPTK -> PPK: disusun PPTK, tujuan PPK, memuat rincian barang/jasa", () => {
    const t = DOC_TYPES.nota_dinas_pptk!;
    expect(t.creatorRoles).toEqual(["pptk"]); expect(t.recipient).toBe("ppk"); expect(t.createPermission).toBe("document.create_pptk"); expect(t.hasItems).toBe(true);
  });
  it("DPP disusun dan ditetapkan PPK (bukan PPTK), tujuan reviu PPBJ", () => {
    const t = DOC_TYPES.dpp!;
    expect(t.creatorRoles).toEqual(["ppk"]); expect(t.createPermission).toBe("document.create_ppk"); expect(t.recipient).toBe("ppbj");
  });
  it("Nota Dinas PPK -> PPBJ: disusun PPK, tujuan PPBJ, tanpa rincian (pengantar DPP)", () => {
    const t = DOC_TYPES.nota_dinas_ppk!;
    expect(t.creatorRoles).toEqual(["ppk"]); expect(t.recipient).toBe("ppbj"); expect(t.hasItems).toBeFalsy();
    expect(t.fields.map((f) => f.key)).toEqual(expect.arrayContaining(["nomor", "tanggal", "perihal", "isi", "lampiran"]));
  });
  it("DPP selalu bermula dari Nota Dinas PPTK; Nota Dinas PPK dari DPP (tidak dibuat langsung)", () => {
    expect(DOC_TYPES.nota_dinas_pptk!.createdFrom).toBeUndefined();
    expect(DOC_TYPES.dpp!.createdFrom).toBe("nota_dinas_pptk");
    expect(DOC_TYPES.nota_dinas_ppk!.createdFrom).toBe("dpp");
  });
  it("izin pembuat jenis dokumen ada di database", () => {
    for (const t of Object.values(DOC_TYPES)) if (t.createPermission) expect(perms.has(t.createPermission)).toBe(true);
  });
  it("label status mengikuti tujuan dokumen", () => {
    expect(docStatus("nota_dinas_pptk", "submitted").label).toBe("Diajukan ke PPK");
    expect(docStatus("nota_dinas_pptk", "issued").label).toBe("Diterima PPK");
    expect(docStatus("nota_dinas_ppk", "submitted").label).toBe("Diajukan ke PPBJ");
    expect(docStatus("nota_dinas_ppk", "issued").label).toBe("Diterima PPBJ");
    expect(docStatus("dpp", "issued").label).toBe("BA Reviu terbit");
    expect(docStatus("dpp", "draft").label).toBe("Draf");
    expect(docStatus("lain", "xyz").label).toBe("xyz");
  });
});
