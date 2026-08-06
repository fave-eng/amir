-- Idempotent table for Telegram homework-report delivery logs.
-- Run once in Supabase Dashboard -> SQL Editor if homework_reports does not exist.

create extension if not exists pgcrypto;

create table if not exists public.homework_reports (
  id uuid primary key default gen_random_uuid(),
  student_id text not null,
  lesson_id text not null,
  submission_key text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'skipped')),
  score_correct integer,
  score_total integer,
  score_percent integer,
  payload jsonb not null default '{}'::jsonb,
  telegram_message_id bigint,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, lesson_id, submission_key)
);

create index if not exists homework_reports_student_idx
  on public.homework_reports (student_id, created_at desc);

create or replace function public.set_homework_reports_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists homework_reports_set_updated_at on public.homework_reports;
create trigger homework_reports_set_updated_at
before update on public.homework_reports
for each row execute function public.set_homework_reports_updated_at();

alter table public.homework_reports enable row level security;
revoke all on table public.homework_reports from anon, authenticated;
grant all on table public.homework_reports to service_role;
