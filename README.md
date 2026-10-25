# SIMASPRAJA - Sistem Informasi Monitoring dan Evaluasi Perencanaan, Realisasi Anggaran dan Kinerja

Aplikasi web full-stack untuk OPD: anggaran, anggaran kas, realisasi belanja (SP2D), LRA, dan alur dokumen pengadaan.
Stack: Next.js 15 (App Router, TypeScript) · Tailwind CSS · Supabase (Postgres, Auth, Storage) · Vercel.

> **Status:** seluruh menu sudah berfungsi (kode, migrasi, dan tes otomatis). **Belum diuji terhadap proyek Supabase/Vercel nyata** dan
> belum boleh dianggap siap produksi sebelum checklist [docs/security-checklist.md](docs/security-checklist.md) dijalankan.
> Ringkasan perubahan: [docs/laporan-pengembangan.md](docs/laporan-pengembangan.md).

## Fitur
- Beranda publik bergaya website, halaman masuk **username + kata sandi + tahun anggaran + tahapan anggaran + kode keamanan sekali pakai**.
- Throttling per akun/IP, pesan galat generik, audit autentikasi, konteks anggaran divalidasi ulang ke database.
- RBAC 4 peran (Admin, PPK, PPTK, PPBJ) + penugasan, **RLS deny-by-default** pada seluruh tabel.
- Modul: Dasbor, Input Anggaran (versi, butir, pagu, impor CSV), Anggaran Kas, Realisasi Belanja (transaksi, SP2D, verifikasi),
  Rekapitulasi, Laporan Realisasi Anggaran (unduh CSV / cetak PDF), Dokumen Pengadaan (reviu PPBJ, Berita Acara),
  Data Master, Pengguna & Peran, Log Audit.
- Tes: unit (78), database RLS + alur kerja (246), e2e asap (Playwright; butuh browser terpasang).

## Memulai (pengembangan lokal)
Prasyarat: Node 22, Docker (untuk Supabase CLI), `psql`.

```bash
npm ci
cp .env.example .env.local          # isi nilai dari `supabase status`
supabase start                      # menerapkan migrasi + seed.sql (data contoh dev)
BOOTSTRAP_PASSWORD='GantiSegera123' npm run user:create -- \
  --username admin --name "Administrator" --role admin --org-code DEV-OPD
npm run dev                         # http://localhost:3000
```
Masuk dengan username `admin` dan kata sandi sementara; Anda akan diminta menggantinya.
Agar konteks anggaran tersedia, butuh minimal satu `budget_versions` berstatus `active` (seed dev sudah membuat 2026/Murni).

## Perintah
| Perintah | Fungsi |
|---|---|
| `npm run lint` / `npm run typecheck` | Lint dan pemeriksaan tipe |
| `npm test` | Tes unit (login, cookie konteks, format, statis keamanan) |
| `npm run test:db` | Migrasi pada Postgres bersih + tes RLS/otorisasi + konkurensi (butuh `PGHOST/PGUSER/...`) |
| `npm run test:e2e` | E2E asap Playwright (`PW_CHROMIUM_PATH` bila Chromium tidak diunduh) |
| `npm run build` | Build produksi |
| `npm run user:create` | Membuat akun (service role; dijalankan administrator) |
| `npm run user:reset -- --username admin` | Pemulihan akun: atur ulang kata sandi (acak/`NEW_PASSWORD`), aktifkan akun, buka blokir login; `--diagnose` hanya memeriksa penyebab |

## Struktur
```
src/app/            halaman & server actions (login, pilih-konteks, ganti-password, (app)/dashboard)
src/lib/auth/       login-core (logika murni), context (cookie HMAC), session (otorisasi server)
src/lib/supabase/   klien user (RLS) dan admin (service role, server-only)
supabase/migrations 0001 identitas/RBAC/audit · 0002 skema keuangan & dokumen · 0003 RLS & view · 0004 KPI
supabase/tests/     shim Supabase, tes RLS (SQL), tes konkurensi
docs/               arsitektur, matriks izin, database, deployment, keamanan, panduan pengguna
```

## Variabel lingkungan
Lihat `.env.example`. **Publik:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
**Rahasia server (jangan pernah `NEXT_PUBLIC_`):** `SUPABASE_SERVICE_ROLE_KEY`, `APP_SECRET`.

