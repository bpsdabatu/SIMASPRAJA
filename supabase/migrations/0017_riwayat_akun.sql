-- =====================================================================
-- 0017_riwayat_akun.sql
-- Tambahan (additive; tidak mengubah/menghapus data yang ada):
--  account_history: riwayat siklus hidup akun (dibuat, kata sandi diatur ulang/diganti, ditangguhkan/diaktifkan, peran diubah, dipulihkan)
--  agar ADMIN dapat menelusuri kapan dan oleh siapa akun dibuat/di-reset (membantu pengguna yang lupa kata sandi) secara akuntabel.
--  - Append-only (tidak dapat diubah/dihapus), tanpa FK ke profiles sehingga riwayat tetap ada walau akun dihapus.
--  - RLS aktif tanpa kebijakan + hak akses dicabut: hanya service role (server aplikasi) yang dapat membaca/menulis.
--  - Tidak menyimpan kata sandi apa pun (kata sandi sementara tetap hanya di account_temp_credentials, terenkripsi).
--  - Backfill: satu baris "DIBUAT" per akun yang ada (dari profiles.created_at) dan reset lama dari audit_logs. Idempotent.
-- =====================================================================
create table if not exists public.account_history (
  id              bigint generated always as identity primary key,
  organization_id uuid,
  profile_id      uuid not null,
  username        text not null,
  full_name       text,
  event           text not null check (event in ('DIBUAT','SANDI_DIRESET','SANDI_DIGANTI','DITANGGUHKAN','DIAKTIFKAN','PERAN_DIUBAH','DIPULIHKAN')),
  actor_id        uuid,
  actor_username  text,
  detail          jsonb,
  occurred_at     timestamptz not null default now()
);
create index if not exists account_history_profile_idx on public.account_history (profile_id, occurred_at desc);
create index if not exists account_history_time_idx    on public.account_history (occurred_at desc);

drop trigger if exists trg_account_history_immutable on public.account_history;
create trigger trg_account_history_immutable before update or delete on public.account_history
  for each row execute function app.block_modification();
drop trigger if exists trg_account_history_no_truncate on public.account_history;
create trigger trg_account_history_no_truncate before truncate on public.account_history
  for each statement execute function app.block_modification();

alter table public.account_history enable row level security;
revoke all on public.account_history from public, anon, authenticated;

-- Backfill 1: kejadian "DIBUAT" untuk akun yang belum punya riwayat.
insert into public.account_history (organization_id, profile_id, username, full_name, event, actor_id, actor_username, detail, occurred_at)
select p.organization_id, p.id, p.username, p.full_name, 'DIBUAT',
       a.actor_id, ap.username, jsonb_build_object('sumber', 'backfill'), p.created_at
from public.profiles p
left join lateral (
  select l.actor_id from public.audit_logs l
  where l.action = 'USER_CREATED' and l.record_id = p.id::text
  order by l.occurred_at limit 1
) a on true
left join public.profiles ap on ap.id = a.actor_id
where not exists (select 1 from public.account_history h where h.profile_id = p.id and h.event = 'DIBUAT');

-- Backfill 2: reset kata sandi lama yang tercatat di audit_logs.
insert into public.account_history (organization_id, profile_id, username, full_name, event, actor_id, actor_username, detail, occurred_at)
select p.organization_id, p.id, p.username, p.full_name, 'SANDI_DIRESET', l.actor_id, ap.username,
       jsonb_build_object('sumber', 'backfill'), l.occurred_at
from public.audit_logs l
join public.profiles p on p.id::text = l.record_id
left join public.profiles ap on ap.id = l.actor_id
where l.action = 'USER_PASSWORD_RESET'
  and not exists (select 1 from public.account_history h
                  where h.profile_id = p.id and h.event = 'SANDI_DIRESET' and h.occurred_at = l.occurred_at);
