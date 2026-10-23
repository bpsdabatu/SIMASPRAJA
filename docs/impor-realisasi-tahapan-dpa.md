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

## 5. Bila hasil pratinjau "Galat: N" (semua baris ditolak)
Pratinjau kini menampilkan kartu **"Mengapa baris ditolak"** (dikelompokkan, dengan petunjuk perbaikan) dan daftar periksa **Prasyarat sebelum impor**. Penyebab yang paling umum:
1. **Nama tidak cocok dengan Data Master** (mis. sumber dana di aplikasi "Pendapatan Asli Daerah", di berkas "PAD"). Singkatan, tanda baca, dan "&"/"dan" dikenali otomatis; sisanya dapat dipetakan manual di kotak *Cocokkan nama yang belum dikenali*.
2. **Akun PPTK belum dibuat** (PPTK di aplikasi adalah akun pengguna). Gunakan templat PPTK bawaan di Data Master › PPTK.
3. **Butir anggaran belum ada** di Input Anggaran untuk tahun/tahapan tsb. Unduh *Daftar butir anggaran yang dibutuhkan*, isi kolom `pagu`, lalu unggah lewat Input Anggaran › Impor (pilih versi tujuan; ulangi untuk Pergeseran bila pagunya berbeda).
4. **Tahun konteks berbeda** dengan tanggal pada berkas (ganti konteks).
5. **Tanggal DPA belum diisi** / versi masih draf.
Tanggal yang tersimpan sebagai angka serial Excel kini juga terbaca.

## 6. Kinerja perpindahan menu
- `loading.tsx` menampilkan kerangka halaman seketika saat pindah menu.
- Pemuatan sesi dipercepat: profil dan peran diambil bersamaan, matriks izin peran di-cache 60 detik di memori instans, validasi konteks anggaran berjalan bersamaan dengan pemuatan profil, lencana menu dimuat setelah halaman tampil (`/nav-badges`). Validasi JWT (`auth.getUser`) dan RLS tidak diubah.
- Faktor terbesar yang tidak dapat diubah dari kode: **wilayah (region) fungsi Vercel harus sedekat mungkin dengan wilayah proyek Supabase** (Supabase: Project Settings › General; Vercel: Settings › Functions › Function Region). Wilayah yang berjauhan menambah ratusan milidetik pada setiap panggilan basis data.

## 7. Pengguna & Peran / PPTK (perbaikan "Tambah pengguna tidak tersimpan")
- Pembuatan akun kini satu jalur (`src/lib/account-admin.ts`) untuk **Pengguna & Peran**, **Data Master › PPTK (tambah satu / impor)**. Bila gagal, pesan menyebut penyebabnya: variabel server kosong, kunci `service_role` salah, kata sandi ditolak kebijakan Supabase, email internal ditolak (otomatis dicoba domain cadangan), trigger `auth.users` gagal, tabel/migrasi belum ada, dsb.
- Panel **"Periksa kesiapan pembuatan akun"** (halaman Pengguna & Peran) menguji variabel server, kunci, tabel, dan membuat+menghapus satu akun uji di Supabase Auth.
- Kolom kata sandi punya tombol **Buat acak** (huruf besar, kecil, angka, simbol).
- Akun berperan PPTK satu sumber data: tampil otomatis di **Data Master › PPTK**, di pilihan PPTK Input Anggaran/Impor, dan sebaliknya. Ada formulir **Tambah satu PPTK** di Data Master.
- Satu `.env.example` disertakan; `APP_SECRET` dibuat dengan: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.

## 8. Pembersihan kode
Dihapus karena sudah digantikan/tidak dirujuk: `importCsvAction`, `importCashPlansAction` (diganti panel impor dengan pratinjau), `correctDateAction` (diganti `correctDatesAction`), komponen `CashPlanForm`, `ScrollToRow`, `StackBar`, modul `lra.ts`, `loadReport`/`sumRows` di `reports.ts` (LRA memakai `lra-core`), `requirePermission`, `rowAllocation`, `quarterRoman`. Ditambah halaman galat ramah (`error.tsx`), `not-found.tsx`, dan cache singkat nama organisasi.