## Dokumen
- [Arsitektur & rencana](docs/architecture.md) · [Matriks izin](docs/permission-matrix.md)
- [Database & definisi finansial](docs/database.md) · [Deployment & rollback](docs/deployment.md)
- [Checklist keamanan](docs/security-checklist.md) · [Panduan pengguna](docs/panduan-pengguna.md)


## Pembaruan: Anggaran Kas triwulanan, unggah ADMIN, rekap akun (migrasi 0016)
- **Anggaran Kas per TRIWULAN** untuk semua akun (tabel TW I–IV, templat, ekspor, cetak). Penyimpanan tetap 12 periode (tiap TW dibagi 3) sehingga data lama, LRA, dasbor, dan laporan triwulan tidak berubah.
- **ADMIN dapat mengunggah Excel/CSV/PDF berteks** di menu Anggaran Kas; tiap baris didistribusikan sebagai draf ke PPTK penanggung jawab butir (kode sub kegiatan + rekening, opsional sumber dana/uraian/pptk; kode program/kegiatan dan pagu bila ada ikut divalidasi).
- **Penyesuaian menurut tahapan**: Perubahan = pagu tetap → kas tetap, pagu berubah → kas disesuaikan; Pergeseran = pagu berpindah antar-rekening dalam sub kegiatan yang sama (peringatan bila total pagu sub kegiatan berubah), boleh berkali-kali (pilih versi pergeseran sebelumnya sebagai sumber).
- **Menu Pengguna**: rekap akun + kata sandi sementara (terenkripsi AES-GCM di `account_temp_credentials`, hanya service role; terhapus saat pengguna mengganti sandi), reset cepat acak, unduh rekap Excel/CSV. Kata sandi pilihan pengguna tidak dapat dilihat (hanya hash di Supabase Auth).
- Jalankan `supabase/migrations/0016_kata_sandi_sementara_dan_kas_triwulan.sql` (hanya menambah tabel). Dependensi baru: `unpdf@1.8.1`.


## Pembaruan: perbaikan login admin, riwayat akun, reset akun, Anggaran Kas dari pagu (migrasi 0017)
- **Penyebab "admin tidak bisa login" (diperbaiki):** setelah kata sandi benar, login dulu MENUTUP sesi bila tahun/tahapan yang dipilih belum punya versi anggaran. Pada basis data baru/habis direset, versi anggaran hanya bisa dibuat setelah masuk, sehingga admin terkunci. Kini akun yang sah tetap masuk dan diarahkan ke **Pilih Konteks**; admin dapat membuat tahun + tahapan (draf) di sana. Pembatasan percobaan juga diperbaiki: IP tak dikenal tidak lagi dihitung bersama, dan masuk berhasil membersihkan catatan gagal username tsb.
- **Riwayat akun** (`account_history`, hanya menambah tabel): dibuat/di-reset/diganti/ditangguhkan/peran diubah beserta pelaku dan waktu; tampil di menu **Pengguna** (kolom Dibuat, Reset terakhir, kartu Riwayat akun) dan di unduhan Excel/CSV. Tidak menyimpan kata sandi. Login memakai **username**, bukan email.
- **Reset akun:** `npm run accounts:reset -- --diagnose` (periksa semua akun), `-- --username admin`, `-- --all` (semua akun mendapat sandi acak baru + CSV rahasia), `-- --all --suspend-others` (hanya admin aktif). Akun tidak dihapus agar jejak audit dan pembuat data anggaran tetap utuh.
- **Anggaran Kas dari Input Anggaran:** mode baru **Susun dari pagu Input Anggaran** (tanpa tahapan sumber, rupiah utuh, TW I–IV untuk Murni; mulai TW DPA untuk tahapan lain) di samping penyesuaian Pergeseran/Perubahan yang sudah ada.
- `.env.example` ditambahkan (sebelumnya tidak ada di zip sehingga tes keamanan gagal). Pembagian kas butir baru kini memakai rupiah utuh (134/133/133, bukan 133,34).
- Jalankan `supabase/migrations/0017_riwayat_akun.sql` di Supabase (aman diulang).
