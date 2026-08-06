ИСПРАВЛЕНИЕ СОСТОЯНИЙ TELEGRAM-ОТЧЁТА

Точная причина ошибки:
таблица homework_progress разрешает только три согласованных состояния:

1) draft + not_sent + report_sent_at = NULL
2) submitted_pending_report + pending/failed + report_sent_at = NULL
3) submitted + sent + report_sent_at IS NOT NULL

Старая версия сайта записывала submitted + not_sent, поэтому база отклоняла строку.
Старая Edge Function также ожидала submitted ещё до отправки и не переводила запись в sent.

ЧТО ЗАМЕНИТЬ В GITHUB

В корне сайта заменить:
- app.js
- telegram-report-test.html
- index.html
- homework.html
- lesson.html
- vocabulary-hub.html
- vocabulary.html
- grammar.html
- grammar-topic.html

С сохранением пути заменить:
- supabase/functions/notify-telegram/index.ts

ВАЖНО: после Commit Edge Function сама не обновится.
Откройте GitHub -> Actions -> "1 - Setup Telegram notifications" -> Run workflow.
Дождитесь зелёного завершения шага Deploy notification function.

После публикации сайта откройте:
telegram-report-test.html?build=8

Ожидаемый переход:
submitted_pending_report / pending
-> Telegram
-> submitted / sent / report_sent_at заполнено.

SQL-ограничения удалять или менять не нужно.
config.js менять не нужно.
