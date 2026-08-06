insert into public.telegram_recipients (student_id, chat_id, message_thread_id, enabled)
values ('[STUDENT_ID]', [TEACHER_CHAT_ID], null, true)
on conflict (student_id) do update
set chat_id = excluded.chat_id,
    message_thread_id = excluded.message_thread_id,
    enabled = excluded.enabled,
    updated_at = now();
