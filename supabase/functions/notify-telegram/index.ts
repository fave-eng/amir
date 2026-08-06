import { withSupabase } from 'npm:@supabase/server@^1'

const encoder = new TextEncoder()
const FUNCTION_VERSION = 'homework-reports-v4'
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-notify-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  const responseBody = body && typeof body === 'object' && !Array.isArray(body)
    ? { ...(body as Record<string, unknown>), functionVersion: FUNCTION_VERSION }
    : body
  return Response.json(responseBody, { status, headers: corsHeaders })
}

function secureEqual(left: string, right: string): boolean {
  const a = encoder.encode(left)
  const b = encoder.encode(right)
  if (a.length !== b.length) return false

  let diff = 0
  for (let index = 0; index < a.length; index += 1) {
    diff |= a[index] ^ b[index]
  }
  return diff === 0
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function buildMaterialMessage(hasVocabulary: boolean): string {
  if (hasVocabulary) {
    return [
      '🚀 <b>Опубликованы новые учебные материалы!</b>',
      '',
      'Начни со слов к уроку — так домашняя работа будет легче. Затем переходи к заданию.',
      '',
      'Удачи! Запиши вопросы, и мы разберём их на следующем уроке ✨',
    ].join('\n')
  }

  return [
    '🚀 <b>Опубликованы новые учебные материалы!</b>',
    '',
    'Переходи к домашнему заданию. Запиши вопросы, и мы разберём их на следующем уроке.',
    '',
    'Удачи! ✨',
  ].join('\n')
}

function buildHomeworkReport(row: any): string {
  const correct = Number(row.score_correct || 0)
  const total = Number(row.score_total || 0)
  const percent = Number(row.score_percent ?? (total > 0 ? Math.round((correct / total) * 100) : 0))
  const mistakes = Math.max(0, total - correct)
  const submittedAt = row.submitted_at || row.updated_at || row.checked_at
  const submittedLabel = submittedAt
    ? new Date(submittedAt).toLocaleString('ru-RU', { timeZone: 'Asia/Yekaterinburg' })
    : 'не указано'

  return [
    '📩 <b>Получен отчёт по домашней работе</b>',
    '',
    `👨‍🎓 Ученик: <b>${escapeHtml(row.student_name || 'Амир')}</b>`,
    `📝 Работа: <b>${escapeHtml(row.lesson_title || row.lesson_id)}</b>`,
    `✅ Результат: <b>${correct} из ${total} (${percent}%)</b>`,
    `❌ Ошибок: <b>${mistakes}</b>`,
    `🕒 Отправлено: ${escapeHtml(submittedLabel)}`,
    '',
    'Ответы и результат сохранены в Supabase.',
  ].join('\n')
}

async function sendTelegramMessage(
  token: string,
  chatId: number,
  text: string,
  inlineKeyboard: Array<Array<{ text: string; url: string }>> = [],
) {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
  }
  if (inlineKeyboard.length) payload.reply_markup = { inline_keyboard: inlineKeyboard }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const result = await response.json().catch(() => null)
  if (!response.ok || !result?.ok) {
    const description = result?.description || `Telegram HTTP ${response.status}`
    throw new Error(description)
  }

  return result.result
}

async function getRecipient(ctx: any, studentId: string) {
  const { data: recipient, error } = await ctx.supabaseAdmin
    .from('telegram_recipients')
    .select('chat_id, enabled')
    .eq('student_id', studentId)
    .maybeSingle()

  if (error) throw error
  if (!recipient || !recipient.enabled) {
    const notFound = new Error('Telegram recipient is not connected or is disabled')
    ;(notFound as any).status = 404
    throw notFound
  }
  return recipient
}

async function updateHomeworkProgressReportState(
  ctx: any,
  studentId: string,
  lessonId: string,
  values: Record<string, unknown>,
) {
  const { error } = await ctx.supabaseAdmin
    .from('homework_progress')
    .update(values)
    .eq('student_id', studentId)
    .eq('lesson_id', lessonId)

  if (error) throw new Error(`Homework progress update failed: ${error.message}`)
}

