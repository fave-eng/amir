# Amir’s English Space

Персональный статический сайт ученика на HTML, CSS и vanilla JavaScript. Проект подготовлен для:

- ученик: **Амир / Amir**;
- `STUDENT_ID`: **amir**;
- текущий уровень: **A1**;
- учебник: **English File, Pre-Intermediate A2**;
- начальные материалы: **empty** — опубликованных уроков, слов и грамматических тем нет.

Сайт сразу открывается без регистрации и работает на GitHub Pages или любом обычном статическом хостинге.

## Структура

```text
student-english-space/
├── index.html
├── homework.html
├── lesson.html
├── grammar.html
├── grammar-topic.html
├── vocabulary-hub.html
├── vocabulary.html
├── telegram-report-test.html
├── config.js
├── config.example.js
├── app.js
├── styles.css
├── data/
│   ├── lessons/lesson-template.json
│   ├── vocabulary-data.js
│   └── grammar-data.js
├── audio/
├── images/
├── templates/
├── scripts/prepare-notification.mjs
├── supabase/
└── .github/workflows/
```

`data/lessons/index.json` и сборщик индекса не используются. `app.js` ищет `lesson-1.json`, `lesson-2.json` и далее до номера 200 и останавливается после трёх подряд отсутствующих файлов.

## Персональные настройки

Все настройки находятся в `config.js`, в одном объекте `window.APP_CONFIG`.

Меняйте только значения внутри разделов:

- `student` — имя, ID, уровень и учебник;
- `interface` — язык, доля русской поддержки, часовой пояс преподавателя;
- `site.baseUrl` — публичный URL без завершающего `/`;
- `supabase` — URL проекта и public anon key;
- `features` — включение отдельных модулей.

`config.example.js` содержит безопасный шаблон с пустыми внешними параметрами.

## Почему нет авторизации

По техническому заданию Supabase Auth не используется. На сайте нет email, пароля, регистрации, сессии и `auth.users`.

Это означает, что сайт **не может криптографически подтвердить личность ученика**. RLS ограничивает публичную роль строками с фиксированным `student_id = 'amir'`, но человек, получивший URL сайта и public anon key, технически действует как тот же публичный клиент. Передавайте ссылку только ученику и не храните в клиентской части чувствительные данные.

Public anon key предназначен для браузера и не является service-role секретом. Безопасность данных определяется RLS, ограничениями таблиц и серверной Edge Function.

## Настройка Supabase

1. Откройте Supabase Dashboard → **SQL Editor**.
2. Выполните целиком `supabase/schema.sql`.
3. До первого использования сайта выполните `supabase/verify.sql`.
4. Добавьте реальный Telegram chat ID отдельным приватным SQL-запросом на основе `supabase/seed-telegram-recipient.example.sql`.
5. Не коммитьте заполненный SQL с реальным chat ID.

Схема создаёт семь таблиц:

1. `homework_progress`;
2. `vocabulary_progress`;
3. `vocabulary_topic_progress`;
4. `grammar_progress`;
5. `telegram_recipients`;
6. `material_publications`;
7. `homework_reports`.

Первые четыре таблицы доступны браузеру только для `student_id = 'amir'`. Последние три доступны только `service_role`.

`verify.sql` рассчитан на новый курс и проверяет, что прогресс Амира ещё пуст. После начала обучения эту конкретную проверку пустоты ожидаемо выполнять не следует без адаптации.

## Одноразовая отправка домашней работы

До отправки ответы сохраняются локально, затем синхронизируются с Supabase. Кнопка **Check answers** проверяет автоматически оцениваемые поля. После изменения ответа его прежняя подсветка сбрасывается, и работу нужно проверить снова.

При **Submit to teacher** сайт:

1. повторно собирает ответы;
2. пересчитывает результат;
3. создаёт `submission_id` UUID;
4. записывает статус `submitted_pending_report` в Supabase;
5. блокирует интерфейс только после успешного ответа базы;
6. вызывает Edge Function;
7. завершает работу при любом проценте.

После финальной отправки триггер базы запрещает роли `anon` менять ответы, баллы, ученика, урок, UUID и даты отправки. Очистка `localStorage` не разблокирует работу: финальный статус снова загружается из Supabase.

Если Telegram недоступен, работа остаётся завершённой и заблокированной. На странице остаётся только **Retry report delivery**.

## Edge Function и Telegram

Функция находится в `supabase/functions/notify-telegram/index.ts` и принимает явные действия:

- `health` — безопасная диагностика без отправки сообщения;
- `homework_report` — отчёт по уже существующей финальной работе;
- `material_published` — уведомление о новом комплекте материалов.

Для `homework_report` браузер передаёт только идентификаторы. Баллы, ответы и имя функция читает из `homework_progress` через service role.

Для `material_published` обязателен заголовок `x-notify-secret`. Значение сравнивается с `NOTIFY_WEBHOOK_SECRET` без раннего выхода по символам.

Секреты Edge Function:

- `TELEGRAM_BOT_TOKEN`;
- `NOTIFY_WEBHOOK_SECRET`;
- `SITE_BASE_URL` — рекомендуется для безопасной кнопки открытия сайта;
- `TEACHER_TIME_ZONE` — например `Europe/Riga`.

Service role предоставляется средой Supabase и не размещается в репозитории. Telegram Bot API из браузера не вызывается.

