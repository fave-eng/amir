# Supabase для English Space

## Порядок установки

1. Выполните `schema.sql` в SQL Editor.
2. На новом пустом курсе выполните `verify.sql`.
3. Создайте получателя приватным запросом по образцу `seed-telegram-recipient.example.sql`.
4. Добавьте Edge Function secrets.
5. Разверните `notify-telegram` с отключённой JWT-проверкой.

```bash
supabase functions deploy notify-telegram --project-ref YOUR_PROJECT_REF --no-verify-jwt
```

`verify_jwt = false` нужен потому, что сайт не использует Supabase Auth. Безопасность режима публикаций обеспечивается `x-notify-secret`, а режим отчёта принимает только идентификаторы уже заблокированной записи.

## Таблицы

Публичный прогресс:

- `homework_progress` — черновик, проверка, финальная блокировка и статус отчёта;
- `vocabulary_progress` — один нормализованный ключ слова на ученика;
- `vocabulary_topic_progress` — история завершённых тестов;
- `grammar_progress` — попытки, лучший балл и прохождение.

Серверные таблицы:

- `telegram_recipients`;
- `material_publications`;
- `homework_reports`.

У серверных таблиц нет public RLS policies; права `anon` и `authenticated` отозваны.

## RLS

Политики браузера жёстко ограничены выражением:

```sql
student_id = 'amir'
```

`homework_progress` разрешает `SELECT`, `INSERT`, `UPDATE`, но не `DELETE`. После статуса `submitted_pending_report` или `submitted` триггер `protect_submitted_homework` запрещает публичной роли менять содержательные поля.

Словарь и грамматика разрешают удаление собственных строк, что нужно для сброса учебного прогресса, но не даёт доступа к другому `student_id`.

## Атомарный словарный тест

Функция PostgreSQL `apply_vocabulary_test` принимает JSON-объект результатов и один объект истории теста. Изменения статусов слов и добавление истории выполняются в одной транзакции базы.

## Telegram recipient

Никогда не помещайте реальный chat ID в репозиторий. Создайте локальную копию примера или выполните запрос непосредственно в Dashboard.

`message_thread_id` используется для Telegram forum topic и может быть `null`.

## Edge Function secrets

```bash
supabase secrets set \
  TELEGRAM_BOT_TOKEN='...' \
  NOTIFY_WEBHOOK_SECRET='...' \
  SITE_BASE_URL='https://example.github.io/project' \
  TEACHER_TIME_ZONE='Europe/Riga' \
  --project-ref YOUR_PROJECT_REF
```

`SITE_BASE_URL` ограничивает URL кнопки Telegram тем же HTTPS origin. Если переменная не задана или URL не совпадает, кнопка не добавляется.

## Идемпотентность

- `homework_reports` уникален по `(student_id, lesson_id, submission_id)`;
- `material_publications` уникален по `(student_id, material_type, material_id, notification_version)`.

Повторный вызов уже отправленного события возвращает успешный ответ с `duplicate: true`, но не отправляет новое сообщение.

## Диагностика

Публичный `action: "health"` не возвращает секреты и проверяет наличие семи таблиц, активного получателя и bot token. Он предназначен для `telegram-report-test.html`.

Реальная отправка отчёта выполняется только для строки с точным совпадением `student_id`, `lesson_id`, `submission_id` и финальным статусом.
