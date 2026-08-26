(() => {
  'use strict';

  const config = window.APP_CONFIG || {};
  const student = config.student || {};
  const studentId = String(student.id || 'amir').trim().toLowerCase();
  const TEST_LESSON_ID_PREFIX = 'telegram-report-test';
  const DB_PROBE_LESSON_ID = '__diagnostic_probe__';

  const checksEl = document.getElementById('checks');
  const summaryEl = document.getElementById('main-summary');
  const rawEl = document.getElementById('raw-output');
  const configInfoEl = document.getElementById('config-info');
  const telegramInfoEl = document.getElementById('telegram-info');
  const dbWriteResultEl = document.getElementById('db-write-result');
  const sendResultEl = document.getElementById('send-result');
  const runAllBtn = document.getElementById('run-all');
  const dbWriteBtn = document.getElementById('test-db-write');
  const sendBtn = document.getElementById('send-test-report');

  let supabaseClient = null;
  let lastReport = { startedAt: null, checks: [], functionProbe: null, directRows: [], errors: [] };

  const esc = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  function addKV(target, key, value, mono = false) {
    target.insertAdjacentHTML('beforeend', `<div class="kv"><span>${esc(key)}</span><strong class="${mono ? 'mono' : ''}">${esc(value)}</strong></div>`);
  }

  function notifyFunctionName() {
    return String(config.supabase?.functions?.notifyTelegram || 'notify-telegram').trim() || 'notify-telegram';
  }

  function functionUrl() {
    const base = String(config.supabase?.url || '').replace(/\/+$/, '');
    return `${base}/functions/v1/${notifyFunctionName()}`;
  }

  function renderConfig() {
    configInfoEl.innerHTML = '';
    addKV(configInfoEl, 'student_id', studentId || '—', true);
    addKV(configInfoEl, 'Имя', student.nameRu || student.nameEn || '—');
    addKV(configInfoEl, 'Supabase URL', config.supabase?.url || 'не задан', true);
    addKV(configInfoEl, 'Anon key', config.supabase?.anonKey ? 'есть' : 'НЕТ');
    addKV(configInfoEl, 'notify function', notifyFunctionName(), true);
    addKV(configInfoEl, 'homework table', config.supabase?.tables?.homework || 'homework_progress', true);
    addKV(configInfoEl, 'cloudSync', String(config.features?.cloudSync !== false));
    addKV(configInfoEl, 'telegramNotifications', String(config.features?.telegramNotifications !== false));
    addKV(configInfoEl, 'Origin', window.location.origin, true);

    telegramInfoEl.innerHTML = '';
    addKV(telegramInfoEl, 'Endpoint', functionUrl() || '—', true);
    addKV(telegramInfoEl, 'Проверка без отправки', 'через служебный ping');
    addKV(telegramInfoEl, 'Отправка сообщения', `через ${TEST_LESSON_ID_PREFIX}-...`, true);
  }

  function resetChecks() {
    checksEl.innerHTML = '';
    lastReport = { startedAt: new Date().toISOString(), checks: [], functionProbe: null, directRows: [], errors: [] };
  }

  function addCheck(name, status, detail) {
    const icon = status === 'ok' ? '✓' : status === 'bad' ? '!' : status === 'warn' ? '!' : '…';
    checksEl.insertAdjacentHTML('beforeend', `<div class="check ${status}"><div class="ico">${icon}</div><div><div class="name">${esc(name)}</div><div class="detail">${esc(detail || '')}</div></div></div>`);
    lastReport.checks.push({ name, status, detail: detail || '' });
  }

  function setSummary(status, text) {
    summaryEl.className = `summary ${status || ''}`.trim();
    summaryEl.textContent = text;
  }

  function getClient() {
    if (supabaseClient) return supabaseClient;
    if (!window.supabase?.createClient) throw new Error('Supabase JS SDK не загрузился');
    const url = String(config.supabase?.url || '').trim();
    const anonKey = String(config.supabase?.anonKey || '').trim();
    if (!url || !anonKey) throw new Error('В config.js отсутствуют supabase.url или supabase.anonKey');
    supabaseClient = window.supabase.createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    return supabaseClient;
  }

  function formatError(error) {
    if (!error) return 'Неизвестная ошибка';
    const code = error.code ? `${error.code}: ` : '';
    const message = error.message || error.error_description || String(error);
    if (/row-level security|permission denied|42501/i.test(message)) {
      return `${code}${message}. Ошибка прав доступа / RLS Supabase.`;
    }
    if (/check constraint|violates check constraint|23514/i.test(message)) {
      return `${code}${message}. Проверь согласованность status/report_status/report_sent_at.`;
    }
    if (/Failed to fetch|Load failed|NetworkError/i.test(message)) {
      return `${code}${message}. Браузер не смог выполнить сетевой запрос. Проверь сеть, публикацию функции и CORS.`;
    }
    return `${code}${message}`;
  }

  function explainFunctionFailure(result) {
    const message = String(result?.data?.error || result?.data?.message || result?.data?.raw || '').trim();
    if (result?.status === 404) return `Edge Function ${notifyFunctionName()} не найдена или не задеплоена.`;
    if (result?.status === 401 && /Unauthorized/i.test(message)) return `Edge Function ${notifyFunctionName()} отвечает. Для уведомлений нужен secret, поэтому ping отклонён штатно.`;
    if (/TELEGRAM_BOT_TOKEN/i.test(message)) return 'Edge Function найдена, но в Supabase не задан секрет TELEGRAM_BOT_TOKEN.';
    if (/Failed to fetch|Load failed|NetworkError/i.test(message)) return 'Браузер не смог вызвать Edge Function: проверь сеть, URL проекта и CORS.';
    return `HTTP ${result?.status || '—'}${message ? `: ${message}` : ''}`;
  }

  async function checkCount(client, table, label) {
    const response = await client.from(table).select('*', { count: 'exact', head: true }).eq('student_id', studentId);
    if (response.error) {
      const detail = formatError(response.error);
      addCheck(label, 'bad', detail);
      lastReport.errors.push({ stage: label, error: detail });
      return false;
    }
    addCheck(label, 'ok', `Доступ есть. Строк: ${response.count ?? 0}.`);
    return true;
  }

  async function invokeFunction(body, extraHeaders = {}) {
    const anonKey = String(config.supabase?.anonKey || '').trim();
    const response = await fetch(functionUrl(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: anonKey,
        authorization: `Bearer ${anonKey}`,
        ...extraHeaders
      },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    return { ok: response.ok, status: response.status, data };
  }

  async function checkFunctionPing() {
    try {
      const result = await invokeFunction({ action: 'homework_report', studentId, lessonId: '', submissionId: '' });
      lastReport.functionProbe = result;
      const version = result.data?.functionVersion || 'версия не указана';

      if (result.status === 401 && /Unauthorized/i.test(String(result.data?.error || result.data?.message || ''))) {
        addCheck(`8. Supabase Edge Function ${notifyFunctionName()}`, 'ok', `Функция отвечает (${version}). Ping отклонён из-за secret — это нормально, сообщение не отправлялось.`);
        return true;
      }
      if (result.status === 400 && /Некорректные параметры отчёта|Missing|invalid notification identity/i.test(String(result.data?.error || ''))) {
        addCheck(`8. Supabase Edge Function ${notifyFunctionName()}`, 'ok', `Функция отвечает (${version}). Ping не отправлял Telegram-сообщение.`);
        return true;
      }
      if (!result.ok) {
        const detail = explainFunctionFailure(result);
        const status = /TELEGRAM_BOT_TOKEN|не найдена|не задеплоена|не смог/i.test(detail) ? 'bad' : 'warn';
        addCheck(`8. Supabase Edge Function ${notifyFunctionName()}`, status, detail);
        if (status === 'bad') lastReport.errors.push({ stage: 'edge_function_ping', error: detail, response: result.data });
        return status !== 'bad';
      }
      addCheck(`8. Supabase Edge Function ${notifyFunctionName()}`, 'ok', `Функция отвечает (${version}).`);
      return true;
    } catch (error) {
      const detail = formatError(error);
      addCheck(`8. Supabase Edge Function ${notifyFunctionName()}`, 'bad', detail);
      lastReport.errors.push({ stage: 'edge_function_fetch', error: detail });
      return false;
    }
  }

  function checkHomeworkRows(rows) {
    const suspicious = (rows || [])
      .filter((row) => {
        const status = String(row.status || '');
        const reportStatus = String(row.report_status || '');
        if (status === 'submitted') return !row.submitted_at || !row.locked_at || reportStatus !== 'sent' || !row.report_sent_at;
        if (status === 'draft') return Boolean(row.submitted_at || row.locked_at || reportStatus !== 'not_sent' || row.report_sent_at);
        if (status === 'submitted_pending_report') return !row.submitted_at || !row.locked_at || !['pending', 'failed'].includes(reportStatus);
        return true;
      })
      .map((row) => row.lesson_id || '(без lesson_id)');

    if (suspicious.length) {
      addCheck('4. Состояние сохранённых ДЗ', 'warn', `Есть несогласованные записи: ${suspicious.join(', ')}.`);
    } else {
      addCheck('4. Состояние сохранённых ДЗ', 'ok', 'Записи соответствуют текущей схеме draft → submitted_pending_report → submitted.');
    }
  }

  async function runAll() {
    runAllBtn.disabled = true;
    resetChecks();
    setSummary('', 'Проверяю подключения…');
    telegramInfoEl.innerHTML = '';

    try {
      const hasConfig = Boolean(config.supabase?.url && config.supabase?.anonKey && studentId);
      addCheck('1. config.js', hasConfig ? 'ok' : 'bad', hasConfig ? `Конфигурация загружена для ${studentId}.` : 'Не хватает student_id / Supabase URL / anon key.');
      if (!hasConfig) throw new Error('Некорректный config.js');

      const sdkOk = Boolean(window.supabase?.createClient);
      addCheck('2. Supabase JS SDK', sdkOk ? 'ok' : 'bad', sdkOk ? 'Библиотека @supabase/supabase-js загружена.' : 'CDN Supabase JS не загрузился.');
      if (!sdkOk) throw new Error('Supabase SDK не загрузился');

      const client = getClient();
      const homeworkTable = config.supabase?.tables?.homework || 'homework_progress';
      const vocabularyTable = config.supabase?.tables?.vocabulary || 'vocabulary_progress';
      const vocabularyTopicsTable = config.supabase?.tables?.vocabularyTopics || 'vocabulary_topic_progress';
      const grammarTable = config.supabase?.tables?.grammar || 'grammar_progress';

      const readResponse = await client
        .from(homeworkTable)
        .select('student_id,lesson_id,status,checked_at,submitted_at,locked_at,report_status,report_sent_at,score_correct,score_total,score_percent,answers,created_at,updated_at')
        .eq('student_id', studentId)
        .order('lesson_id', { ascending: false })
        .limit(50);

      if (readResponse.error) {
        const detail = formatError(readResponse.error);
        addCheck('3. Supabase Database / чтение homework_progress', 'bad', detail);
        lastReport.errors.push({ stage: 'database_read_homework', error: detail });
      } else {
        lastReport.directRows = readResponse.data || [];
        addCheck('3. Supabase Database / чтение homework_progress', 'ok', `Доступ есть. Получено строк: ${(readResponse.data || []).length}.`);
        checkHomeworkRows(readResponse.data || []);
      }

      await checkCount(client, vocabularyTable, '5. Supabase Database / vocabulary_progress');
      await checkCount(client, vocabularyTopicsTable, '6. Supabase Database / vocabulary_topic_progress');
      await checkCount(client, grammarTable, '7. Supabase Database / grammar_progress');
      await checkFunctionPing();

      telegramInfoEl.innerHTML = '';
      addKV(telegramInfoEl, 'Endpoint', functionUrl(), true);
      addKV(telegramInfoEl, 'Function version', lastReport.functionProbe?.data?.functionVersion || '—', true);
      addKV(telegramInfoEl, 'Получатель Telegram', 'проверяется тестовой отправкой');
      addKV(telegramInfoEl, 'Тестовая работа', `${TEST_LESSON_ID_PREFIX}-...`, true);

      const bad = lastReport.checks.filter((item) => item.status === 'bad');
      const warn = lastReport.checks.filter((item) => item.status === 'warn');
      if (bad.length) {
        setSummary('bad', `Найдена проблема: ${bad[0].name}. Смотри первую красную строку выше.`);
      } else if (warn.length) {
        setSummary('warn', 'Основные подключения доступны, но есть предупреждение. Telegram-получатель проверяется отдельной кнопкой ниже.');
      } else {
        setSummary('ok', 'Браузер, Supabase и Edge Function доступны. Теперь можно отдельно проверить запись Supabase и тестовый Telegram-отчёт.');
      }
    } catch (error) {
      const detail = formatError(error);
      addCheck('Проверка остановлена', 'bad', detail);
      lastReport.errors.push({ stage: 'fatal', error: detail });
      setSummary('bad', detail);
    } finally {
      lastReport.finishedAt = new Date().toISOString();
      rawEl.textContent = JSON.stringify(lastReport, null, 2);
      runAllBtn.disabled = false;
    }
  }

  async function bestEffortDeleteProbe(client, table, lessonId) {
    try {
      const { error } = await client.from(table).delete().eq('student_id', studentId).eq('lesson_id', lessonId);
      return !error;
    } catch {
      return false;
    }
  }

  async function testDatabaseWrite() {
    dbWriteBtn.disabled = true;
    dbWriteResultEl.innerHTML = '<div class="summary">Проверяю полный путь сохранения ДЗ…</div>';

    const client = getClient();
    const table = config.supabase?.tables?.homework || 'homework_progress';
    const now = new Date().toISOString();

    try {
      const draftRow = {
        student_id: studentId,
        student_name: String(student.nameEn || student.nameRu || studentId),
        lesson_id: DB_PROBE_LESSON_ID,
        lesson_title: 'ТЕСТ: диагностика Supabase',
        status: 'draft',
        answers: { __diagnostic: true, stage: 'draft', createdAt: now },
        score_correct: null,
        score_total: null,
        score_percent: null,
        checked_at: null,
        submitted_at: null,
        locked_at: null,
        report_status: 'not_sent',
        report_sent_at: null,
        report_error: null
      };

      const { error: upsertDraftError } = await client.from(table).upsert(draftRow, { onConflict: 'student_id,lesson_id' });
      if (upsertDraftError) throw new Error(`browser_draft_upsert: ${formatError(upsertDraftError)}`);

      const submittedAt = new Date().toISOString();
      const { error: updateError } = await client
        .from(table)
        .update({
          status: 'submitted_pending_report',
          answers: { __diagnostic: true, stage: 'submitted_pending_report', submittedAt },
          score_correct: 1,
          score_total: 1,
          score_percent: 100,
          checked_at: submittedAt,
          submitted_at: submittedAt,
          locked_at: submittedAt,
          report_status: 'pending',
          report_sent_at: null,
          report_error: null
        })
        .eq('student_id', studentId)
        .eq('lesson_id', DB_PROBE_LESSON_ID);
      if (updateError) throw new Error(`browser_pending_update: ${formatError(updateError)}`);

      const { data: savedRow, error: readError } = await client
        .from(table)
        .select('student_id,lesson_id,status,submitted_at,locked_at,report_status,report_sent_at,score_correct,score_total,score_percent')
        .eq('student_id', studentId)
        .eq('lesson_id', DB_PROBE_LESSON_ID)
        .single();
      if (readError) throw new Error(`browser_verify_read: ${formatError(readError)}`);
      if (savedRow?.status !== 'submitted_pending_report' || savedRow?.report_status !== 'pending' || !savedRow?.submitted_at || !savedRow?.locked_at || savedRow?.report_sent_at) {
        throw new Error(`Проверочная запись сохранилась в неверном состоянии: ${savedRow?.status || '—'} / ${savedRow?.report_status || '—'}.`);
      }

      const deleted = await bestEffortDeleteProbe(client, table, DB_PROBE_LESSON_ID);
      dbWriteResultEl.innerHTML = deleted
        ? '<div class="summary ok">✓ Полный путь homework_progress работает: draft → submitted_pending_report → cleanup. Реальные ДЗ не изменялись.</div>'
        : '<div class="summary warn">✓ Запись и проверка работают, но браузер не смог удалить техническую probe-запись. Она не связана с реальными уроками.</div>';
      lastReport.databaseWriteProbe = { ok: true, lessonId: DB_PROBE_LESSON_ID, cleanupDeleted: deleted, savedRow };
    } catch (error) {
      const detail = formatError(error);
      dbWriteResultEl.innerHTML = `<div class="summary bad">✕ Ошибка пути homework_progress: ${esc(detail)}</div>`;
      lastReport.errors.push({ stage: 'database_write_probe', error: detail, lessonId: DB_PROBE_LESSON_ID });
      await bestEffortDeleteProbe(client, table, DB_PROBE_LESSON_ID);
    } finally {
      rawEl.textContent = JSON.stringify(lastReport, null, 2);
      dbWriteBtn.disabled = false;
    }
  }

  async function sendTestReport() {
    sendBtn.disabled = true;
    sendResultEl.innerHTML = '<div class="summary">Создаю тестовую работу и отправляю отчёт…</div>';

    const client = getClient();
    const table = config.supabase?.tables?.homework || 'homework_progress';
    const submittedAt = new Date().toISOString();
    const testLessonId = `${TEST_LESSON_ID_PREFIX}-${Date.now()}`;

    try {
      const testRow = {
        student_id: studentId,
        student_name: String(student.nameEn || student.nameRu || studentId),
        lesson_id: testLessonId,
        lesson_title: 'ТЕСТ: проверка Telegram-отчёта',
        status: 'submitted_pending_report',
        answers: { test: true, note: 'Служебная проверка отправки Telegram-отчёта', submittedAt },
        score_correct: 4,
        score_total: 5,
        score_percent: 80,
        checked_at: submittedAt,
        submitted_at: submittedAt,
        locked_at: submittedAt,
        report_status: 'pending',
        report_sent_at: null,
        report_error: null
      };

      const { data: insertedRow, error: insertError } = await client
        .from(table)
        .insert(testRow)
        .select('lesson_id,submission_id,status,report_status,report_sent_at,report_error')
        .single();
      if (insertError) throw new Error(`test_row_insert: ${formatError(insertError)}`);
      if (!insertedRow?.submission_id) throw new Error('test_row_insert: submission_id не вернулся из Supabase.');

      const result = await invokeFunction({
        action: 'homework_report',
        studentId,
        lessonId: testLessonId,
        submissionId: insertedRow.submission_id,
        homeworkTitle: 'ТЕСТ: проверка Telegram-отчёта',
        homeworkSubtitle: 'Диагностика Амира'
      });

      if (!result.ok || !result.data?.ok) {
        const error = new Error(result.data?.error || explainFunctionFailure(result));
        error.httpStatus = result.status;
        throw error;
      }

      const { data: finalRow, error: finalReadError } = await client
        .from(table)
        .select('lesson_id,status,report_status,report_sent_at,report_error')
        .eq('student_id', studentId)
        .eq('lesson_id', testLessonId)
        .single();
      if (finalReadError) throw new Error(`final_row_read: ${formatError(finalReadError)}`);

      if (finalRow?.status !== 'submitted' || finalRow?.report_status !== 'sent' || !finalRow?.report_sent_at) {
        throw new Error(`После отправки ожидалось submitted / sent. Получено: ${finalRow?.status || '—'} / ${finalRow?.report_status || '—'}.`);
      }

      const sentAtPart = result.data.reportSentAt ? `; sent_at=${esc(result.data.reportSentAt)}` : '';
      sendResultEl.innerHTML = result.data.skipped
        ? `<div class="summary warn">Функция ответила успешно, но отчёт уже был зарегистрирован как отправленный. lesson_id=${esc(testLessonId)}${sentAtPart}.</div>`
        : `<div class="summary ok">✓ Telegram принял тестовый отчёт. message_id=${esc(result.data.telegramMessageId || '—')}; lesson_id=${esc(testLessonId)}${sentAtPart}.</div>`;
      lastReport.telegramSendProbe = { ok: true, lessonId: testLessonId, response: result.data, finalRow };
    } catch (error) {
      const status = Number(error?.httpStatus || 0);
      const detail = formatError(error);
      sendResultEl.innerHTML = `<div class="summary bad">✕ Тестовый отчёт не отправлен: ${esc(explainSendError(detail, status))}</div>`;
      lastReport.errors.push({ stage: 'telegram_test_send', status: status || null, error: detail, lessonId: testLessonId });
    } finally {
      rawEl.textContent = JSON.stringify(lastReport, null, 2);
      sendBtn.disabled = false;
    }
  }

  function explainSendError(message, status) {
    const text = String(message || '');
    if (/homework_reports/i.test(text) && /does not exist|schema cache|relation/i.test(text)) return 'Не создана таблица homework_reports. Выполни supabase/homework-reports.sql в SQL Editor.';
    if (/TELEGRAM_BOT_TOKEN/i.test(text)) return 'В Supabase Edge Functions не задан секрет TELEGRAM_BOT_TOKEN.';
    if (/recipient|disabled|not connected/i.test(text)) return 'Для amir нет активной записи в telegram_recipients или получатель отключён.';
    if (/Unauthorized/i.test(text) || status === 401) return 'Edge Function отклонила запрос. Проверь режим авторизации функции и её последнюю версию.';
    if (/Failed to fetch|NetworkError|Load failed/i.test(text)) return 'Браузер не смог вызвать Edge Function. Возможны ошибка публикации функции или CORS.';
    if (/Telegram|chat not found|bot was blocked|Forbidden/i.test(text) || status === 502) return `Telegram отклонил сообщение: ${text}`;
    if (status === 404) return `Edge Function ${notifyFunctionName()} не найдена. Её нужно повторно развернуть.`;
    return text;
  }

  async function copyReport() {
    const text = rawEl.textContent || '';
    try {
      await navigator.clipboard.writeText(text);
      const button = document.getElementById('copy-report');
      const old = button.textContent;
      button.textContent = 'Скопировано ✓';
      setTimeout(() => { button.textContent = old; }, 1300);
    } catch {
      window.prompt('Скопируй отчёт вручную:', text);
    }
  }

  document.getElementById('run-all').addEventListener('click', runAll);
  document.getElementById('test-db-write').addEventListener('click', testDatabaseWrite);
  document.getElementById('send-test-report').addEventListener('click', sendTestReport);
  document.getElementById('copy-report').addEventListener('click', copyReport);
  document.getElementById('reload-page').addEventListener('click', () => window.location.reload());
  renderConfig();
})();
