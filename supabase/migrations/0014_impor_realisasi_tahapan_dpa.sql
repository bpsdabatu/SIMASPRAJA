-- =====================================================================
-- 0014 — Impor realisasi massal: tahapan ditentukan oleh TANGGAL DPA + jejak batch yang akuntabel
--
-- ADITIF dan aman dijalankan berulang. Tidak mengubah/menghapus data, kolom, fungsi, maupun kebijakan yang sudah ada
-- (record_realization_v2 dan input manual berjalan persis seperti sebelumnya).
--
--  1. realization_import_batches : satu baris per unggahan (nama berkas, sidik jari SHA-256, jumlah baris, total, pelaku, waktu).
--  2. realization_transactions   : + import_batch_id, + import_key (kunci unik per baris impor -> unggah ulang berkas yang sama
--                                  tidak menggandakan transaksi; ditegakkan basis data, bukan hanya aplikasi).
--  3. public.stage_version_for_date(fy, tanggal) : versi anggaran yang berlaku pada suatu tanggal =
--       versi ber-DPA dengan tanggal DPA terbesar yang <= tanggal (sama tanggal: Murni < Pergeseran < Perubahan, lalu nomor versi).
--       Sebelum DPA pertama berlaku -> versi Murni.
--  4. public.start_realization_import(...)  : membuka batch.
--  5. public.import_realization_row(...)    : menyimpan satu baris. Versi ditentukan DATABASE dari tanggal (bukan kiriman klien);
--       validasi sama dengan record_realization_v2, ditambah: versi draf ditolak, kunci impor ganda dilewati.
--       Hak: PPTK penugasan butir (realization.edit) ATAU Admin (realization.correct) untuk butir di organisasinya.
--  6. Pengaman urutan tanggal DPA ANTAR tahapan (Murni < Pergeseran < Perubahan) agar penentuan tahapan tidak ambigu.
-- =====================================================================

create table if not exists public.realization_import_batches (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  fiscal_year_id  uuid not null references public.fiscal_years(id),
  file_name       text not null,
  file_sha256     text not null,
  basis           text not null default 'transaksi' check (basis in ('transaksi', 'sp2d')),
  rows_in_file    integer not null check (rows_in_file >= 0),
  total_in_file   numeric(18,2) not null check (total_in_file >= 0),
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now()
);
create index if not exists rib_org_idx on public.realization_import_batches (organization_id, created_at desc);

alter table public.realization_import_batches enable row level security;
drop policy if exists rib_select on public.realization_import_batches;
create policy rib_select on public.realization_import_batches for select to authenticated
  using (organization_id = app.current_org() and app.has_permission('realization.view'));
-- Tanpa kebijakan insert/update/delete: batch hanya dibuat lewat fungsi di bawah.

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_audit_realization_import_batches') then
    create trigger trg_audit_realization_import_batches after insert or update or delete on public.realization_import_batches
      for each row execute function app.audit_trigger();
  end if;
end $$;

alter table public.realization_transactions add column if not exists import_batch_id uuid references public.realization_import_batches(id);
alter table public.realization_transactions add column if not exists import_key text;
create unique index if not exists rt_import_key_uk on public.realization_transactions (organization_id, import_key) where import_key is not null;
create index if not exists rt_import_batch_idx on public.realization_transactions (import_batch_id) where import_batch_id is not null;

-- ---------------------------------------------------------------------
-- Tahapan berlaku pada suatu tanggal
-- ---------------------------------------------------------------------
create or replace function public.stage_version_for_date(p_fy uuid, p_date date)
returns table (version_id uuid, stage_code text, version_no integer, status text, dpa_date date, effective boolean)
language sql stable security definer set search_path = public as $$
  with eff as (
    select bv.id, bv.stage_code, bv.version_no, bv.status, bv.dpa_date
      from public.budget_versions bv
     where bv.organization_id = app.current_org() and bv.fiscal_year_id = p_fy
       and bv.dpa_date is not null and bv.dpa_date <= p_date
     order by bv.dpa_date desc,
              case bv.stage_code when 'murni' then 1 when 'pergeseran' then 2 else 3 end desc,
              bv.version_no desc
     limit 1
  ), fallback as (
    select bv.id, bv.stage_code, bv.version_no, bv.status, bv.dpa_date
      from public.budget_versions bv
     where bv.organization_id = app.current_org() and bv.fiscal_year_id = p_fy and bv.stage_code = 'murni'
       and not exists (select 1 from eff)
     order by bv.version_no desc
     limit 1
  )
  select id, stage_code, version_no, status, dpa_date, true from eff
  union all
  select id, stage_code, version_no, status, dpa_date, false from fallback;
$$;
revoke all on function public.stage_version_for_date(uuid, date) from public, anon;
grant execute on function public.stage_version_for_date(uuid, date) to authenticated;

