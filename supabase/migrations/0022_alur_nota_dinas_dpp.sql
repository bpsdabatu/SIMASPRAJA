-- =====================================================================
-- 0022_alur_nota_dinas_dpp.sql  (ADITIF)
-- Menyelaraskan alur dokumen dengan pembagian tugas pada regulasi pengadaan barang/jasa:
--   1) Nota Dinas PPTK  -> PPK   : PPTK mengusulkan kebutuhan (rincian, referensi harga, bahan spesifikasi/HPS); PPK MENERIMA atau MENGEMBALIKAN.
--   2) DPP                       : PPK yang menyusun dan MENETAPKAN (persiapan pengadaan = tugas PPK); PPTK pada butir anggarannya ikut menyusun.
--   3) Nota Dinas PPK   -> PPBJ  : PPK menyampaikan permintaan pemilihan/reviu beserta DPP; PPBJ MENERIMA. Reviu DPP dilakukan PPBJ bersama PPK
--                                  dan dituangkan dalam Berita Acara Reviu (alur reviu yang ada, kini khusus dokumen DPP).
-- =====================================================================
alter table public.procurement_documents
  add column if not exists source_document_id uuid references public.procurement_documents(id);
create index if not exists pd_source_idx on public.procurement_documents (source_document_id);

-- PPK (berhak membuat Nota Dinas PPK) juga dapat menyusun DPP pada butir yang dapat diaksesnya.
create policy docs_insert_dpp_ppk on public.procurement_documents for insert to authenticated
  with check (organization_id = app.current_org() and created_by = auth.uid() and status = 'draft'
              and doc_type = 'dpp' and app.has_permission('document.create_ppk') and app.can_access_item(budget_item_id));

-- PPTK pada butir anggaran juga dapat MELIHAT DPP butirnya (ikut menyusun).
create or replace function app.can_access_document(p_doc uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.procurement_documents d
    where d.id = p_doc and d.organization_id = app.current_org()
      and app.has_permission('document.view')
      and (   app.has_role('admin')
           or d.created_by = auth.uid()
           or d.assigned_ppk_id = auth.uid()
           or d.assigned_ppbj_id = auth.uid()
           or (app.has_role('ppk') and app.item_in_scope(d.budget_item_id))
           or (d.doc_type = 'dpp' and app.has_permission('document.create_pptk') and app.is_assigned_pptk(d.budget_item_id))))
$$;

-- Penyusunan bersama DPP: penyusun (PPK; DPP lama: PPTK), PPK yang ditugaskan, atau PPTK pada butir anggaran tersebut.
create or replace function public.save_shared_revision(
  p_doc uuid, p_title text, p_content jsonb, p_note text default null, p_base_revision int default null)
returns int
language plpgsql security invoker set search_path = public as $$
declare
  v_status text; v_owner uuid; v_type text; v_ppk uuid; v_item uuid; v_latest int; v_no int; v_is_owner boolean; v_is_coauthor boolean;
begin
  select status, created_by, doc_type, assigned_ppk_id, budget_item_id into v_status, v_owner, v_type, v_ppk, v_item
    from public.procurement_documents where id = p_doc;
  if v_status is null then raise exception 'Dokumen tidak ditemukan' using errcode = '22023'; end if;
  v_is_owner := v_owner = auth.uid();
  v_is_coauthor := v_type = 'dpp' and (
       (v_ppk = auth.uid() and app.has_permission('document.create_ppk'))
    or (app.has_permission('document.create_pptk') and app.is_assigned_pptk(v_item)));
  if not (v_is_owner or v_is_coauthor) then
    raise exception 'Hanya penyusun, PPK, atau PPTK pada butir anggaran DPP ini yang dapat mengubah isi' using errcode = '42501';
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
  if v_is_owner and nullif(trim(coalesce(p_title, '')), '') is not null then
    update public.procurement_documents set title = trim(p_title) where id = p_doc;
  end if;
  return v_no;
end $$;

