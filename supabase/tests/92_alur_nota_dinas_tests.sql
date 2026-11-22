-- =====================================================================
-- 92_alur_nota_dinas_tests.sql — migrasi 0022. Dijalankan SETELAH 91. Memakai butir 'wi' dan pengguna seed tes 30/90.
-- Alur: Nota Dinas PPTK -> PPK (diterima) -> DPP (PPK menyusun, PPTK ikut) -> Nota Dinas PPK -> PPBJ.
-- =====================================================================
\set ON_ERROR_STOP on
reset role;
delete from t.results;

\set ppk    '22222222-2222-2222-2222-222222222222'
\set pptk1  '33333333-3333-3333-3333-333333333333'
\set pptk2  '44444444-4444-4444-4444-444444444444'
\set ppbj   '55555555-5555-5555-5555-555555555555'

-- 1) PPTK menyusun Nota Dinas kepada PPK dan mengajukannya
select t.as_user(:'pptk1');
select t.lives(format($q$insert into t.ids select 'n92', public.create_document('nota_dinas_pptk', t.id('wi'), 'Nota PPTK', %L, null, '{}'::jsonb)$q$, :'ppk'), 'PPTK membuat Nota Dinas kepada PPK');
select t.lives($q$select public.submit_document(t.id('n92'))$q$, 'PPTK mengajukan Nota Dinas ke PPK');
select t.as_user(:'pptk2');
select t.throws($q$select public.accept_document(t.id('n92'))$q$, 'PPTK lain tidak dapat menerima');
select t.as_user(:'ppbj');
select t.throws($q$select public.accept_document(t.id('n92'))$q$, 'PPBJ tidak dapat menerima Nota Dinas PPTK');
select t.as_user(:'ppk');
select t.lives($q$select public.accept_document(t.id('n92'))$q$, 'PPK menerima Nota Dinas PPTK');
select t.ok((select status from public.procurement_documents where id = t.id('n92')) = 'issued', 'status Nota Dinas = diterima');

-- 2) PPK menyusun DPP (butir sama) dan menautkannya ke Nota Dinas; PPTK butir tsb ikut menyusun
select t.lives(format($q$insert into t.ids select 'p92', public.create_document('dpp', t.id('wi'), 'DPP PPK', %L, %L, '{}'::jsonb)$q$, :'ppk', :'ppbj'), 'PPK menyusun DPP');
select t.lives($q$select public.set_document_source(t.id('p92'), t.id('n92'))$q$, 'DPP ditautkan ke Nota Dinas PPTK');
select t.lives($q$select public.save_shared_revision(t.id('p92'), 'DPP PPK', '{"perihal":"x"}'::jsonb, 'PPK', 0)$q$, 'PPK menyimpan revisi 1');
select t.as_user(:'pptk1');
select t.ok(exists (select 1 from public.procurement_documents where id = t.id('p92')), 'PPTK butir melihat DPP');
select t.lives($q$select public.save_shared_revision(t.id('p92'), null, '{"perihal":"x","spek_mutu":"PPTK"}'::jsonb, 'PPTK melengkapi', 1)$q$, 'PPTK ikut menyusun DPP (revisi 2)');
select t.as_user(:'pptk2');
select t.ok(not exists (select 1 from public.procurement_documents where id = t.id('p92')), 'PPTK butir lain tidak melihat DPP');

-- 3) Nota Dinas PPK kepada PPBJ dan pengajuan DPP; reviu hanya DPP
select t.as_user(:'ppk');
select t.lives(format($q$insert into t.ids select 'k92', public.create_document('nota_dinas_ppk', t.id('wi'), 'Nota PPK', %L, %L, '{}'::jsonb)$q$, :'ppk', :'ppbj'), 'PPK membuat Nota Dinas kepada PPBJ');
select t.lives($q$select public.set_document_source(t.id('k92'), t.id('p92'))$q$, 'Nota Dinas PPK ditautkan ke DPP');
select t.throws($q$select public.set_document_source(t.id('p92'), t.id('k92'))$q$, 'tautan tidak sesuai alur ditolak');
select t.lives($q$select public.submit_document(t.id('k92'))$q$, 'PPK mengajukan Nota Dinas ke PPBJ');
select t.lives($q$select public.submit_document(t.id('p92'))$q$, 'PPK mengajukan DPP ke PPBJ');
select t.as_user(:'ppbj');
select t.throws($q$select public.start_review(t.id('k92'))$q$, 'reviu tidak berlaku untuk Nota Dinas');
select t.lives($q$select public.accept_document(t.id('k92'))$q$, 'PPBJ menerima Nota Dinas PPK');
select t.lives($q$select public.start_review(t.id('p92'))$q$, 'PPBJ mereviu DPP');
select t.as_user(:'ppk');
select t.throws($q$select public.accept_document(t.id('p92'))$q$, 'DPP tidak diterima dengan accept_document');

reset role;
select case when passed then 'PASS' else 'FAIL' end as hasil, name, case when passed then '' else coalesce(detail,'') end as detail
from t.results order by n;
do $$ begin
  if exists (select 1 from t.results where not passed) then raise exception 'Ada tes alur nota dinas yang gagal'; end if;
end $$;