## GitHub Actions

### `setup-telegram.yml`

Ручной workflow проверяет настройки, сохраняет Supabase Secrets и разворачивает функцию.

GitHub Secrets:

- `SUPABASE_ACCESS_TOKEN`;
- `TELEGRAM_BOT_TOKEN`;
- `NOTIFY_WEBHOOK_SECRET`.

GitHub Variables:

- `SUPABASE_PROJECT_REF`;
- `SITE_BASE_URL`;
- `TEACHER_TIME_ZONE`.

### `notify-new-materials.yml`

Запускается при изменениях уроков, словаря или грамматики и вручную. Пустой `lesson_id` — нормальный режим: скрипт просматривает все `lesson-N.json`.

Дополнительно настройте:

- variable `SUPABASE_URL`;
- variable `SITE_BASE_URL`;
- secret `SUPABASE_ANON_KEY`;
- secret `NOTIFY_WEBHOOK_SECRET`.

Скрипт пропускает `draft`, `locked`, будущие публикации и уроки с `notification.enabled !== true`. Повторные уведомления блокируются уникальной записью в `material_publications`.

## Добавление урока

1. Скопируйте `data/lessons/lesson-template.json` в `lesson-N.json`.
2. Поставьте реальный `id` вида `lesson-N`.
3. Добавьте подтверждённые учебные блоки.
4. Укажите `status: "draft"` во время подготовки.
5. Программно пересчитайте автоматически оцениваемые единицы и выставьте точный `totalPoints`.
6. Для публикации поставьте `status: "available"`, дату `publishedAt`, `notification.enabled: true`.
7. При существенном обновлении увеличьте `notification.version`.

Номер домашней работы всегда берётся из имени файла, а не из поля `number`.

Поддерживаются секции, info/tip, reading, exercise, dialogue, text, translate, textarea, single, multiple, select, match, reorder и audio. Внутри exercise поддерживаются text, textarea, single, multiple, select, gaps, example-gap, odd-one-out, примеры, display-only строки и изображения.

## Словарь

Добавьте тему в `data/vocabulary-data.js` по образцу `templates/vocabulary-example.js`.

Связь с уроком задаётся через:

- `lesson.vocabularyId`; или
- `topic.linkedLessonId`.

Слова нормализуются через Unicode NFKC, lowercase, апострофы, пробелы и внешнюю пунктуацию. Дубликат не показывается и не создаёт вторую строку прогресса.

Кнопка **Reviewed** только перелистывает карточку. Статус `known` появляется после правильного ответа в завершённом тесте. Результаты всего теста применяются серверной функцией `apply_vocabulary_test` одной транзакцией.

Произношение использует Web Speech API, `en-GB`, скорость `0.85`. Для слов MP3 не нужны.

## Грамматика

Добавьте тему в `data/grammar-data.js` по образцу `templates/grammar-example.js`.

Связь с уроком задаётся через `lesson.grammarIds` и/или `topic.linkedLessonId`. Полноценная тема может содержать обзор, формулу, карту правил, таблицы, примеры, типичные ошибки и любое число упражнений.

По умолчанию тема считается пройденной при 100%. При `lockOnPass: true` ответы блокируются после успешного прохождения.

## Аудио и изображения

- MP3 для уроков помещайте в `audio/` и указывайте относительный путь.
- Изображения помещайте в `images/lesson-N/`.
- Для каждого изображения задавайте содержательный `alt`.
- Одно или несколько изображений можно подключить на уровне exercise или отдельного item.

Отсутствующий файл не должен мешать рендерингу остальных блоков, но проверка перед публикацией должна выявить неверный путь.

## Диагностическая страница

Откройте `telegram-report-test.html` после выполнения SQL и развёртывания функции.

Страница:

- не входит в основную навигацию;
- не показывает anon key, chat ID или токены;
- проверяет четыре публичные таблицы;
- подтверждает закрытость серверного журнала;
- вызывает безопасный `action: "health"`;
- при ручном вводе существующих `lessonId` и `submissionId` может повторить доставку уже отправленной работы.

После настройки удалите диагностическую страницу с публичного сайта.

## GitHub Pages

1. Отправьте содержимое папки в репозиторий без `.git` из исходного референса.
2. В Settings → Pages выберите публикацию из нужной ветки и корня проекта.
3. Запишите полученный URL в `config.js → site.baseUrl` и GitHub Variable `SITE_BASE_URL`.
4. Повторно разверните Edge Function, чтобы обновить разрешённый origin кнопок Telegram.

Для очистки кэша измените параметр версии у `styles.css?v=10` и `app.js?v=10` либо выполните жёсткое обновление браузера.

## Какие данные находятся в Supabase

Хранятся:

- черновые и финальные ответы домашней работы;
- баллы и даты;
- статусы слов и история тестов;
- прогресс грамматики;
- серверная настройка Telegram-получателя;
- журналы уведомлений и отчётов.

Не хранятся:

- пароль или email;
- Supabase Auth user;
- учебные JSON, изображения и MP3;
- Telegram bot token;
- GitHub secrets;
- service-role key в клиентском коде.

## Проверки

Результаты статических проверок находятся в `QUALITY_REPORT.md`. Реальная доставка Telegram и применение SQL к удалённому проекту требуют доступа владельца Supabase и Telegram и не заявляются как выполненные локально.
