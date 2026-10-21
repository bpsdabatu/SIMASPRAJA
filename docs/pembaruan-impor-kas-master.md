# Pembaruan: master bawaan, impor/penyesuaian anggaran, impor & penyesuaian kas, tampilan dinamis

**Tidak ada migrasi database baru.** Semua fitur memakai RPC/RLS yang sudah ada (`add_budget_item`, `update_item_pagu`, `save_cash_plan`), sehingga hak akses, validasi pagu, dan audit tidak berubah.

## 1. Data master bawaan (dari master_sianggaran.zip)
- Data: `src/data/master-bapersuda.ts` (2 program, 9 kegiatan, 35 sub kegiatan, 157 rekening belanja, 2 sumber dana, 3 nama PPTK; spasi berlebih sudah dibersihkan).
- Muat lewat **Data Master › Program › "Muat data bawaan"** (atau `supabase/master-data/seed_master_bagian_perekonomian_sda.sql`, ganti `KODE-ORGANISASI`).
- **Aditif & idempoten**: hanya kode yang belum ada ditambahkan; yang sudah ada tidak diubah/dipindah/dihapus. Selisih nama dilaporkan.
- Sumber dana di master asal tidak berkode → kode dibuat dari nama (`PAD`, `DBH-CHT`); bila nama sama sudah ada, dilewati.
- PPTK = akun pengguna. Unduh **"Templat berisi 3 PPTK bawaan"** di tab PPTK, periksa username usulan (mis. `tengko.wolok`), lengkapi NIP/jabatan, unggah.
- CSV `ref_*.csv` dari zip kini dapat diunggah langsung lewat tab masing-masing (alias kolom `program`, `kegiatan`, `sub_kegiatan`, `kode_belanja`, `nama_belanja`; sumber dana tanpa kode).

## 2. Input Anggaran
- **Manual bertingkat**: Program → Kegiatan → Sub Kegiatan, cari rekening (kode/nama), sumber dana, PPTK.
- **Impor/penyesuaian Excel/CSV** per tahun + tahapan (pilih versi tujuan): *Periksa dulu* (pratinjau Baru/Disesuaikan/Sama/Galat) → *Terapkan*.
  Kolom: `kode_sub_kegiatan, kode_rekening, sumber_dana (kode/nama), pptk (username/nama), uraian, pagu` (+ opsional `tahun, tahapan` sebagai pengaman).
  Butir baru ditambahkan; butir ada → pagu disesuaikan (ditolak bila di bawah realisasi); butir yang tidak ada di berkas tidak disentuh. Satu baris salah = tidak ada yang tersimpan.
- Templat Excel berisi lembar Referensi (kode & nama dari Data Master).

## 3. Anggaran Kas
- **Impor**: butir dikenali via `id_butir` atau `kode_sub_kegiatan + kode_rekening` (+ `sumber_dana`/`uraian` bila kembar); nilai per bulan (jan–des) atau triwulan (tw1–tw4). Pratinjau lalu simpan sebagai draf.
- **Sesuaikan karena Pergeseran/Perubahan**: salin kas dari tahapan lain pada tahun yang sama; pagu turun → dikecilkan proporsional sampai tepat = pagu; pagu naik → selisih tampil "belum dialokasikan". Isian yang ada dilindungi (opsi timpa), butir diajukan/final tidak disentuh, hasil = draf.
- Penyesuaian langsung di tabel ringkas tetap tersedia seperti sebelumnya.

## 4. Tampilan
Baris tabel muncul bertahap + sorotan emas saat hover; grafik (cincin, donat, batang) dan bilah peringkat tumbuh saat tampil; angka KPI menghitung naik; kartu terangkat saat hover; penyaring tabel instan di Input Anggaran. Murni CSS/JS kecil; otomatis mati untuk *reduced motion* dan saat cetak.