-- Penerimaan Nota Dinas: PPK menerima Nota Dinas PPTK; PPBJ menerima Nota Dinas PPK. (Wewenang diperiksa eksplisit di sini.)
create or replace function public.accept_document(p_doc uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_status text; v_type text; v_ppk uuid; v_ppbj uuid; v_org uuid;
begin
  select status, doc_type, assigned_ppk_id, assigned_ppbj_id, organization_id into v_status, v_type, v_ppk, v_ppbj, v_org
    from public.procurement_documents where id = p_doc;
  if v_status is null or v_org is distinct from app.current_org() then raise exception 'Dokumen tidak ditemukan' using errcode = '22023'; end if;
  if v_status not in ('submitted', 'resubmitted') then raise exception 'Dokumen berstatus % tidak dapat diterima', v_status using errcode = '22023'; end if;
  if v_type = 'nota_dinas_pptk' then
    if v_ppk is distinct from auth.uid() or not app.has_permission('document.return') then
      raise exception 'Hanya PPK tujuan yang dapat menerima Nota Dinas PPTK' using errcode = '42501';
    end if;
  elsif v_type = 'nota_dinas_ppk' then
    if v_ppbj is distinct from auth.uid() or not app.has_permission('document.review') then
      raise exception 'Hanya PPBJ tujuan yang dapat menerima Nota Dinas PPK' using errcode = '42501';
    end if;
  else
    raise exception 'Jenis dokumen ini tidak diterima dengan cara ini (DPP direviu PPBJ)' using errcode = '22023';
  end if;
  update public.procurement_documents set status = 'issued' where id = p_doc;
end $$;
revoke all on function public.accept_document(uuid) from public, anon;
grant execute on function public.accept_document(uuid) to authenticated;

-- Reviu (temuan, Berita Acara) hanya untuk DPP.
create or replace function public.start_review(p_doc uuid) returns uuid
language plpgsql security invoker set search_path = public as $$
declare v_status text; v_rev uuid; v_review uuid; n int;
begin
  perform app.require_permission('document.review');
  select status into v_status from public.procurement_documents where id = p_doc and assigned_ppbj_id = auth.uid() and doc_type = 'dpp';
  if v_status is null then raise exception 'Dokumen tidak ditugaskan kepada Anda untuk direviu (reviu berlaku untuk DPP)' using errcode = '42501'; end if;
  if v_status not in ('submitted', 'resubmitted') then
    raise exception 'Dokumen berstatus % tidak dapat direviu', v_status using errcode = '22023';
  end if;
  select id into v_rev from public.document_revisions where document_id = p_doc order by revision_no desc limit 1;
  update public.procurement_documents set status = 'under_review' where id = p_doc;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Tidak berwenang mereviu dokumen ini' using errcode = '42501'; end if;
  insert into public.document_reviews (document_id, revision_id, reviewer_id)
  values (p_doc, v_rev, auth.uid()) returning id into v_review;
  return v_review;
end $$;

-- Menautkan dokumen turunan (DPP dari Nota Dinas PPTK; Nota Dinas PPK dari DPP). Hanya penyusun, saat draf, pada butir yang sama.
create or replace function public.set_document_source(p_doc uuid, p_source uuid) returns void
language plpgsql security invoker set search_path = public as $$
declare v_owner uuid; v_status text; v_type text; v_item uuid; s_type text; s_item uuid; s_status text; n int;
begin
  select created_by, status, doc_type, budget_item_id into v_owner, v_status, v_type, v_item from public.procurement_documents where id = p_doc;
  if v_owner is null then raise exception 'Dokumen tidak ditemukan' using errcode = '22023'; end if;
  if v_owner <> auth.uid() or v_status <> 'draft' then raise exception 'Hanya penyusun yang dapat menautkan dokumen draf' using errcode = '42501'; end if;
  select doc_type, budget_item_id, status into s_type, s_item, s_status from public.procurement_documents where id = p_source;
  if s_type is null then raise exception 'Dokumen sumber tidak ditemukan atau tidak dapat diakses' using errcode = '22023'; end if;
  if s_item <> v_item then raise exception 'Dokumen sumber harus pada butir anggaran yang sama' using errcode = '22023'; end if;
  if not ((v_type = 'dpp' and s_type = 'nota_dinas_pptk' and s_status = 'issued') or (v_type = 'nota_dinas_ppk' and s_type = 'dpp')) then
    raise exception 'Tautan dokumen tidak sesuai alur (Nota Dinas PPTK diterima -> DPP -> Nota Dinas PPK)' using errcode = '22023';
  end if;
  update public.procurement_documents set source_document_id = p_source where id = p_doc;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Tidak berwenang menautkan dokumen ini' using errcode = '42501'; end if;
end $$;
revoke all on function public.set_document_source(uuid, uuid) from public, anon;
grant execute on function public.set_document_source(uuid, uuid) to authenticated;
