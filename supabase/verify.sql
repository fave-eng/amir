-- English Space v10 verification. Run after schema.sql and before first student use.
begin;

do $$
declare
  expected text[] := array[
    'homework_progress','vocabulary_progress','vocabulary_topic_progress','grammar_progress',
    'telegram_recipients','material_publications','homework_reports'
  ];
  item text;
begin
  foreach item in array expected loop
    if to_regclass('public.' || item) is null then
      raise exception 'Missing table: public.%', item;
    end if;
  end loop;

  if to_regclass('public.student_progress') is not null then
    raise exception 'Forbidden legacy table public.student_progress exists';
  end if;
end;
$$;

do $$
declare
  bad_count integer;
begin
  select count(*) into bad_count
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('homework_progress','vocabulary_progress','vocabulary_topic_progress','grammar_progress','telegram_recipients','material_publications','homework_reports')
    and not c.relrowsecurity;
  if bad_count <> 0 then raise exception 'RLS is not enabled on % expected tables', bad_count; end if;

  select count(*) into bad_count
  from information_schema.columns
  where table_schema = 'public'
    and table_name in ('homework_progress','vocabulary_progress','vocabulary_topic_progress','grammar_progress','telegram_recipients','material_publications','homework_reports')
    and column_name = 'user_id';
  if bad_count <> 0 then raise exception 'Forbidden user_id column found'; end if;
end;
$$;

do $$
declare
  required text[] := array[
    'homework_progress_submission_id_key','homework_progress_student_lesson_key',
    'vocabulary_progress_student_word_key','vocabulary_topic_progress_student_topic_key',
    'grammar_progress_student_topic_key','telegram_recipients_student_id_key',
    'telegram_recipients_chat_id_key','material_publications_dedupe_key','homework_reports_dedupe_key'
  ];
  item text;
begin
  foreach item in array required loop
    if not exists (select 1 from pg_constraint where conname = item) then
      raise exception 'Missing constraint: %', item;
    end if;
  end loop;
end;
$$;

do $$
declare
  trigger_count integer;
begin
  select count(*) into trigger_count
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and not t.tgisinternal
    and t.tgname in (
      'homework_progress_set_updated_at','vocabulary_progress_set_updated_at',
      'vocabulary_topic_progress_set_updated_at','grammar_progress_set_updated_at',
      'telegram_recipients_set_updated_at','material_publications_set_updated_at',
      'homework_reports_set_updated_at','homework_progress_protect_submitted'
    );
  if trigger_count <> 8 then raise exception 'Expected 8 application triggers, found %', trigger_count; end if;
end;
$$;

do $$
begin
  if has_table_privilege('anon', 'public.homework_progress', 'DELETE') then
    raise exception 'anon must not be able to DELETE homework_progress';
  end if;
  if not has_table_privilege('anon', 'public.homework_progress', 'SELECT')
     or not has_table_privilege('anon', 'public.homework_progress', 'INSERT')
     or not has_table_privilege('anon', 'public.homework_progress', 'UPDATE') then
    raise exception 'anon homework privileges are incomplete';
  end if;
  if has_table_privilege('anon', 'public.telegram_recipients', 'SELECT')
     or has_table_privilege('anon', 'public.material_publications', 'SELECT')
     or has_table_privilege('anon', 'public.homework_reports', 'SELECT') then
    raise exception 'anon can see a server-only table';
  end if;
end;
$$;

do $$
begin
  if exists (select 1 from public.telegram_recipients where chat_id in (0, 1, -1, 123456789, -1000000000000)) then
    raise exception 'A placeholder Telegram chat ID is present';
  end if;
  if exists (select 1 from public.homework_progress where student_id = 'amir')
     or exists (select 1 from public.vocabulary_progress where student_id = 'amir')
     or exists (select 1 from public.vocabulary_topic_progress where student_id = 'amir')
     or exists (select 1 from public.grammar_progress where student_id = 'amir') then
    raise exception 'Progress is not empty for the new student amir';
  end if;
end;
$$;

-- Constraint tests are rolled back with the transaction.
do $$
begin
  begin
    insert into public.homework_progress (student_id, lesson_id, answers) values ('amir', '__verify_bad_json__', '[]'::jsonb);
    raise exception 'JSON object constraint did not reject an array';
  exception when check_violation then null;
  end;

  begin
    insert into public.homework_progress (student_id, lesson_id, answers, score_correct, score_total, score_percent)
    values ('amir', '__verify_bad_percent__', '{}'::jsonb, 1, 1, 101);
    raise exception 'Percentage constraint did not reject 101';
  exception when check_violation then null;
  end;
end;
$$;

insert into public.homework_progress (
  submission_id, student_id, student_name, lesson_id, lesson_title, status, answers,
  score_correct, score_total, score_percent, checked_at, submitted_at, locked_at, report_status
) values (
  '00000000-0000-4000-8000-000000000010', 'amir', 'Amir', '__verify_lock__', 'Verification',
  'submitted_pending_report', '{"answer":"fixed"}'::jsonb, 0, 1, 0, now(), now(), now(), 'pending'
);

do $$
declare
begin
  perform set_config('role', 'anon', true);

  begin
    update public.homework_progress
      set answers = '{"answer":"changed"}'::jsonb
      where student_id = 'amir' and lesson_id = '__verify_lock__';
    raise exception 'A submitted answer was changed by anon';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.homework_progress where student_id = 'amir' and lesson_id = '__verify_lock__';
    raise exception 'A submitted row was deleted by anon';
  exception when insufficient_privilege then null;
  end;

  perform set_config('role', 'none', true);
end;
$$;

-- The final row must still contain the original answer.
do $$
begin
  if not exists (
    select 1 from public.homework_progress
    where student_id = 'amir' and lesson_id = '__verify_lock__' and answers = '{"answer":"fixed"}'::jsonb
  ) then
    raise exception 'Immutable homework verification failed';
  end if;
end;
$$;

rollback;

select 'English Space schema verification passed' as result;
