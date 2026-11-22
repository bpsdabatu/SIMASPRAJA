-- =====================================================================
-- 0021_rup_sirup_dan_penyusunan_bersama.sql  (ADITIF)
-- 1) Referensi RUP diperluas agar dapat memuat data unggahan SiRUP (pagu, jenis & metode pemilihan, sumber dana, lokasi, waktu, dst.).
--    Kolom lama (rup_code, package_name) tidak berubah; modul yang ada tetap berfungsi.
--    PPK (document.create_ppk) boleh mengunggah/memperbarui RUP, selain Admin (master.manage) yang sudah ada.
-- 2) save_shared_revision: DPP dapat disusun BERSAMA oleh PPTK (penyusun) dan PPK yang ditugaskan; ada pengaman
--    bentrok pengeditan (p_base_revision) agar perubahan salah satu pihak tidak tertimpa diam-diam.
-- =====================================================================
alter table public.rup_references
  add column if not exists pagu              numeric(18,2),
  add column if not exists jenis_pengadaan   text,
  add column if not exists metode_pemilihan  text,
  add column if not exists cara_pengadaan    text,
  add column if not exists sumber_dana       text,
  add column if not exists lokasi            text,
  add column if not exists satuan_kerja      text,
  add column if not exists kegiatan          text,
  add column if not exists waktu_pemilihan   text,
  add column if not exists waktu_pekerjaan   text,
  add column if not exists imported_at       timestamptz,
  add column if not exists imported_by       uuid references public.profiles(id);

create policy rup_references_insert_ppk on public.rup_references for insert to authenticated
  with check (organization_id = app.current_org() and app.has_permission('document.create_ppk'));
create policy rup_references_update_ppk on public.rup_references for update to authenticated
  using (organization_id = app.current_org() and app.has_permission('document.create_ppk'))
  with check (organization_id = app.current_org() and app.has_permission('document.create_ppk'));

create or replace function public.save_shared_revision(
  p_doc uuid, p_title text, p_content jsonb, p_note text default null, p_base_revision int default null)
returns int
language plpgsql security invoker set search_path = public as $$
declare
  v_status text; v_owner uuid; v_type text; v_ppk uuid; v_latest int; v_no int; v_is_owner boolean; v_is_coauthor boolean;
begin
  select status, created_by, doc_type, assigned_ppk_id into v_status, v_owner, v_type, v_ppk
    from public.procurement_documents where id = p_doc;
  if v_status is null then raise exception 'Dokumen tidak ditemukan' using errcode = '22023'; end if;
  v_is_owner := v_owner = auth.uid();
  v_is_coauthor := v_type = 'dpp' and v_ppk = auth.uid() and app.has_permission('document.create_ppk');
  if not (v_is_owner or v_is_coauthor) then
    raise exception 'Hanya penyusun (PPTK) atau PPK yang ditugaskan pada DPP yang dapat mengubah isi' using errcode = '42501';
  end if;
  if v_status not in ('draft', 'returned_for_correction') then
    raise exception 'Dokumen berstatus % tidak dapat diubah', v_status using errcode = '42501';
  end if;
  select coalesce(max(revision_no), 0) into v_latest from public.document_revisions where document_id = p_doc;
  if p_base_revision is not null and p_base_revision <> v_latest then
    raise exception 'Dokumen sudah diperbarui pihak lain (kini revisi %). Muat ulang halaman, lalu gabungkan perubahan Anda.', v_latest using errcode = '22023';
  end if;
  v_no := v_latest + 1;
  insert into public.document_revisions (document_id, revision_no, content, change_note, created_by)
  values (p_doc, v_no, coalesce(p_content, '{}'::jsonb), nullif(trim(coalesce(p_note, '')), ''), auth.uid());
  -- Judul hanya dapat diubah penyusun (kebijakan update dokumen berlaku untuk pemilik).
  if v_is_owner and nullif(trim(coalesce(p_title, '')), '') is not null then
    update public.procurement_documents set title = trim(p_title) where id = p_doc;
  end if;
  return v_no;
end $$;
revoke all on function public.save_shared_revision(uuid, text, jsonb, text, int) from public, anon;
grant execute on function public.save_shared_revision(uuid, text, jsonb, text, int) to authenticated;
