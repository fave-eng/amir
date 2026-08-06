# Загрузка Homework 1 в GitHub

1. Загрузите содержимое архива в корень репозитория, сохраняя структуру папок.
2. Подтвердите замену `app.js`, `styles.css`, HTML-страниц и файлов в `data/`.
3. Добавьте аудио с точным путём:
   `audio/English_File_4e_Pre-intermediate_WB_1.2.mp3`
4. Сделайте commit в ветку `main`.
5. Workflow **2 - Notify about new materials** увидит `data/lessons/lesson-1.json` и отправит bundle новой домашней работы, если Telegram уже настроен и версия уведомления ещё не отправлялась.
6. При повторной публикации изменённого урока увеличьте `notification.version` в `lesson-1.json`.

После публикации откройте:

- `homework.html` — новая карточка домашней работы;
- `lesson.html?id=lesson-1` — урок;
- `vocabulary.html?id=vocab-lesson-1` — словарь;
- `grammar-topic.html?id=present-simple` — грамматическая тема.
