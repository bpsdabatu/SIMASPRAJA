# Pembaruan November 2026 — daftar perubahan dan cara memasang

## Cara memasang (penting: ganti SELURUH isi proyek)
1. Cadangkan proyek yang ada. Simpan `.env.local` / variabel lingkungan Anda (tidak ada di zip ini).
2. Salin SELURUH isi zip ini ke proyek (timpa file yang ada; folder `node_modules` dan `.next` tidak ikut).
3. `git add -A && git commit -m "Pembaruan SIMASPRAJA" && git push` (atau unggah ulang ke Vercel).
4. Di Vercel › Deployments pastikan deploy terbaru berstatus **Ready**. Jika **Error**, buka *Build Logs* dan kirim barisnya.
5. Muat ulang paksa peramban (Ctrl+F5). Halaman Pengguna & Peran menampilkan teks kecil "Versi halaman Pengguna: kelola-per-akun r4".

## Migrasi Supabase (jalankan berurutan di SQL Editor; semuanya aditif)
| Berkas | Isi |
|---|---|
| 0018_penugasan_dokumen.sql | Daftar PPK/PPBJ untuk penyusun dokumen; ubah penugasan saat draf |
| 0019_kelola_akun.sql | Jenis riwayat akun baru; fungsi hapus akun |
| 0020_hapus_akun_lepas_keterkaitan.sql | Hapus akun dengan opsi lepas keterkaitan |
| 0021_rup_sirup_dan_penyusunan_bersama.sql | Data RUP (SiRUP) pada Referensi RUP; penyusunan bersama DPP |
| 0022_alur_nota_dinas_dpp.sql | Alur Nota Dinas PPTK → PPK → DPP (PPK) → Nota Dinas PPK → PPBJ |
| 0023_perbaikan_hapus_akun.sql | Perbaikan penanganan galat hapus akun |

## Ringkasan fitur
- Login: pembedaan galat kredensial vs sistem; middleware tidak lagi menggantung (504); skrip `npm run login:check`.
- Dokumen Pengadaan: rincian barang/jasa + referensi harga (Katalog InaProc/toko daring), DPP sesuai informasi minimal, unggah RUP SiRUP + pencarian, realisasi diakui & sisa anggaran, ekspor Excel/CSV, alur Nota Dinas/DPP, aksi Edit/Hapus pada daftar.
- Pengaturan cetak (kertas, orientasi, margin) untuk cetak browser, PDF, dan Excel.
- Pengguna & Peran: halaman Kelola per akun (ubah data, peran, reset, nonaktifkan, hapus); daftar dimuat dengan dua kueri terpisah dan menampilkan kode galat bila gagal.
