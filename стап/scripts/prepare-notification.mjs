import fs from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = (name) => String(process.env[name] || '').trim()
const requiredEnv = (name) => {
  const value = env(name)
  if (!value) throw new Error(`Missing environment variable: ${name}`)
  return value
}

const studentId = requiredEnv('STUDENT_ID')
const supabaseUrl = requiredEnv('SUPABASE_URL').replace(/\/+$/, '')
const anonKey = requiredEnv('SUPABASE_ANON_KEY')
const notifySecret = requiredEnv('NOTIFY_WEBHOOK_SECRET')
const lessonIdFilter = env('LESSON_ID')
const siteBaseUrl = env('SITE_BASE_URL').replace(/\/+$/, '')

if (lessonIdFilter && !/^lesson-\d{1,3}$/.test(lessonIdFilter)) {
  throw new Error('LESSON_ID must look like lesson-5 or be empty')
}

async function loadWindowArray(file, property) {
  const source = await fs.readFile(file, 'utf8')
  const sandbox = { window: Object.create(null) }
  vm.createContext(sandbox, { name: path.basename(file), codeGeneration: { strings: false, wasm: false } })
  new vm.Script(source, { filename: file }).runInContext(sandbox, { timeout: 1000 })
  const value = sandbox.window[property]
  if (!Array.isArray(value)) throw new Error(`${path.relative(root, file)} must set window.${property} to an array`)
  return JSON.parse(JSON.stringify(value))
}

async function lessonFiles() {
  const directory = path.join(root, 'data', 'lessons')
  if (lessonIdFilter) return [path.join(directory, `${lessonIdFilter}.json`)]
  const names = await fs.readdir(directory)
  return names
    .filter((name) => /^lesson-\d+\.json$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0))
    .map((name) => path.join(directory, name))
}

function isPublishable(lesson) {
  if (!lesson || lesson.status === 'draft' || lesson.status === 'locked') return false
  if (lesson.notification?.enabled !== true) return false
  const publishedAt = Date.parse(lesson.publishedAt || '')
  if (Number.isFinite(publishedAt) && publishedAt > Date.now()) return false
  return true
}

function publicLessonUrl(lessonId) {
  return siteBaseUrl ? `${siteBaseUrl}/lesson.html?id=${encodeURIComponent(lessonId)}` : ''
}

const vocabularyData = await loadWindowArray(path.join(root, 'data', 'vocabulary-data.js'), 'VOCABULARY_DATA')
const grammarData = await loadWindowArray(path.join(root, 'data', 'grammar-data.js'), 'GRAMMAR_DATA')
const files = await lessonFiles()
const failures = []
let eligibleCount = 0

for (const file of files) {
  let lesson
  try {
    lesson = JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (error) {
    if (lessonIdFilter && error?.code === 'ENOENT') throw new Error(`Lesson file not found: ${lessonIdFilter}.json`)
    throw error
  }
  const fileId = path.basename(file, '.json')
  lesson.id = fileId
  if (!isPublishable(lesson)) continue
  eligibleCount += 1

  const vocabulary = vocabularyData.find((topic) => topic.id === lesson.vocabularyId || topic.linkedLessonId === fileId) || null
  const grammarIds = new Set(Array.isArray(lesson.grammarIds) ? lesson.grammarIds : [])
  const grammar = grammarData.filter((topic) => topic.status !== 'draft' && topic.status !== 'locked' && (grammarIds.has(topic.id) || topic.linkedLessonId === fileId))
  const notificationVersion = Number(lesson.notification?.version || 1)

  const payload = {
    action: 'material_published',
    studentId,
    materialType: 'lesson_bundle',
    materialId: fileId,
    notificationVersion,
    homework: {
      id: fileId,
      number: Number(fileId.replace('lesson-', '')),
      title: String(lesson.title || fileId),
      subtitle: String(lesson.subtitle || ''),
      url: publicLessonUrl(fileId),
    },
    vocabulary: vocabulary ? { id: vocabulary.id, title: String(vocabulary.title || 'Vocabulary') } : null,
    grammar: grammar.map((topic) => ({ id: topic.id, title: String(topic.title || 'Grammar') })),
  }

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/notify-telegram`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: anonKey,
        authorization: `Bearer ${anonKey}`,
        'x-notify-secret': notifySecret,
      },
      body: JSON.stringify(payload),
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok || result.ok !== true) throw new Error(result.error || `HTTP ${response.status}`)
    console.log(`${fileId}: ${result.duplicate ? 'already notified' : 'notification sent'}`)
  } catch (error) {
    failures.push(`${fileId}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

if (!eligibleCount) console.log('No eligible lesson notifications found.')
if (failures.length) {
  console.error('Notification failures:\n' + failures.join('\n'))
  process.exitCode = 1
}