async function handleHomeworkReport(payload: any, ctx: any, botToken: string) {
  const studentId = typeof payload.studentId === 'string' ? payload.studentId.trim() : ''
  const lessonId = typeof payload.lessonId === 'string' ? payload.lessonId.trim() : ''
  const lessonUrl = isHttpUrl(payload.lessonUrl) ? payload.lessonUrl : ''

  if (!studentId || !lessonId) {
    return json({ ok: false, error: 'studentId and lessonId are required' }, 400)
  }

  let recipient
  try {
    recipient = await getRecipient(ctx, studentId)
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, (error as any)?.status || 500)
  }

  const { data: row, error: progressError } = await ctx.supabaseAdmin
    .from('homework_progress')
    .select('student_id, student_name, lesson_id, lesson_title, status, answers, score_correct, score_total, score_percent, checked_at, submitted_at, locked_at, report_status, report_sent_at, report_error, updated_at')
    .eq('student_id', studentId)
    .eq('lesson_id', lessonId)
    .maybeSingle()

  if (progressError) return json({ ok: false, error: progressError.message }, 500)
  if (!row) return json({ ok: false, error: 'The homework row was not found in homework_progress' }, 409)

  const isPendingReport = row.status === 'submitted_pending_report'
    && ['pending', 'failed'].includes(String(row.report_status || ''))
    && !row.report_sent_at
  const isSentReport = row.status === 'submitted'
    && row.report_status === 'sent'
    && Boolean(row.report_sent_at)

  if (!isPendingReport && !isSentReport) {
    return json({
      ok: false,
      error: `Invalid homework report state: ${String(row.status || 'null')} / ${String(row.report_status || 'null')}`,
    }, 409)
  }

  const submissionKey = String(row.submitted_at || row.updated_at || row.checked_at || '')
  if (!submissionKey) return json({ ok: false, error: 'The homework row has no submission timestamp' }, 409)

  const { data: existing, error: existingError } = await ctx.supabaseAdmin
    .from('homework_reports')
    .select('id, status, telegram_message_id, sent_at')
    .eq('student_id', studentId)
    .eq('lesson_id', lessonId)
    .eq('submission_key', submissionKey)
    .maybeSingle()

  if (existingError) return json({ ok: false, error: existingError.message }, 500)

  if (existing?.status === 'sent' || isSentReport) {
    const reportSentAt = existing?.sent_at || row.report_sent_at || new Date().toISOString()
    try {
      await updateHomeworkProgressReportState(ctx, studentId, lessonId, {
        status: 'submitted',
        report_status: 'sent',
        report_sent_at: reportSentAt,
        report_error: null,
      })
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500)
    }

    return json({
      ok: true,
      skipped: true,
      reason: 'already_sent',
      telegramMessageId: existing?.telegram_message_id || null,
      reportSentAt,
    })
  }

  try {
    await updateHomeworkProgressReportState(ctx, studentId, lessonId, {
      status: 'submitted_pending_report',
      report_status: 'pending',
      report_sent_at: null,
      report_error: null,
    })
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500)
  }

  let reportId = existing?.id as string | undefined
  const reportRow = {
    student_id: studentId,
    lesson_id: lessonId,
    submission_key: submissionKey,
    status: 'pending',
    score_correct: row.score_correct,
    score_total: row.score_total,
    score_percent: row.score_percent,
    payload: row,
    error_message: null,
  }

  if (reportId) {
    const { error } = await ctx.supabaseAdmin.from('homework_reports').update(reportRow).eq('id', reportId)
    if (error) return json({ ok: false, error: error.message }, 500)
  } else {
    const { data: created, error } = await ctx.supabaseAdmin
      .from('homework_reports')
      .insert(reportRow)
      .select('id')
      .single()

    if (error) {
      if (error.code === '23505') {
        return json({ ok: false, error: 'This homework report is already being processed' }, 409)
      }
      return json({ ok: false, error: error.message }, 500)
    }
    reportId = created.id
  }

  const keyboard = lessonUrl
    ? [[{ text: '📝 Открыть домашнюю работу', url: lessonUrl }]]
    : []

  let telegramMessage
  try {
    telegramMessage = await sendTelegramMessage(
      botToken,
      Number(recipient.chat_id),
      buildHomeworkReport(row),
      keyboard,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await ctx.supabaseAdmin
      .from('homework_reports')
      .update({ status: 'failed', error_message: message })
      .eq('id', reportId)
    await ctx.supabaseAdmin
      .from('homework_progress')
      .update({
        status: 'submitted_pending_report',
        report_status: 'failed',
        report_sent_at: null,
        report_error: message,
      })
      .eq('student_id', studentId)
      .eq('lesson_id', lessonId)
    return json({ ok: false, error: message }, 502)
  }

  const reportSentAt = new Date().toISOString()
  const { error: reportUpdateError } = await ctx.supabaseAdmin
    .from('homework_reports')
    .update({
      status: 'sent',
      telegram_message_id: telegramMessage.message_id,
      sent_at: reportSentAt,
      error_message: null,
    })
    .eq('id', reportId)

  if (reportUpdateError) {
    return json({
      ok: false,
      error: `Telegram sent, but report log update failed: ${reportUpdateError.message}`,
      telegramMessageId: telegramMessage.message_id,
    }, 500)
  }

  try {
    await updateHomeworkProgressReportState(ctx, studentId, lessonId, {
      status: 'submitted',
      report_status: 'sent',
      report_sent_at: reportSentAt,
      report_error: null,
    })
  } catch (error) {
    return json({
      ok: false,
      error: error instanceof Error ? `Telegram sent, but ${error.message}` : String(error),
      telegramMessageId: telegramMessage.message_id,
    }, 500)
  }

  return json({
    ok: true,
    skipped: false,
    telegramMessageId: telegramMessage.message_id,
    reportSentAt,
  })
}

