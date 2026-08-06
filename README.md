# English Space — Амир

Готовая персональная копия учебного сайта. Начальные материалы пустые.

## Профиль

- Имя: Амир / Amir
- `student_id`: `amir`
- Текущий уровень: A1
- Учебник: English File, Pre-Intermediate A2
- Интерфейс: русский + английский, основная поддержка на русском
- Базовый URL: пока не задан

## Supabase

Сайт уже подключён к общему проекту Supabase из `config.js`. Все запросы прогресса используют `student_id = amir`, поэтому данные Амира отделены от данных других учеников. Отдельная запись ученика не нужна: строки в таблицах прогресса появятся автоматически после первой активности.

Для проверки таблиц можно выполнить `supabase/register-amir.sql` в SQL Editor. Этот файл не создаёт фиктивный прогресс.

Публичный anon key предназначен для клиентского сайта. Service role key в проект не добавлен. Работа записи зависит от действующих RLS-политик общего Supabase.

## Добавление материалов

- Домашняя работа: `data/lessons/lesson-N.json`
- Слова: `data/vocabulary-data.js`
- Грамматика: `data/grammar-data.js`
- Примеры структур: папка `templates/`
- Аудио: папка `audio/`
- Изображения: папка `images/`

Нумерацию домашних работ начинайте с `lesson-1.json` и продолжайте без больших пропусков.

## Telegram

Telegram-отчёты сохранены в проекте, но для Амира нужен `chat_id` в таблице `telegram_recipients`. Шаблон запроса находится в `supabase/register-amir.sql`. Если таблица `homework_reports` отсутствует, выполните `supabase/homework-reports.sql`.

Для GitHub Actions задайте переменные `STUDENT_ID=amir`, `SUPABASE_PROJECT_ID=zqzgarvmpqqqaobeicpc` и позже `SITE_BASE_URL`.
