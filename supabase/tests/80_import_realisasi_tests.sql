-- =====================================================================
-- 80_import_realisasi_tests.sql
-- Tes migrasi 0014: penentuan tahapan lewat tanggal DPA, impor realisasi massal (batch + kunci impor), hak akses, urutan DPA antar tahapan.
-- Dijalankan SETELAH 70_sp2d_status_tests.sql pada database yang sama. Memakai tahun lalu agar semua tanggal <= hari ini.
-- =====================================================================
\set ON_ERROR_STOP on
reset role;
delete from t.results;

\set admin  '11111111-1111-1111-1111-111111111111'
\set ppk    '22222222-2222-2222-2222-222222222222'
\set pptk1  '33333333-3333-3333-3333-333333333333'
\set pptk2  '44444444-4444-4444-4444-444444444444'
\set ppbj   '55555555-5555-5555-5555-555555555555'
\set sub  '00000000-0000-0000-0000-00000000a003'
\set acct '00000000-0000-0000-0000-00000000e001'
\set fund '00000000-0000-0000-0000-00000000d001'

create or replace function t.yr() returns int language sql stable as $$ select extract(year from (now() at time zone 'Asia/Jakarta')::date)::int - 1 $$;
create or replace function t.yd(m int, d int) returns date language sql stable as $$ select make_date(t.yr(), m, d) $$;
grant execute on function t.yr(), t.yd(int, int) to public;
create or replace function t.stage_on(d date) returns text language sql stable security invoker as $$
  select s.stage_code from public.stage_version_for_date((select fiscal_year_id from public.budget_versions where id = t.id('im')), d) s $$;
grant execute on function t.stage_on(date) to public;

select t.as_user(:'admin');
select t.lives($q$insert into t.ids select 'im',  public.create_budget_version(t.yr(), 'murni')$q$, 'versi Murni (tahun lalu)');
select t.lives(format($q$insert into t.ids select 'ia', public.add_budget_item(t.id('im'), %L, %L, %L, %L, 'Butir impor A', 1000000)$q$, :'sub', :'acct', :'fund', :'pptk1'), 'butir A (PPTK1) pagu Murni 1.000.000');
select t.lives(format($q$insert into t.ids select 'ib', public.add_budget_item(t.id('im'), %L, %L, %L, %L, 'Butir impor B', 500000)$q$, :'sub', :'acct', :'fund', :'pptk2'), 'butir B (PPTK2)');
select t.lives($q$select public.set_budget_version_status(t.id('im'), 'active')$q$, 'Murni aktif');
select t.lives($q$insert into t.ids select 'ip', public.create_budget_version(t.yr(), 'pergeseran')$q$, 'versi Pergeseran I');
select t.lives(format($q$select public.add_budget_item(t.id('ip'), %L, %L, %L, %L, 'Butir impor A', 1500000)$q$, :'sub', :'acct', :'fund', :'pptk1'), 'butir A pada Pergeseran (pagu 1.500.000)');
select t.lives(format($q$insert into t.ids select 'ic', public.add_budget_item(t.id('ip'), %L, %L, %L, %L, 'Butir baru Pergeseran', 400000)$q$, :'sub', :'acct', :'fund', :'pptk1'), 'butir C hanya ada di Pergeseran');
select t.lives($q$select public.set_budget_version_status(t.id('ip'), 'active')$q$, 'Pergeseran aktif');
select t.lives($q$insert into t.ids select 'iu', public.create_budget_version(t.yr(), 'perubahan')$q$, 'versi Perubahan (draf)');

-- tanggal DPA + urutan antar tahapan
select t.lives($q$select public.set_budget_version_dpa_date(t.id('im'), t.yd(1, 2))$q$, 'DPA Murni 2 Jan');
select t.lives($q$select public.set_budget_version_dpa_date(t.id('ip'), t.yd(3, 16))$q$, 'DPA Pergeseran I 16 Mar');
select t.throws($q$select public.set_budget_version_dpa_date(t.id('iu'), t.yd(3, 1))$q$, 'DPA Perubahan sebelum Pergeseran ditolak');
select t.lives($q$select public.set_budget_version_dpa_date(t.id('iu'), t.yd(10, 26))$q$, 'DPA Perubahan 26 Okt diterima');
select t.throws($q$select public.set_budget_version_dpa_date(t.id('ip'), t.yd(11, 1), 'coba')$q$, 'DPA Pergeseran setelah Perubahan ditolak');
select t.throws($q$select public.set_budget_version_dpa_date(t.id('im'), t.yd(4, 1), 'coba')$q$, 'DPA Murni setelah Pergeseran ditolak');