-- ---------------------------------------------------------------------
-- Membuka batch impor
-- ---------------------------------------------------------------------
create or replace function public.start_realization_import(
  p_fy uuid, p_file_name text, p_sha256 text, p_rows integer, p_total numeric, p_basis text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := app.current_org(); v_id uuid;
begin
  if not (app.has_permission('realization.edit') or app.has_permission('realization.correct')) then
    raise exception 'Tidak berwenang mengimpor realisasi' using errcode = '42501';
  end if;
  if v_org is null then raise exception 'Organisasi tidak ditemukan' using errcode = '42501'; end if;
  if not exists (select 1 from public.fiscal_years where id = p_fy and organization_id = v_org) then
    raise exception 'Tahun anggaran tidak ditemukan' using errcode = '22023';
  end if;
  if coalesce(p_basis, '') not in ('transaksi', 'sp2d') then raise exception 'Dasar penentuan tahapan tidak valid' using errcode = '22023'; end if;
  insert into public.realization_import_batches (organization_id, fiscal_year_id, file_name, file_sha256, basis, rows_in_file, total_in_file, created_by)
  values (v_org, p_fy, left(coalesce(nullif(trim(p_file_name), ''), 'tanpa-nama'), 200), left(coalesce(p_sha256, ''), 64), p_basis, greatest(coalesce(p_rows, 0), 0), greatest(coalesce(p_total, 0), 0), auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.start_realization_import(uuid, text, text, integer, numeric, text) from public, anon;
grant execute on function public.start_realization_import(uuid, text, text, integer, numeric, text) to authenticated;

-- ---------------------------------------------------------------------
-- Menyimpan satu baris impor. Mengembalikan id transaksi, atau NULL bila kunci impor sudah ada (dilewati).
-- ---------------------------------------------------------------------
create or replace function public.import_realization_row(
  p_batch uuid, p_item uuid, p_tx_date date, p_sp2d_date date, p_description text,
  p_supplier uuid, p_method uuid, p_amount numeric, p_import_key text, p_expected_version uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app.current_org();
  v_fy uuid; v_year int; v_basis text; v_stage_date date;
  v_ver uuid; v_ver_status text; v_ver_stage text;
  v_tx uuid; v_pay uuid; v_desc text;
  v_today date := (now() at time zone 'Asia/Jakarta')::date;
begin
  if not (app.has_permission('realization.edit') or app.has_permission('realization.correct')) then
    raise exception 'Tidak berwenang mengimpor realisasi' using errcode = '42501';
  end if;
  if v_org is null then raise exception 'Organisasi tidak ditemukan' using errcode = '42501'; end if;
  if app.has_permission('realization.correct') then
    if not app.can_access_item(p_item) then raise exception 'Butir anggaran tidak ditemukan' using errcode = '42501'; end if;
  elsif not app.is_assigned_pptk(p_item) then
    raise exception 'Butir anggaran bukan milik Anda (PPTK penugasan)' using errcode = '42501';
  end if;
  if coalesce(trim(p_import_key), '') = '' then raise exception 'Kunci impor wajib' using errcode = '22023'; end if;

  select b.fiscal_year_id, fy.year, b.basis into v_fy, v_year, v_basis
    from public.realization_import_batches b join public.fiscal_years fy on fy.id = b.fiscal_year_id
   where b.id = p_batch and b.organization_id = v_org;
  if v_fy is null then raise exception 'Batch impor tidak ditemukan' using errcode = '22023'; end if;
  if not exists (select 1 from public.budget_items where id = p_item and fiscal_year_id = v_fy) then
    raise exception 'Butir anggaran bukan bagian dari tahun anggaran batch ini' using errcode = '22023';
  end if;

  if p_tx_date is null then raise exception 'Tanggal transaksi wajib diisi' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Nilai realisasi harus lebih dari nol' using errcode = '22023'; end if;
  if round(p_amount, 2) <> p_amount then raise exception 'Nilai realisasi maksimal dua angka desimal' using errcode = '22023'; end if;
  if extract(year from p_tx_date)::int <> v_year then raise exception 'Tanggal transaksi harus berada pada tahun anggaran %', v_year using errcode = '22023'; end if;
  if p_tx_date > v_today then raise exception 'Tanggal transaksi tidak boleh melebihi tanggal hari ini' using errcode = '22023'; end if;
  if p_sp2d_date is not null then
    if extract(year from p_sp2d_date)::int <> v_year then raise exception 'Tanggal SP2D harus berada pada tahun anggaran %', v_year using errcode = '22023'; end if;
    if p_tx_date > p_sp2d_date then raise exception 'Tanggal transaksi tidak boleh setelah tanggal SP2D' using errcode = '22023'; end if;
    if p_sp2d_date > v_today then raise exception 'Tanggal SP2D tidak boleh melebihi tanggal hari ini' using errcode = '22023'; end if;
  end if;
  if p_supplier is not null and not exists (select 1 from public.suppliers where id = p_supplier and organization_id = v_org) then
    raise exception 'Penyedia tidak valid' using errcode = '22023';
  end if;
  if p_method is not null and not exists (select 1 from public.procurement_methods where id = p_method and organization_id = v_org) then
    raise exception 'Metode pengadaan tidak valid' using errcode = '22023';
  end if;

  -- Tahapan: ditentukan DATABASE dari tanggal DPA.
  v_stage_date := case when v_basis = 'sp2d' and p_sp2d_date is not null then p_sp2d_date else p_tx_date end;
  select s.version_id, s.status, s.stage_code into v_ver, v_ver_status, v_ver_stage from public.stage_version_for_date(v_fy, v_stage_date) s;
  if v_ver is null then raise exception 'Belum ada versi anggaran untuk tanggal %', v_stage_date using errcode = '22023'; end if;
  if v_ver_status = 'draft' then
    raise exception 'Versi % untuk tanggal % masih berstatus draf; aktifkan/tetapkan versinya lebih dulu', v_ver_stage, v_stage_date using errcode = '22023';
  end if;
  if p_expected_version is not null and p_expected_version <> v_ver then
    raise exception 'Tahapan untuk tanggal % berubah sejak pemeriksaan (tanggal DPA diubah?). Periksa ulang berkas', v_stage_date using errcode = '22023';
  end if;
  if not exists (select 1 from public.budget_item_versions where budget_version_id = v_ver and budget_item_id = p_item) then
    raise exception 'Butir anggaran tidak ada pada versi % (tahapan untuk tanggal %)', v_ver_stage, v_stage_date using errcode = '22023';
  end if;

  v_desc := nullif(trim(coalesce(p_description, '')), '');
  if v_desc is null then
    select 'Realisasi ' || ea.name into v_desc
      from public.budget_items bi join public.expenditure_accounts ea on ea.id = bi.expenditure_account_id where bi.id = p_item;
    v_desc := coalesce(v_desc, 'Realisasi belanja');
  end if;

  if p_sp2d_date is null then
    insert into public.realization_transactions (organization_id, budget_version_id, budget_item_id, transaction_date, description,
          supplier_id, procurement_method_id, status, created_by, import_batch_id, import_key)
    values (v_org, v_ver, p_item, p_tx_date, v_desc, p_supplier, p_method, 'payment_processing', auth.uid(), p_batch, p_import_key)
    on conflict (organization_id, import_key) where import_key is not null do nothing
    returning id into v_tx;
    if v_tx is null then return null; end if;
    insert into public.payment_records (organization_id, transaction_id, amount, created_by) values (v_org, v_tx, p_amount, auth.uid());
    return v_tx;
  end if;

  insert into public.realization_transactions (organization_id, budget_version_id, budget_item_id, transaction_date, description,
        supplier_id, procurement_method_id, status, created_by, import_batch_id, import_key)
  values (v_org, v_ver, p_item, p_tx_date, v_desc, p_supplier, p_method, 'draft', auth.uid(), p_batch, p_import_key)
  on conflict (organization_id, import_key) where import_key is not null do nothing
  returning id into v_tx;
  if v_tx is null then return null; end if;

  insert into public.payment_records (organization_id, transaction_id, amount, created_by) values (v_org, v_tx, p_amount, auth.uid())
  returning id into v_pay;
  insert into public.sp2d_records (organization_id, fiscal_year_id, payment_record_id, sp2d_number, sp2d_date, created_by)
  values (v_org, v_fy, v_pay, null, p_sp2d_date, auth.uid());
  update public.realization_transactions set status = 'realisasi', updated_by = auth.uid() where id = v_tx;
  return v_tx;
end $$;
revoke all on function public.import_realization_row(uuid, uuid, date, date, text, uuid, uuid, numeric, text, uuid) from public, anon;
grant execute on function public.import_realization_row(uuid, uuid, date, date, text, uuid, uuid, numeric, text, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Urutan tanggal DPA antar tahapan: Murni < Pergeseran < Perubahan
-- ---------------------------------------------------------------------
create or replace function app.guard_version_dpa_stage_order() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_seq int := case new.stage_code when 'murni' then 1 when 'pergeseran' then 2 else 3 end;
begin
  if new.dpa_date is null or new.dpa_date is not distinct from old.dpa_date then return new; end if;
  if exists (
    select 1 from public.budget_versions o
     where o.fiscal_year_id = new.fiscal_year_id and o.id <> new.id and o.dpa_date is not null
       and (case o.stage_code when 'murni' then 1 when 'pergeseran' then 2 else 3 end) <> v_seq
       and (((case o.stage_code when 'murni' then 1 when 'pergeseran' then 2 else 3 end) < v_seq and o.dpa_date >= new.dpa_date)
         or ((case o.stage_code when 'murni' then 1 when 'pergeseran' then 2 else 3 end) > v_seq and o.dpa_date <= new.dpa_date))) then
    raise exception 'Tanggal DPA harus berurutan antar tahapan: Murni, lalu Pergeseran, lalu Perubahan' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists trg_budget_versions_dpa_stage_order on public.budget_versions;
create trigger trg_budget_versions_dpa_stage_order before update of dpa_date on public.budget_versions
  for each row execute function app.guard_version_dpa_stage_order();
