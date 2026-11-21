-- =====================================================================
-- 0018_penugasan_dokumen.sql  (ADITIF: tidak mengubah tabel/fungsi yang ada)
-- Masalah: kebijakan user_roles_select hanya mengizinkan membaca peran SENDIRI (atau semua bila users.manage),
-- sehingga PPTK/PPK yang menyusun dokumen mendapat daftar PPK/PPBJ KOSONG pada formulir penugasan.
-- Perbaikan: fungsi SECURITY DEFINER sempit (hanya id + nama pengguna AKTIF berperan ppk/ppbj pada organisasi
-- pemanggil, hanya untuk penyusun dokumen/admin), serta RPC untuk mengubah penugasan saat draf/perbaikan.
-- =====================================================================

create or replace function public.assignable_users(p_role text)
returns table (id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select pr.id, pr.full_name
    from public.profiles pr
    join public.user_roles ur on ur.user_id = pr.id and ur.role_code = p_role
   where p_role in ('ppk', 'ppbj')
     and pr.status = 'active'
     and pr.organization_id = app.current_org()
     and (app.has_permission('document.create_pptk') or app.has_permission('document.create_ppk') or app.has_permission('users.manage'))
   order by pr.full_name
$$;
revoke all on function public.assignable_users(text) from public, anon;
grant execute on function public.assignable_users(text) to authenticated;

-- Penyusun mengubah penugasan PPK/PPBJ selama dokumen masih draf / dikembalikan untuk perbaikan.
create or replace function public.set_document_assignees(p_doc uuid, p_ppk uuid, p_ppbj uuid) returns void
language plpgsql security invoker set search_path = public as $$
declare v_status text; v_owner uuid; n int;
begin
  select status, created_by into v_status, v_owner from public.procurement_documents where id = p_doc;
  if v_status is null then raise exception 'Dokumen tidak ditemukan' using errcode = '22023'; end if;
  if v_owner <> auth.uid() then raise exception 'Hanya penyusun dokumen yang dapat mengubah penugasan' using errcode = '42501'; end if;
  if v_status not in ('draft', 'returned_for_correction') then
    raise exception 'Dokumen berstatus % tidak dapat diubah penugasannya', v_status using errcode = '42501';
  end if;
  if p_ppk is not null and not app.has_active_role(p_ppk, 'ppk') then
    raise exception 'PPK yang dipilih tidak valid' using errcode = '22023';
  end if;
  if p_ppbj is not null and not app.has_active_role(p_ppbj, 'ppbj') then
    raise exception 'PPBJ yang dipilih tidak valid' using errcode = '22023';
  end if;
  update public.procurement_documents set assigned_ppk_id = p_ppk, assigned_ppbj_id = p_ppbj where id = p_doc;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Tidak berwenang mengubah penugasan dokumen ini' using errcode = '42501'; end if;
end $$;
revoke all on function public.set_document_assignees(uuid, uuid, uuid) from public, anon;
grant execute on function public.set_document_assignees(uuid, uuid, uuid) to authenticated;