-- penentuan tahapan per tanggal
select t.ok(t.stage_on(t.yd(1, 10)) = 'murni',     '10 Jan -> Murni');
select t.ok(t.stage_on(t.yd(3, 15)) = 'murni',     '15 Mar -> Murni (sehari sebelum DPA Pergeseran)');
select t.ok(t.stage_on(t.yd(3, 16)) = 'pergeseran','16 Mar -> Pergeseran (hari DPA berlaku)');
select t.ok(t.stage_on(t.yd(9, 30)) = 'pergeseran','30 Sep -> Pergeseran');
select t.ok(t.stage_on(t.yd(10, 26)) = 'perubahan','26 Okt -> Perubahan');
select t.ok(t.stage_on(t.yd(1, 1)) = 'murni',      'sebelum DPA Murni -> tetap Murni (fallback)');
select t.ok((select effective from public.stage_version_for_date((select fiscal_year_id from public.budget_versions where id = t.id('im')), t.yd(1, 1))) = false, 'fallback ditandai tidak efektif');

-- batch + impor
select t.lives(format($q$insert into t.ids select 'ibt1', public.start_realization_import((select fiscal_year_id from public.budget_versions where id = t.id('im')), 'uji.csv', repeat('a', 64), 4, 700000, 'transaksi')$q$), 'Admin membuka batch');
select t.lives($q$insert into t.ids select 'ir1', public.import_realization_row(t.id('ibt1'), t.id('ia'), t.yd(2, 10), t.yd(2, 12), 'Sebelum DPA Pergeseran', null, null, 300000, 'k1', null)$q$, 'Admin impor baris sebelum 16 Mar');
select t.ok((select budget_version_id from public.realization_transactions where id = t.id('ir1')) = t.id('im'), 'baris sebelum 16 Mar masuk versi MURNI');
select t.ok((select status from public.realization_transactions where id = t.id('ir1')) = 'realisasi', 'berstatus realisasi');
select t.ok((select import_batch_id from public.realization_transactions where id = t.id('ir1')) = t.id('ibt1'), 'terhubung ke batch');
select t.lives($q$insert into t.ids select 'ir2', public.import_realization_row(t.id('ibt1'), t.id('ia'), t.yd(4, 20), t.yd(4, 22), 'Sesudah DPA Pergeseran', null, null, 200000, 'k2', null)$q$, 'impor baris sesudah 16 Mar');
select t.ok((select budget_version_id from public.realization_transactions where id = t.id('ir2')) = t.id('ip'), 'baris sesudah 16 Mar masuk versi PERGESERAN');
select t.ok((select eligible_realization from public.v_budget_balance where budget_version_id = t.id('ip') and budget_item_id = t.id('ia')) = 200000, 'pagu Pergeseran memakai realisasi barisnya');
select t.ok((select eligible_realization from public.v_budget_balance where budget_version_id = t.id('im') and budget_item_id = t.id('ia')) = 300000, 'pagu Murni memakai realisasi barisnya');

-- idempoten: kunci yang sama tidak menggandakan
select t.ok(public.import_realization_row(t.id('ibt1'), t.id('ia'), t.yd(2, 10), t.yd(2, 12), 'Sebelum DPA Pergeseran', null, null, 300000, 'k1', null) is null, 'kunci impor yang sama dilewati (NULL)');
select t.ok((select count(*) from public.realization_transactions where import_key = 'k1') = 1, 'tetap 1 transaksi untuk kunci k1');

-- belum SP2D
select t.lives($q$insert into t.ids select 'ir3', public.import_realization_row(t.id('ibt1'), t.id('ia'), t.yd(5, 5), null, 'Belum SP2D', null, null, 100000, 'k3', null)$q$, 'baris belum SP2D diterima');
select t.ok((select status from public.realization_transactions where id = t.id('ir3')) = 'payment_processing', 'belum SP2D: payment_processing');

-- validasi
select t.throws($q$select public.import_realization_row(t.id('ibt1'), t.id('ia'), t.yd(2, 20), t.yd(2, 21), 'Lewat pagu Murni', null, null, 800000, 'k4', null)$q$, 'melebihi pagu versi Murni ditolak (300.000 + 800.000 > 1.000.000)');
select t.throws($q$select public.import_realization_row(t.id('ibt1'), t.id('ia'), t.yd(2, 20), t.yd(2, 19), 'Terbalik', null, null, 10, 'k5', null)$q$, 'tanggal transaksi setelah SP2D ditolak');
select t.throws($q$select public.import_realization_row(t.id('ibt1'), t.id('ia'), t.yd(2, 20), t.yd(2, 21), 'Salah ekspektasi', null, null, 10, 'k6', t.id('ip'))$q$, 'versi yang diharapkan tidak sama dengan versi hasil tanggal ditolak');
select t.throws($q$select public.import_realization_row(t.id('ibt1'), t.id('ic'), t.yd(2, 20), t.yd(2, 21), 'Butir baru sebelum ada', null, null, 10, 'k7', null)$q$, 'butir yang baru ada di Pergeseran tidak dapat dicatat pada tanggal Murni');
select t.lives($q$insert into t.ids select 'ir8', public.import_realization_row(t.id('ibt1'), t.id('ic'), t.yd(6, 20), t.yd(6, 21), 'Butir baru setelah ada', null, null, 10, 'k8', null)$q$, 'butir Pergeseran dapat dicatat pada tanggal Pergeseran');
select t.throws($q$select public.import_realization_row(t.id('ibt1'), t.id('ia'), t.yd(11, 20), t.yd(11, 21), 'Tahapan Perubahan masih draf', null, null, 10, 'k9', null)$q$, 'tanggal berlaku Perubahan (versi draf) ditolak');
select t.throws($q$select public.import_realization_row(t.id('ibt1'), t.id('ia'), t.yd(2, 20), t.yd(2, 21), 'Kunci kosong', null, null, 10, '  ', null)$q$, 'kunci impor kosong ditolak');
select t.throws($q$select public.import_realization_row(t.id('ibt1'), t.id('ia'), null::date, null::date, null, null, null, 10, 'k10', null)$q$, 'tanggal transaksi kosong ditolak');

