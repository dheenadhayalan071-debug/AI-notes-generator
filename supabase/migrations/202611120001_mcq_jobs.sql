create extension if not exists pgcrypto;

create table if not exists public.mcq_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  unit_id text not null,
  idempotency_key text not null unique,
  subject text not null,
  unit_number integer not null,
  unit_title text not null,
  payload jsonb not null,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED')),
  mcqs jsonb not null default '[]'::jsonb,
  error_message text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mcq_generation_jobs_unit_created_idx
  on public.mcq_generation_jobs (unit_id, created_at desc);

create index if not exists mcq_generation_jobs_status_updated_idx
  on public.mcq_generation_jobs (status, updated_at);

create unique index if not exists mcq_generation_jobs_one_active_per_unit_idx
  on public.mcq_generation_jobs (unit_id)
  where status in ('PENDING', 'PROCESSING');

alter table public.mcq_generation_jobs enable row level security;

-- No client-facing policies are created. Only the server-side service role
-- should read or write this table.

create or replace function public.claim_mcq_generation_job(
  p_job_id uuid,
  p_concurrency_limit integer default 3
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_status text;
  running_count integer;
begin
  -- Serialize claims so simultaneous workers cannot exceed the limit.
  perform pg_advisory_xact_lock(hashtext('mcq_generation_jobs_claim'));

  -- Recover work whose serverless invocation died and whose lease expired.
  update public.mcq_generation_jobs
     set status = 'PENDING',
         error_message = coalesce(error_message, 'Worker lease expired; retrying job.'),
         updated_at = now()
   where status = 'PROCESSING'
     and updated_at < now() - interval '10 minutes';

  select status
    into current_status
    from public.mcq_generation_jobs
   where id = p_job_id
   for update;

  if current_status is distinct from 'PENDING' then
    return false;
  end if;

  select count(*)
    into running_count
    from public.mcq_generation_jobs
   where status = 'PROCESSING';

  if running_count >= greatest(1, least(p_concurrency_limit, 10)) then
    return false;
  end if;

  update public.mcq_generation_jobs
     set status = 'PROCESSING',
         attempts = attempts + 1,
         error_message = null,
         updated_at = now()
   where id = p_job_id
     and status = 'PENDING';

  return found;
end;
$$;

revoke all on function public.claim_mcq_generation_job(uuid, integer) from public;
revoke all on function public.claim_mcq_generation_job(uuid, integer) from anon;
revoke all on function public.claim_mcq_generation_job(uuid, integer) from authenticated;
grant execute on function public.claim_mcq_generation_job(uuid, integer) to service_role;
