-- =====================================================================
-- 0016_kata_sandi_sementara_dan_kas_triwulan.sql
-- Tambahan (additive; tidak mengubah/menghapus data yang ada):
--  1) account_temp_credentials: menyimpan kata sandi SEMENTARA (terenkripsi AES-GCM oleh aplikasi) agar ADMIN dapat melihat/mereset
--     akun dengan cepat di menu Pengguna. Baris dihapus otomatis saat pengguna mengganti kata sandinya sendiri.
--     Kata sandi yang dipilih pengguna sendiri TIDAK pernah tersimpan (Supabase Auth hanya menyimpan hash).
--     RLS aktif tanpa kebijakan + hak akses dicabut: hanya service role (server aplikasi) yang dapat membaca/menulis.
--  2) Anggaran Kas disusun per TRIWULAN di antarmuka; penyimpanan tetap 12 periode bulanan (tiap triwulan dibagi 3),
--     sehingga data lama, LRA, dasbor, dan laporan triwulan tidak perlu diubah. Tidak ada perubahan skema untuk ini.
-- Idempotent.
-- =====================================================================
create table if not exists public.account_temp_credentials (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  ciphertext text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.account_temp_credentials enable row level security;
revoke all on public.account_temp_credentials from public, anon, authenticated;
