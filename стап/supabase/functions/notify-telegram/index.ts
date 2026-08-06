import { createClient } from 'npm:@supabase/supabase-js@2'

const FUNCTION_VERSION = 'english-space-v9'
const encoder = new TextEncoder()
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-notify-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function response(body: Record<string, unknown>, status = 200) {
  return Response.json({ ...body, functionVersion: FUNCTION_VERSION }, { status, headers: corsHeaders })
}

function secureEqual(left: string, right: string) {
  const a = encoder.encode(left)
  const b = encoder.encode(right)
  if (a.length !== b.length) return false
  let difference = 0
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index]
  return difference === 0
}

function cleanId(value: unknown, pattern: RegExp, label: string) {
  const text = String(value ?? '').trim()
  if (!pattern.test(text)) throw new Error(`Invalid ${label}`)
  return text
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function validSiteUrl(value: unknown) {
  const configuredBase = Deno.env.get('SITE_BASE_URL')?.trim().replace(/\/+$/, '') || ''
  if (!configuredBase || typeof value !== 'string') return null
  try {
    const base = new URL(configuredBase)
    const candidate = new URL(value)
    if (candidate.protocol !== 'https:' || candidate.origin !== base.origin) return null
    return candidate.toString()
  } catch {
    return null
  }
}


function isStale(value: unknown, ageMs = 90_000) {
  const timestamp = Date.parse(String(value ?? ''))
  return !Number.isFinite(timestamp) || timestamp <= Date.now() - ageMs
}

async function sendTelegram(
  token: string,
  recipient: { chat_id: number; message_thread_id?: number | null },
  text: string,
  button?: { text: string; url: string } | null,
) {
  const payload: Record<string, unknown> = {
    chat_id: recipient.chat_id,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  }
  if (recipient.message_thread_id) payload.message_thread_id = recipient.message_thread_id
  if (button) payload.reply_markup = { inline_keyboard: [[button]] }

  const telegramResponse = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const telegramBody = await telegramResponse.json().catch(() => null)
  if (!telegramResponse.ok || !telegramBody?.ok) {
    throw new Error(telegramBody?.description || `Telegram HTTP ${telegramResponse.status}`)
  }
  return telegramBody.result
}

function homeworkMessage(row: Record<string, any>) {
  const correct = Number(row.score_correct || 0)
  const total = Number(row.score_total || 0)
  const percent = Number(row.score_percent || 0)
  const mistakes = Math.max(0, total - correct)
  const timeZone = Deno.env.get('TEACHER_TIME_ZONE') || 'Europe/Riga'
  const submittedAt = row.submitted_at || row.updated_at
  const date = submittedAt
    ? new Date(submittedAt).toLocaleString('ru-RU', { timeZone })
    : 'не указано'

  return [
    '📩 <b>Получена домашняя работа</b>',
    '',
    `👤 Ученик: <b>${escapeHtml(row.student_name || row.student_id)}</b>`,
    `📝 Работа: <b>${escapeHtml(row.lesson_title || row.lesson_id)}</b>`,
    `✅ Результат: <b>${correct} из ${total}</b> (${percent}%)`,
    `❌ Ошибок: <b>${mistakes}</b>`,
    `🕒 Отправлено: ${escapeHtml(date)}`,
  ].join('\n')
}

function materialMessage(body: Record<string, any>) {
  const homework = body.homework && typeof body.homework === 'object' ? body.homework : {}
  const vocabulary = body.vocabulary && typeof body.vocabulary === 'object' ? body.vocabulary : null
  const grammar = Array.isArray(body.grammar) ? body.grammar : []
  const lines = [
    '🚀 <b>Опубликованы новые материалы</b>',
    '',
    homework.title ? `📝 Домашняя работа: <b>${escapeHtml(homework.title)}</b>` : '📝 Новая домашняя работа',
  ]
  if (vocabulary?.title) lines.push(`💥 Словарь: <b>${escapeHtml(vocabulary.title)}</b>`)
  grammar.forEach((topic: Record<string, unknown>) => {
    if (topic?.title) lines.push(`📐 Грамматика: <b>${escapeHtml(topic.title)}</b>`)
  })
  lines.push('', 'Материалы уже доступны на сайте ученика.')
  return lines.join('\n')
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return response({ ok: false, error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!supabaseUrl || !serviceRoleKey) return response({ ok: false, error: 'Server configuration is incomplete' }, 500)
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let body: Record<string, any>
  try {
    body = await request.json()
  } catch {
    return response({ ok: false, error: 'Invalid JSON body' }, 400)
  }

  const action = String(body.action || (body.eventType === 'homework_report' ? 'homework_report' : '')).trim()

  try {
    if (action === 'health') {
      const studentId = typeof body.studentId === 'string' && /^[a-z0-9-]+$/.test(body.studentId) ? body.studentId : 'amir'
      const tableNames = ['homework_progress','vocabulary_progress','vocabulary_topic_progress','grammar_progress','telegram_recipients','material_publications','homework_reports']
      const tableChecks = await Promise.all(tableNames.map((table) => supabase.from(table).select('id', { head: true, count: 'exact' }).limit(1)))
      const recipientCheck = await supabase.from('telegram_recipients').select('student_id').eq('student_id', studentId).eq('enabled', true).maybeSingle()
      const schemaReady = tableChecks.every((check) => !check.error)
      return response({
        ok: schemaReady,
        schemaReady,
        tablesChecked: tableNames.length,
        recipientConfigured: Boolean(recipientCheck.data && !recipientCheck.error),
        telegramTokenConfigured: Boolean(Deno.env.get('TELEGRAM_BOT_TOKEN')),
      }, schemaReady ? 200 : 503)
    }

    if (action === 'homework_report') {
      const studentId = cleanId(body.studentId, /^[a-z0-9-]{1,80}$/, 'studentId')
      const lessonId = cleanId(body.lessonId, /^lesson-\d{1,3}$/, 'lessonId')
      if (!isUuid(body.submissionId)) return response({ ok: false, error: 'Invalid submissionId' }, 400)
      const submissionId = body.submissionId

      const { data: row, error: rowError } = await supabase
        .from('homework_progress')
        .select('*')
        .eq('student_id', studentId)
        .eq('lesson_id', lessonId)
        .eq('submission_id', submissionId)
        .in('status', ['submitted_pending_report', 'submitted'])
        .maybeSingle()
      if (rowError) throw rowError
      if (!row) return response({ ok: false, error: 'Final submitted homework row was not found' }, 404)

      const { data: recipient, error: recipientError } = await supabase
        .from('telegram_recipients')
        .select('chat_id,message_thread_id')
        .eq('student_id', studentId)
        .eq('enabled', true)
        .maybeSingle()
      if (recipientError) throw recipientError
      if (!recipient) return response({ ok: false, error: 'Active Telegram recipient is not configured' }, 409)

      const { data: inserted, error: insertError } = await supabase
        .from('homework_reports')
        .insert({
          student_id: studentId,
          lesson_id: lessonId,
          submission_id: submissionId,
          status: 'pending',
          score_correct: row.score_correct,
          score_total: row.score_total,
          score_percent: row.score_percent,
          payload: { lessonUrl: validSiteUrl(body.lessonUrl) },
        })
        .select('*')
        .maybeSingle()

      let report = inserted
      if (insertError) {
        if (insertError.code !== '23505') throw insertError
        const existing = await supabase
          .from('homework_reports')
          .select('*')
          .eq('student_id', studentId)
          .eq('lesson_id', lessonId)
          .eq('submission_id', submissionId)
          .single()
        if (existing.error) throw existing.error
        report = existing.data
        if (report.status === 'sent') return response({ ok: true, duplicate: true, telegramMessageId: report.telegram_message_id, sentAt: report.sent_at })
        if (report.status === 'pending' && !isStale(report.updated_at)) {
          return response({ ok: true, duplicate: true, pending: true })
        }
        let retry = supabase
          .from('homework_reports')
          .update({ status: 'pending', error_message: null })
          .eq('id', report.id)
        retry = report.status === 'failed'
          ? retry.eq('status', 'failed')
          : retry.eq('status', 'pending').lte('updated_at', new Date(Date.now() - 90_000).toISOString())
        const claimed = await retry.select('*').maybeSingle()
        if (claimed.error) throw claimed.error
        if (!claimed.data) return response({ ok: true, duplicate: true, pending: true })
        report = claimed.data
      }

      const token = Deno.env.get('TELEGRAM_BOT_TOKEN') || ''
      if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured')
      const lessonUrl = validSiteUrl(body.lessonUrl)
      try {
        const telegramResult = await sendTelegram(
          token,
          recipient,
          homeworkMessage(row),
          lessonUrl ? { text: 'Открыть работу', url: lessonUrl } : null,
        )
        const sentAt = new Date().toISOString()
        await Promise.all([
          supabase.from('homework_reports').update({ status: 'sent', telegram_message_id: telegramResult.message_id, sent_at: sentAt, error_message: null }).eq('id', report.id),
          supabase.from('homework_progress').update({ status: 'submitted', report_status: 'sent', report_sent_at: sentAt, report_error: null }).eq('id', row.id),
        ])
        return response({ ok: true, telegramMessageId: telegramResult.message_id, sentAt })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await Promise.all([
          supabase.from('homework_reports').update({ status: 'failed', error_message: message }).eq('id', report.id),
          supabase.from('homework_progress').update({ report_status: 'failed', report_error: message }).eq('id', row.id),
        ])
        return response({ ok: false, error: message }, 502)
      }
    }

    if (action === 'material_published') {
      const configuredSecret = Deno.env.get('NOTIFY_WEBHOOK_SECRET') || ''
      const suppliedSecret = request.headers.get('x-notify-secret') || ''
      if (!configuredSecret || !secureEqual(configuredSecret, suppliedSecret)) {
        return response({ ok: false, error: 'Unauthorized' }, 401)
      }

      const studentId = cleanId(body.studentId, /^[a-z0-9-]{1,80}$/, 'studentId')
      const materialType = cleanId(body.materialType, /^[a-z0-9_-]{1,80}$/, 'materialType')
      const materialId = cleanId(body.materialId, /^[a-z0-9_-]{1,120}$/, 'materialId')
      const notificationVersion = Number(body.notificationVersion)
      if (!Number.isInteger(notificationVersion) || notificationVersion < 1) return response({ ok: false, error: 'Invalid notificationVersion' }, 400)

      const { data: recipient, error: recipientError } = await supabase
        .from('telegram_recipients')
        .select('chat_id,message_thread_id')
        .eq('student_id', studentId)
        .eq('enabled', true)
        .maybeSingle()
      if (recipientError) throw recipientError
      if (!recipient) return response({ ok: false, error: 'Active Telegram recipient is not configured' }, 409)

      const payload = {
        homework: body.homework || {},
        vocabulary: body.vocabulary || null,
        grammar: Array.isArray(body.grammar) ? body.grammar : [],
      }
      const { data: insertedPublication, error: insertError } = await supabase
        .from('material_publications')
        .insert({ student_id: studentId, material_type: materialType, material_id: materialId, notification_version: notificationVersion, status: 'pending', payload })
        .select('*')
        .maybeSingle()

      let publication = insertedPublication
      if (insertError) {
        if (insertError.code !== '23505') throw insertError
        const existing = await supabase.from('material_publications').select('*')
          .eq('student_id', studentId).eq('material_type', materialType).eq('material_id', materialId).eq('notification_version', notificationVersion).single()
        if (existing.error) throw existing.error
        publication = existing.data
        if (publication.status === 'sent' || publication.status === 'skipped') {
          return response({ ok: true, duplicate: true, status: publication.status, telegramMessageId: publication.telegram_message_id })
        }
        if (publication.status === 'pending' && !isStale(publication.updated_at)) {
          return response({ ok: false, pending: true, error: 'Notification delivery is already pending' }, 409)
        }
        let retry = supabase
          .from('material_publications')
          .update({ status: 'pending', error_message: null, payload })
          .eq('id', publication.id)
        retry = publication.status === 'failed'
          ? retry.eq('status', 'failed')
          : retry.eq('status', 'pending').lte('updated_at', new Date(Date.now() - 90_000).toISOString())
        const claimed = await retry.select('*').maybeSingle()
        if (claimed.error) throw claimed.error
        if (!claimed.data) return response({ ok: false, pending: true, error: 'Notification delivery is already pending' }, 409)
        publication = claimed.data
      }
      if (!publication) throw new Error('Could not create the publication record')

      const token = Deno.env.get('TELEGRAM_BOT_TOKEN') || ''
      if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured')
      const materialUrl = validSiteUrl(body.homework?.url)
      try {
        const telegramResult = await sendTelegram(token, recipient, materialMessage(body), materialUrl ? { text: 'Открыть материалы', url: materialUrl } : null)
        const sentAt = new Date().toISOString()
        await supabase.from('material_publications').update({ status: 'sent', telegram_message_id: telegramResult.message_id, sent_at: sentAt, error_message: null }).eq('id', publication.id)
        return response({ ok: true, telegramMessageId: telegramResult.message_id, sentAt })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await supabase.from('material_publications').update({ status: 'failed', error_message: message }).eq('id', publication.id)
        return response({ ok: false, error: message }, 502)
      }
    }

    return response({ ok: false, error: 'Unknown action' }, 400)
  } catch (error) {
    console.error(error)
    const message = error instanceof Error ? error.message : String(error)
    return response({ ok: false, error: message }, 500)
  }
})
