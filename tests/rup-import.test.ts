import { describe, expect, it, vi } from "vitest";
import { mapJenisPengadaan, mapMetodePemilihan, normalizeRupCode, parseMoney, parseRupTable } from "../src/lib/rup-import-core";
import { contentFromRup } from "../src/lib/documents";

vi.mock("server-only", () => ({}));

describe("parseMoney", () => {
  it("format Indonesia dan Inggris", () => {
    expect(parseMoney("4.587.000.000")).toBe(4_587_000_000);
    expect(parseMoney("223,865,000")).toBe(223_865_000);
    expect(parseMoney("Rp 15.159.400")).toBe(15_159_400);
    expect(parseMoney("1.234,56")).toBe(1234.56);
    expect(parseMoney("1,234.56")).toBe(1234.56);
    expect(parseMoney("15159400.5")).toBe(15_159_400.5);
    expect(parseMoney("7.405.977")).toBe(7_405_977);
    expect(parseMoney("0")).toBe(0);
  });
  it("tidak valid -> null", () => {
    expect(parseMoney("")).toBeNull(); expect(parseMoney("-")).toBeNull(); expect(parseMoney("abc")).toBeNull();
  });
});

describe("normalizeRupCode", () => {
  it("angka Excel dinormalkan", () => {
    expect(normalizeRupCode("60696228")).toBe("60696228");
    expect(normalizeRupCode("60696228.0")).toBe("60696228");
    expect(normalizeRupCode("6.0696228E7")).toBe("60696228");
    expect(normalizeRupCode(" 4 6 8 ")).toBe("468");
    expect(normalizeRupCode("")).toBeNull();
    expect(normalizeRupCode("<script>")).toBeNull();
  });
});

describe("parseRupTable", () => {
  it("rekap SiRUP: No, Nama Paket, Pagu (Rp.), Metode Pemilihan, Sumber Dana, Kode RUP, Waktu Pemilihan", () => {
    const t = [
      ["Rekap - Rencana Umum Pengadaan"], [],
      ["No", "Nama Paket", "Pagu (Rp.)", "Metode Pemilihan", "Sumber Dana", "Kode RUP", "Waktu Pemilihan"],
      ["1", "Belanja Alat Tulis Kantor", "15.159.400", "E-Purchasing", "APBD", "46918464", "January 2024"],
      ["2", "Belanja Makan Minum Rapat", "53.750.000", "Pengadaan Langsung", "APBD", "31816691", "Jan-22"],
    ];
    const r = parseRupTable(t);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ code: "46918464", name: "Belanja Alat Tulis Kantor", pagu: 15_159_400, metode: "E-Purchasing", sumber: "APBD", waktuPemilihan: "January 2024" });
  });
  it("tampilan lain: Paket, Pagu (Rp), Jenis Pengadaan, Lokasi, ID; duplikat memakai yang terakhir; baris tanpa kode dilewati", () => {
    const r = parseRupTable([
      ["No", "Paket", "Pagu (Rp)", "Jenis Pengadaan", "Metode Pemilihan", "Satuan Kerja", "Lokasi", "ID"],
      ["1", "Pengadaan Laptop", "223,865,000", "Barang", "Pengadaan Langsung", "Bag. Perekonomian", "Kota Batu", "62049211"],
      ["2", "Pengadaan Laptop (revisi)", "230,000,000", "Barang", "Pengadaan Langsung", "Bag. Perekonomian", "Kota Batu", "62049211"],
      ["3", "Tanpa kode", "1.000", "Barang", "", "", "", ""],
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.name).toBe("Pengadaan Laptop (revisi)");
    expect(r.duplicates).toBe(1); expect(r.skipped).toBe(1);
  });
  it("tanpa kolom Kode RUP / Nama Paket -> galat yang jelas", () => {
    const r = parseRupTable([["No", "Uraian", "Nilai"], ["1", "x", "2"]]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Kode RUP/);
  });
});

describe("pemetaan ke isian DPP", () => {
  it("jenis & metode", () => {
    expect(mapJenisPengadaan("Jasa Lainnya")).toBe("Jasa Lainnya");
    expect(mapJenisPengadaan("Pekerjaan Konstruksi")).toBe("Pekerjaan Konstruksi");
    expect(mapJenisPengadaan("Jasa Konsultansi Badan Usaha")).toBe("Jasa Konsultansi");
    expect(mapJenisPengadaan("Barang")).toBe("Barang");
    expect(mapJenisPengadaan("???")).toBe("");
    expect(mapMetodePemilihan("E-Purchasing")).toBe("E-purchasing (Katalog Elektronik)");
    expect(mapMetodePemilihan("Pengadaan Langsung")).toBe("Pengadaan Langsung");
    expect(mapMetodePemilihan("Dikecualikan")).toBe("");
  });
  it("isi awal DPP dari RUP", () => {
    const c = contentFromRup({ rup_code: "62049211", package_name: "Pengadaan Laptop", pagu: "223865000", jenis_pengadaan: "Barang", metode_pemilihan: "Pengadaan Langsung", cara_pengadaan: null, sumber_dana: "APBD", lokasi: "Kota Batu" });
    expect(c).toMatchObject({ kode_rup: "62049211", perihal: "Pengadaan Laptop", jenis_pengadaan: "Barang", metode_pemilihan: "Pengadaan Langsung", cara_pengadaan: "Melalui Penyedia", sumber_dana: "APBD", rup_pagu: "223865000" });
  });
});
