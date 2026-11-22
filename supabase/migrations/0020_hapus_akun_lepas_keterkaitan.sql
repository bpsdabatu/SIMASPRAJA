-- =====================================================================
-- 0020_hapus_akun_lepas_keterkaitan.sql  (ADITIF)
-- delete_account(p_user, p_detach): hapus akun oleh Admin (dipanggil server setelah cek users.manage).
--  - p_detach = false : sama seperti delete_unused_account (ditolak bila akun sudah dipakai pada data lain).
--  - p_detach = true  : kolom "pembuat/penanggung jawab" yang BOLEH kosong (created_by, updated_by, pptk_id, dst.) pada data lama
--                       dikosongkan lebih dulu, lalu akun dihapus. Bila ada kolom WAJIB terisi yang masih memakai akun ini
--                       (mis. penyusun dokumen), atau tabel append-only menolak perubahan, SELURUH proses dibatalkan.
-- Atomik: gagal = tidak ada yang berubah. Hanya service role yang dapat memanggil.
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
  exception when others then
    -- blok BEGIN..EXCEPTION membatalkan semua perubahan di atas
    raise exception 'ACCOUNT_IN_USE: %', sqlerrm using errcode = '23503';
  end;
end $$;
revoke all on function public.delete_account(uuid, boolean) from public, anon, authenticated;
grant execute on function public.delete_account(uuid, boolean) to service_role;
