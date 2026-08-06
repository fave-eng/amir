-- Amir uses the shared progress tables with student_id = 'amir'.
-- No separate student/profile row is required by this website.
-- Progress rows will be created automatically when Amir checks or submits work.

select
  'amir'::text as student_id,
  to_regclass('public.homework_progress') as homework_progress,
  to_regclass('public.vocabulary_progress') as vocabulary_progress,
  to_regclass('public.vocabulary_topic_progress') as vocabulary_topic_progress,
  to_regclass('public.grammar_progress') as grammar_progress;

-- Optional Telegram recipient: uncomment after replacing YOUR_CHAT_ID.
-- insert into public.telegram_recipients (student_id, chat_id, enabled)
-- values ('amir', YOUR_CHAT_ID, true)
-- on conflict (student_id) do update
-- set chat_id = excluded.chat_id, enabled = true, updated_at = now();
