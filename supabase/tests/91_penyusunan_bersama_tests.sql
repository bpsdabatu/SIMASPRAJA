-- =====================================================================
-- 91_penyusunan_bersama_tests.sql — migrasi 0021 (save_shared_revision). Dijalankan SETELAH 90_penugasan_dokumen_tests.sql.
-- Memakai dokumen 'd90' (DPP milik pptk1, PPK & PPBJ sudah ditugaskan) — dibuat oleh tes 90 pada status 'submitted'; di sini dibuat DPP baru.
-- =====================================================================
\set ON_ERROR_STOP on
reset role;
delete from t.results;

\set ppk    '22222222-2222-2222-2222-222222222222'
\set pptk1  '33333333-3333-3333-3333-333333333333'
\set pptk2  '44444444-4444-4444-4444-444444444444'
\set ppbj   '55555555-5555-5555-5555-555555555555'

select t.as_user(:'pptk1');
select t.lives($q$insert into t.ids select 'd91', public.create_document('dpp', t.id('wi'), 'DPP bersama', null, null, '{}'::jsonb)$q$, 'DPP dibuat PPTK');
select t.lives(format($q$select public.set_document_assignees(t.id('d91'), %L, %L)$q$, :'ppk', :'ppbj'), 'PPK & PPBJ ditetapkan');
select t.lives($q$select public.save_shared_revision(t.id('d91'), 'DPP bersama', '{"perihal":"x"}'::jsonb, 'awal', 0)$q$, 'PPTK menyimpan revisi 1');

select t.as_user(:'ppk');
select t.lives($q$select public.save_shared_revision(t.id('d91'), 'diabaikan', '{"perihal":"x","spek_mutu":"PPK"}'::jsonb, 'PPK melengkapi', 1)$q$, 'PPK (ditugaskan) menyimpan revisi 2');
select t.ok((select count(*) from public.document_revisions where document_id = t.id('d91')) = 2, 'dua revisi tersimpan');
select t.ok((select title from public.procurement_documents where id = t.id('d91')) = 'DPP bersama', 'judul hanya diubah penyusun');
select t.throws($q$select public.save_shared_revision(t.id('d91'), null, '{}'::jsonb, 'basi', 1)$q$, 'bentrok: basis revisi usang ditolak');

select t.as_user(:'pptk2');
select t.throws($q$select public.save_shared_revision(t.id('d91'), null, '{}'::jsonb, null, null)$q$, 'PPTK lain tidak boleh mengubah');
select t.as_user(:'ppbj');
select t.throws($q$select public.save_shared_revision(t.id('d91'), null, '{}'::jsonb, null, null)$q$, 'PPBJ tidak boleh mengubah isi');

select t.as_user(:'pptk1');
select t.lives($q$select public.submit_document(t.id('d91'))$q$, 'PPTK mengajukan');
select t.as_user(:'ppk');
select t.throws($q$select public.save_shared_revision(t.id('d91'), null, '{}'::jsonb, null, 2)$q$, 'setelah diajukan tidak dapat diubah');

reset role;
select case when passed then 'PASS' else 'FAIL' end as hasil, name, case when passed then '' else coalesce(detail,'') end as detail
from t.results order by n;
do $$ begin
  if exists (select 1 from t.results where not passed) then raise exception 'Ada tes penyusunan bersama yang gagal'; end if;
end $$;