-- dasar SP2D: baris melintasi 16 Mar
select t.lives(format($q$insert into t.ids select 'ibt2', public.start_realization_import((select fiscal_year_id from public.budget_versions where id = t.id('im')), 'sp2d.csv', repeat('b', 64), 1, 1, 'sp2d')$q$), 'batch dasar SP2D');
select t.lives($q$insert into t.ids select 'ir11', public.import_realization_row(t.id('ibt2'), t.id('ia'), t.yd(3, 10), t.yd(3, 20), 'Melintasi tahapan', null, null, 1000, 'k11', null)$q$, 'baris melintasi diterima');
select t.ok((select budget_version_id from public.realization_transactions where id = t.id('ir11')) = t.id('ip'), 'dasar SP2D: SP2D 20 Mar -> Pergeseran');
select t.lives($q$insert into t.ids select 'ir12', public.import_realization_row(t.id('ibt1'), t.id('ia'), t.yd(3, 10), t.yd(3, 20), 'Melintasi tahapan (dasar transaksi)', null, null, 1000, 'k12', null)$q$, 'baris yang sama pada batch dasar transaksi');
select t.ok((select budget_version_id from public.realization_transactions where id = t.id('ir12')) = t.id('im'), 'dasar transaksi: tanggal transaksi 10 Mar -> Murni');

-- hak akses
select t.as_user(:'pptk1');
select t.lives(format($q$insert into t.ids select 'ibt3', public.start_realization_import((select fiscal_year_id from public.budget_versions where id = t.id('im')), 'pptk1.csv', repeat('c', 64), 1, 1, 'transaksi')$q$), 'PPTK membuka batch');
select t.lives($q$insert into t.ids select 'ir13', public.import_realization_row(t.id('ibt3'), t.id('ia'), t.yd(2, 25), t.yd(2, 26), 'PPTK1 butirnya', null, null, 1000, 'k13', null)$q$, 'PPTK1 impor butirnya sendiri');
select t.throws($q$select public.import_realization_row(t.id('ibt3'), t.id('ib'), t.yd(2, 25), t.yd(2, 26), 'Butir PPTK2', null, null, 1000, 'k14', null)$q$, 'PPTK1 tidak dapat impor butir PPTK2');
select t.denied($q$insert into public.realization_import_batches (organization_id, fiscal_year_id, file_name, file_sha256, rows_in_file, total_in_file) select organization_id, fiscal_year_id, 'x', 'y', 1, 1 from public.budget_versions limit 1$q$, 'batch tidak dapat dibuat langsung (hanya lewat fungsi)');
select t.as_user(:'ppbj');
select t.throws($q$select public.start_realization_import((select fiscal_year_id from public.budget_versions where id = t.id('im')), 'x.csv', 'x', 1, 1, 'transaksi')$q$, 'PPBJ tidak dapat membuka batch');
select t.as_user(:'ppk');
select t.throws($q$select public.import_realization_row(t.id('ibt1'), t.id('ia'), t.yd(2, 25), t.yd(2, 26), 'PPK', null, null, 1000, 'k15', null)$q$, 'PPK tidak dapat impor');

-- jejak
select t.as_user(:'admin');
select t.ok((select count(*) from public.realization_import_batches where file_name = 'uji.csv') = 1, 'Admin melihat batch');
select t.as_super();
select t.ok((select count(*) from public.audit_logs where table_name = 'realization_import_batches' and action = 'INSERT') >= 3, 'pembuatan batch tercatat di audit');
select t.ok((select count(*) from public.realization_transactions where import_batch_id = t.id('ibt1')) = 5, 'batch b1 memuat 5 transaksi (k1,k2,k3,k8,k12)');
