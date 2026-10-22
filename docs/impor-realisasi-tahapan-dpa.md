# Impor Realisasi, tahapan menurut tanggal DPA, dan kas berbasis realisasi

**Wajib: jalankan migrasi `supabase/migrations/0014_impor_realisasi_tahapan_dpa.sql`** di Supabase › SQL Editor (aditif, aman diulang; tidak mengubah data/fungsi yang ada).
Tanpa migrasi, input realisasi manual tetap berjalan seperti semula; hanya halaman Impor yang meminta migrasi.

## 1. Menentukan tahapan dari tanggal DPA
- Isi tanggal DPA tiap versi di **Input Anggaran › Versi anggaran** (Murni, Pergeseran I, … dan **Perubahan** begitu ditetapkan).
- Aturan: tahapan berlaku pada suatu tanggal = versi ber-DPA dengan tanggal DPA terbesar yang ≤ tanggal itu (16 Mar 2026 = Pergeseran; 15 Mar = Murni). Sebelum DPA pertama → Murni.
- Urutan tanggal dijaga basis data: Murni < Pergeseran < Perubahan (dan antar-Pergeseran seperti sebelumnya).
- Versi yang masih **draf** ditolak (bukan diam-diam jatuh ke tahapan sebelumnya). Aktifkan versinya dulu.
- Begitu DPA Perubahan diisi dan versinya aktif, transaksi bertanggal sesudahnya otomatis masuk Perubahan, baik lewat impor maupun input manual.

## 2. Impor Realisasi (menu Input Realisasi › "Impor dari berkas")
- Format = laporan "Pencarian Realisasi per Metode": `No, Tgl Transaksi, Uraian, Sub Kegiatan, Nama Belanja, Sumber Dana, Metode Pemilihan, Nominal (Rp), Tgl SP2D, PPTK` (.csv/.xlsx). Blok rekap di atas rincian dipakai untuk **rekonsiliasi otomatis** (jumlah & total, per metode). Sub Kegiatan/Belanja boleh nama atau kode; PPTK boleh nama (gelar boleh tidak ditulis) atau username. Templat Excel + lembar referensi tersedia.
- Alur: *Periksa dulu* (pratinjau per baris, rincian per tahapan, rekonsiliasi, pemetaan metode) → *Impor*. Seluruh validasi diulang di server saat impor; tahapan ditentukan ulang oleh database per baris.
- Aturan sama dengan input manual: tanggal dalam tahun anggaran, tidak melewati hari ini, tanggal transaksi ≤ tanggal SP2D, nominal > 0 (maks 2 desimal), tidak melebihi pagu versi, butir harus ada pada versi tahapan tsb. Tanggal SP2D kosong → "Belum SP2D" (belum dihitung sebagai realisasi sah).
- **Akuntabel**: tiap unggahan = satu batch (nama berkas, sidik jari SHA-256, jumlah baris, total, pelaku, waktu; tercatat di audit) dan tiap transaksi menyimpan `import_batch_id`. Riwayat batch tampil di halaman Impor.
- **Aman diulang**: tiap baris punya kunci unik (butir + tanggal transaksi + nilai + urutan kemunculan) yang ditegakkan basis data → unggah ulang berkas yang sama tidak menggandakan. Transaksi kembar yang sah dalam satu berkas tetap masuk keduanya.
- Baris yang mirip input manual (butir, tanggal, nilai sama) dilewati kecuali dicentang.
- Hak akses: Admin (`realization.correct`) dapat mengimpor semua PPTK; PPTK hanya baris atas namanya (baris PPTK lain diabaikan). Opsi "Impor baris valid saja" melewati baris bermasalah; setelah diperbaiki, unggah ulang tidak menggandakan yang sudah masuk.
- Dasar tahapan dapat dipilih: tanggal transaksi (bawaan) atau tanggal SP2D. Baris yang tanggal transaksi dan SP2D-nya berbeda tahapan ditandai.
- Metode pengadaan dipetakan dari nama (mis. "e-Purchasing" → "E-Purchasing (Katalog Elektronik)"); yang ambigu ("Swakelola" → Tipe I–IV) atau belum ada ("Pengecualian") dapat dipilih/dikosongkan, dan Admin dapat membuatnya langsung.

## 3. Anggaran Kas mengikuti pergantian tahapan
**Anggaran Kas › Sesuaikan kas karena Pergeseran/Perubahan**, mode *Sesuaikan dengan realisasi*: untuk butir milik PPTK yang login pada versi yang dibuka (harus sudah punya tanggal DPA):
- bulan sebelum bulan tanggal DPA = realisasi nyata (SP2D) bulan itu;
- sisa pagu baru (pagu − realisasi sebelum tanggal DPA) dibagi ke bulan DPA s.d. Desember mengikuti pola kas lama (rata bila tidak ada);
- total kas selalu tepat = pagu baru; bila realisasi sebelum DPA melebihi pagu baru butir ditandai "Melebihi pagu" dan tidak diubah; isian yang ada dilindungi; hasil = draf.
Mode *Salin kas tahapan sebelumnya* (kecilkan bila pagu turun) tetap tersedia.

## 4. Catatan
- Realisasi terikat ke versi saat dicatat. **LRA** menjumlahkan realisasi seluruh versi pada tahun anggaran; **daftar Realisasi dan KPI Dasbor mengikuti versi yang sedang dibuka** (perilaku yang sudah ada, tidak diubah).
- Judul laporan "(Murni)" pada berkas tidak dipakai; tahapan hanya dari tanggal DPA.
- Pada berkas contoh (TA 2026): 160 baris, total Rp354.157.569 (cocok dengan rekap); 2 baris (No 86 dan 160) bertanggal SP2D lebih awal dari tanggal transaksi dan perlu dikoreksi di sumber; 10 baris transaksi sebelum 16 Maret dengan SP2D sesudahnya.