async function handleMaterialNotification(payload: any, req: Request, ctx: any, botToken: string) {
  const expectedSecret = Deno.env.get('NOTIFY_WEBHOOK_SECRET') ?? ''
  const actualSecret = req.headers.get('x-notify-secret') ?? ''
  if (!expectedSecret || !secureEqual(actualSecret, expectedSecret)) {
    return json({ ok: false, error: 'Unauthorized' }, 401)
  }

  const studentId = typeof payload.studentId === 'string' ? payload.studentId.trim() : ''
  const materialType = typeof payload.materialType === 'string' ? payload.materialType.trim() : ''
  const materialId = typeof payload.materialId === 'string' ? payload.materialId.trim() : ''
  const notificationVersion = Number(payload.notificationVersion)
  const homework = payload.homework
  const vocabulary = payload.vocabulary
  const grammar = Array.isArray(payload.grammar) ? payload.grammar : []

  if (!studentId || !materialType || !materialId || !Number.isInteger(notificationVersion) || notificationVersion < 1) {
    return json({ ok: false, error: 'Missing or invalid notification identity' }, 400)
  }
  if (!homework || !isHttpUrl(homework.url)) return json({ ok: false, error: 'A valid homework URL is required' }, 400)
  if (vocabulary && !isHttpUrl(vocabulary.url)) return json({ ok: false, error: 'Invalid vocabulary URL' }, 400)
  for (const item of grammar) {
    if (!item || !isHttpUrl(item.url)) return json({ ok: false, error: 'Invalid grammar URL' }, 400)
  }

  let recipient
  try {
    recipient = await getRecipient(ctx, studentId)
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, (error as any)?.status || 500)
  }

  const { data: existing, error: existingError } = await ctx.supabaseAdmin
    .from('material_publications')
    .select('id, status, telegram_message_id')
    .eq('student_id', studentId)
    .eq('material_type', materialType)
    .eq('material_id', materialId)
    .eq('notification_version', notificationVersion)
    .maybeSingle()

  if (existingError) return json({ ok: false, error: existingError.message }, 500)
  if (existing?.status === 'sent') {
    return json({ ok: true, skipped: true, reason: 'already_sent', telegramMessageId: existing.telegram_message_id })
  }

  let publicationId = existing?.id as string | undefined
  if (publicationId) {
    const { error } = await ctx.supabaseAdmin
      .from('material_publications')
      .update({ status: 'pending', payload, error_message: null })
      .eq('id', publicationId)
    if (error) return json({ ok: false, error: error.message }, 500)
  } else {
    const { data: created, error } = await ctx.supabaseAdmin
      .from('material_publications')
      .insert({
        student_id: studentId,
        material_type: materialType,
        material_id: materialId,
        notification_version: notificationVersion,
        status: 'pending',
        payload,
      })
      .select('id')
      .single()

    if (error) {
      if (error.code === '23505') return json({ ok: true, skipped: true, reason: 'already_claimed' })
      return json({ ok: false, error: error.message }, 500)
    }
    publicationId = created.id
  }

  const keyboard: Array<Array<{ text: string; url: string }>> = []
  if (vocabulary) keyboard.push([{ text: '💥 Открыть слова', url: vocabulary.url }])
  keyboard.push([{ text: '📝 Открыть домашнюю работу', url: homework.url }])
  grammar.forEach((item: any, index: number) => {
    const label = grammar.length === 1 ? '📐 Повторить грамматику' : `📐 ${String(item.title || `Grammar ${index + 1}`).slice(0, 48)}`
    keyboard.push([{ text: label, url: item.url }])
  })

  try {
    const telegramMessage = await sendTelegramMessage(
      botToken,
      Number(recipient.chat_id),
      buildMaterialMessage(Boolean(vocabulary)),
      keyboard,
    )

    const { error: updateError } = await ctx.supabaseAdmin
      .from('material_publications')
      .update({
        status: 'sent',
        telegram_message_id: telegramMessage.message_id,
        sent_at: new Date().toISOString(),
        error_message: null,
      })
      .eq('id', publicationId)

    if (updateError) throw new Error(`Telegram sent, but log update failed: ${updateError.message}`)
    return json({ ok: true, skipped: false, telegramMessageId: telegramMessage.message_id })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await ctx.supabaseAdmin
      .from('material_publications')
      .update({ status: 'failed', error_message: message })
      .eq('id', publicationId)
    return json({ ok: false, error: message }, 502)
  }
}

export default {
  fetch: withSupabase({ auth: 'none' }, async (req, ctx) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)

    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
    if (!botToken) return json({ ok: false, error: 'TELEGRAM_BOT_TOKEN is not configured' }, 500)

    let payload: any
    try {
      payload = await req.json()
    } catch {
      return json({ ok: false, error: 'Invalid JSON' }, 400)
    }

    if (payload?.eventType === 'homework_report') {
      return handleHomeworkReport(payload, ctx, botToken)
    }
    return handleMaterialNotification(payload, req, ctx, botToken)
  }),
}
