-- =====================================================================
-- 0023_perbaikan_hapus_akun.sql  (ADITIF; menimpa fungsi dari 0019 & 0020 dengan create or replace)
-- Perbaikan: sebelumnya SEMUA galat saat menghapus akun dipetakan menjadi "ACCOUNT_IN_USE" (menyesatkan). Kini hanya pelanggaran kunci asing
-- dan penolakan oleh data wajib/tabel riwayat yang dipetakan demikian; galat lain (hak akses, tabel hilang, dsb.) diteruskan apa adanya agar
-- penyebab sebenarnya terlihat di log. Penghapusan tetap ATOMIK (blok BEGIN..EXCEPTION membatalkan semua langkah).
-- =====================================================================
create or replace function public.delete_account(p_user uuid, p_detach boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare r record; n bigint;
begin
  begin
    delete from public.user_scopes where user_id = p_user;
    delete from public.user_roles where user_id = p_user;
    delete from public.account_temp_credentials where profile_id = p_user;
    delete from public.auth_identities where profile_id = p_user;
    if p_detach then
      for r in
        select c.conrelid::regclass::text as tbl, a.attname::text as col, a.attnotnull as nn
          from pg_constraint c
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
         where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass and array_length(c.conkey, 1) = 1
      loop
        if r.nn then
          execute format('select count(*) from %s where %I = $1', r.tbl, r.col) into n using p_user;
          if n > 0 then raise exception 'kolom wajib %.% masih memakai akun ini', r.tbl, r.col; end if;
        else
          execute format('update %s set %I = null where %I = $1', r.tbl, r.col, r.col) using p_user;
        end if;
      end loop;
    end if;
    delete from public.profiles where id = p_user;
  exception
    when foreign_key_violation or raise_exception then
      raise exception 'ACCOUNT_IN_USE: %', sqlerrm using errcode = '23503';
  end;
end $$;
revoke all on function public.delete_account(uuid, boolean) from public, anon, authenticated;
grant execute on function public.delete_account(uuid, boolean) to service_role;

create or replace function public.delete_unused_account(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.delete_account(p_user, false);
end $$;
revoke all on function public.delete_unused_account(uuid) from public, anon, authenticated;
grant execute on function public.delete_unused_account(uuid) to service_role;
