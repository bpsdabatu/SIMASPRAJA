-- =====================================================================
-- 0019_kelola_akun.sql  (ADITIF)
-- 1) Riwayat akun: tambah jenis kejadian DATA_DIUBAH, DINONAKTIFKAN, DIHAPUS.
-- 2) delete_unused_account: menghapus akun HANYA bila belum dipakai pada data lain, secara ATOMIK.
--    Bila akun sudah tercatat di anggaran/realisasi/dokumen/dsb (kunci asing), seluruh penghapusan dibatalkan
--    (tidak ada akun setengah terhapus) dan aplikasi menyarankan menonaktifkan akun. Hanya service role yang dapat memanggil.
-- =====================================================================
alter table public.account_history drop constraint if exists account_history_event_check;
alter table public.account_history add constraint account_history_event_check check (event in
  ('DIBUAT','SANDI_DIRESET','SANDI_DIGANTI','DITANGGUHKAN','DIAKTIFKAN','PERAN_DIUBAH','DIPULIHKAN','DATA_DIUBAH','DINONAKTIFKAN','DIHAPUS'));

create or replace function public.delete_unused_account(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  begin
    delete from public.user_scopes where user_id = p_user;
    delete from public.user_roles where user_id = p_user;
    delete from public.account_temp_credentials where profile_id = p_user;
    delete from public.auth_identities where profile_id = p_user;
    delete from public.profiles where id = p_user;
  exception when foreign_key_violation then
    -- blok BEGIN..EXCEPTION membatalkan semua penghapusan di atas
    raise exception 'ACCOUNT_IN_USE' using errcode = '23503';
  end;
end $$;
revoke all on function public.delete_unused_account(uuid) from public, anon, authenticated;
grant execute on function public.delete_unused_account(uuid) to service_role;
