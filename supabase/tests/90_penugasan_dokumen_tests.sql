-- =====================================================================
-- 90_penugasan_dokumen_tests.sql — migrasi 0018 (daftar penugasan PPK/PPBJ & set_document_assignees).
-- Dijalankan SETELAH 30_workflow_tests.sql (memakai t.ids / butir 'wi' dan pengguna seed-nya).
-- =====================================================================
\set ON_ERROR_STOP on
reset role;
delete from t.results;

\set ppk    '22222222-2222-2222-2222-222222222222'
\set pptk1  '33333333-3333-3333-3333-333333333333'
\set pptk2  '44444444-4444-4444-4444-444444444444'
\set ppbj   '55555555-5555-5555-5555-555555555555'
\set outsider '66666666-6666-6666-6666-666666666666'

select t.as_user(:'pptk1');
select t.ok(exists (select 1 from public.assignable_users('ppk') where id = :'ppk'), 'PPTK dapat melihat daftar PPK');
select t.ok(exists (select 1 from public.assignable_users('ppbj') where id = :'ppbj'), 'PPTK dapat melihat daftar PPBJ');
select t.ok((select count(*) from public.assignable_users('pptk')) = 0, 'peran selain ppk/ppbj tidak dapat didaftar');

select t.as_user(:'ppbj');
select t.ok((select count(*) from public.assignable_users('ppk')) = 0, 'PPBJ (bukan penyusun) tidak mendapat daftar');
select t.as_user(:'outsider');
select t.ok((select count(*) from public.assignable_users('ppk')) = 0, 'pengguna organisasi lain tidak mendapat daftar');

select t.as_user(:'pptk1');
select t.lives($q$insert into t.ids select 'd90', public.create_document('dpp', t.id('wi'), 'DPP tanpa penugasan', null, null, '{}'::jsonb)$q$, 'draf tanpa penugasan dibuat');
select t.lives(format($q$select public.set_document_assignees(t.id('d90'), %L, %L)$q$, :'ppk', :'ppbj'), 'penyusun menetapkan PPK & PPBJ');
select t.ok((select assigned_ppbj_id from public.procurement_documents where id = t.id('d90')) = :'ppbj'::uuid, 'PPBJ tersimpan');
select t.throws(format($q$select public.set_document_assignees(t.id('d90'), %L, %L)$q$, :'ppbj', :'ppbj'), 'PPK harus berperan ppk');
select t.throws(format($q$select public.set_document_assignees(t.id('d90'), %L, %L)$q$, :'ppk', :'ppk'), 'PPBJ harus berperan ppbj');

select t.as_user(:'pptk2');
select t.throws(format($q$select public.set_document_assignees(t.id('d90'), %L, %L)$q$, :'ppk', :'ppbj'), 'bukan penyusun tidak dapat mengubah penugasan');

select t.as_user(:'pptk1');
select t.lives($q$select public.submit_document(t.id('d90'))$q$, 'dokumen diajukan');
select t.throws(format($q$select public.set_document_assignees(t.id('d90'), %L, %L)$q$, :'ppk', :'ppbj'), 'penugasan tidak dapat diubah setelah diajukan');

reset role;
select case when passed then 'PASS' else 'FAIL' end as hasil, name, case when passed then '' else coalesce(detail,'') end as detail
from t.results order by n;
do $$ begin
  if exists (select 1 from t.results where not passed) then
    raise exception 'Ada tes penugasan dokumen yang gagal';
  end if;
end $$;
