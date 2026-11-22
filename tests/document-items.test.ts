import { describe, expect, it, vi } from "vitest";
import { classifyRefUrl, computeTotals, parseItems, parsePpn, safeHttpUrl } from "../src/lib/document-items";
import { parseDocContent } from "../src/lib/documents";

vi.mock("server-only", () => ({}));

const row = (o: Record<string, unknown> = {}) => ({ nama: "Laptop", spesifikasi: "i5 16GB", volume: "2", satuan: "Unit", harga: "10000000", refKind: "katalog", refUrl: "https://katalog.inaproc.id/produk/123", refTanggal: "2026-11-20", refHarga: "9900000", refCatatan: "Penyedia A", ...o });

describe("rincian barang/jasa", () => {
  it("jumlah dihitung ulang di server (nilai dari browser diabaikan)", () => {
    const r = parseItems(JSON.stringify([row({ jumlah: 1 })]));
    expect(r.errors).toEqual([]);
    expect(r.items[0]!.jumlah).toBe(20_000_000);
  });
  it("total = subtotal + PPN", () => {
    const r = parseItems(JSON.stringify([row(), row({ nama: "Mouse", volume: "3", harga: "150000" })]));
    const t = computeTotals(r.items, 11);
    expect(t.subtotal).toBe(20_450_000);
    expect(t.ppn).toBe(2_249_500);
    expect(t.total).toBe(22_699_500);
  });
  it("baris kosong diabaikan; kolom wajib divalidasi", () => {
    expect(parseItems(JSON.stringify([{}, row()])).items).toHaveLength(1);
    const e = parseItems(JSON.stringify([row({ nama: "", volume: "0", satuan: "", harga: "-5" })])).errors.join(" | ");
    expect(e).toMatch(/nama barang/); expect(e).toMatch(/volume/); expect(e).toMatch(/satuan/); expect(e).toMatch(/harga satuan/);
  });
  it("tautan hanya http(s) tanpa kredensial", () => {
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,x")).toBeNull();
    expect(safeHttpUrl("https://user:pw@toko.com/x")).toBeNull();
    expect(safeHttpUrl("https://www.tokopedia.com/a/b")).not.toBeNull();
    expect(parseItems(JSON.stringify([row({ refUrl: "javascript:alert(1)" })])).errors.join()).toMatch(/tautan/);
  });
  it("deteksi sumber dari alamat", () => {
    expect(classifyRefUrl("https://katalog.inaproc.id/x")).toBe("katalog");
    expect(classifyRefUrl("https://e-katalog.lkpp.go.id/x")).toBe("katalog");
    expect(classifyRefUrl("https://www.tokopedia.com/x")).toBe("toko");
    expect(classifyRefUrl("https://evil-inaproc.id.example.com/x")).toBeNull();
    expect(classifyRefUrl("https://notinaproc.id/x")).toBeNull();
  });
  it("PPN tak valid jatuh ke bawaan 11%", () => {
    expect(parsePpn("abc")).toBe(11); expect(parsePpn("150")).toBe(11); expect(parsePpn("12")).toBe(12); expect(parsePpn("0")).toBe(0);
  });
  it("batas jumlah baris", () => {
    expect(parseItems(JSON.stringify(Array.from({ length: 201 }, () => row()))).errors.join()).toMatch(/Maksimal 200/);
  });
});

describe("isi DPP", () => {
  it("memuat rincian, total HPS otomatis, dan menolak pilihan di luar daftar", () => {
    const fd = new FormData();
    fd.set("f_perihal", "Pengadaan laptop"); fd.set("f_jenis_pengadaan", "Barang"); fd.set("f_metode_pemilihan", "BUKAN PILIHAN");
    fd.set("f_ppn_persen", "11"); fd.set("items_json", JSON.stringify([row()]));
    const { content, errors } = parseDocContent(fd, "dpp");
    expect(errors).toEqual([]);
    expect(content.jenis_pengadaan).toBe("Barang");
    expect(content.metode_pemilihan).toBe("");
    expect(content.hps).toBe("22200000");
    expect(content.items).toHaveLength(1);
  });
  it("tanpa rincian mempertahankan HPS manual lama", () => {
    const fd = new FormData(); fd.set("f_perihal", "x"); fd.set("hps_lama", "Rp 5.000.000");
    expect(parseDocContent(fd, "dpp").content.hps).toBe("Rp 5.000.000");
  });
  it("kesalahan rincian dilaporkan", () => {
    const fd = new FormData(); fd.set("items_json", "{bukan json");
    expect(parseDocContent(fd, "dpp").errors.length).toBeGreaterThan(0);
  });
});
