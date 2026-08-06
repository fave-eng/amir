import fs from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const passes = []
const fail = (message) => failures.push(message)
const pass = (message) => passes.push(message)

async function walk(directory) {
  const result = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await walk(full))
    else result.push(full)
  }
  return result
}

const files = await walk(root)
const relative = (file) => path.relative(root, file).replaceAll(path.sep, '/')

for (const forbidden of ['.git', '.DS_Store', '__MACOSX']) {
  if (files.some((file) => relative(file).split('/').includes(forbidden))) fail(`Forbidden service file found: ${forbidden}`)
}
if (files.some((file) => relative(file) === 'data/lessons/index.json')) fail('Forbidden data/lessons/index.json exists')
if (files.some((file) => path.basename(file).toLowerCase() === 'login.html')) fail('Forbidden login.html exists')
if (!failures.length) pass('No service files, lesson index or login page')

const syntaxFiles = files.filter((file) => /\.(js|mjs)$/.test(file))
for (const file of syntaxFiles) {
  try { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }) }
  catch (error) { fail(`JavaScript syntax error in ${relative(file)}: ${error.stderr?.toString() || error.message}`) }
}
pass(`JavaScript syntax checked: ${syntaxFiles.length} files`)

const jsonFiles = files.filter((file) => file.endsWith('.json'))
for (const file of jsonFiles) {
  try { JSON.parse(await fs.readFile(file, 'utf8')) }
  catch (error) { fail(`Invalid JSON in ${relative(file)}: ${error.message}`) }
}
pass(`JSON parsed: ${jsonFiles.length} files`)

const htmlFiles = files.filter((file) => file.endsWith('.html'))
for (const file of htmlFiles) {
  const source = await fs.readFile(file, 'utf8')
  if (!source.includes('class="skip-link"')) fail(`${relative(file)} has no skip-link`)
  for (const match of source.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const raw = match[1]
    if (/^(?:https?:|mailto:|tel:|#|data:|javascript:)/.test(raw)) continue
    const clean = raw.split(/[?#]/)[0]
    if (!clean) continue
    const target = path.resolve(path.dirname(file), clean)
    try { await fs.access(target) }
    catch { fail(`Broken local HTML path in ${relative(file)}: ${raw}`) }
  }
}
pass(`Local HTML paths checked: ${htmlFiles.length} pages`)

const css = await fs.readFile(path.join(root, 'styles.css'), 'utf8')
for (const width of ['320px','420px','520px','620px']) {
  if (!css.includes(width)) fail(`Responsive CSS does not mention ${width}`)
}
if (!css.includes('prefers-reduced-motion')) fail('Reduced-motion CSS is missing')
if (!css.includes('--indigo: #4f46e5')) fail('Required design token --indigo is missing')
pass('Design tokens, responsive rules and reduced motion checked')

const lessonFiles = files.filter((file) => /data\/lessons\/lesson-\d+\.json$/.test(relative(file)))
if (lessonFiles.length !== 0) fail(`Empty mode must have zero published lesson files, found ${lessonFiles.length}`)
else pass('Empty mode: zero lesson-N.json files')

function scoreUnits(block) {
  if (!block || block.scored === false) return 0
  if (block.type === 'exercise') {
    return (Array.isArray(block.items) ? block.items : []).reduce((sum, item) => {
      if (item.example || item.displayOnly || item.scored === false) return sum
      if (item.input === 'gaps') return sum + (Array.isArray(item.answers) ? item.answers.length : 0)
      return sum + 1
    }, 0)
  }
  if (block.type === 'match') return Array.isArray(block.pairs) ? block.pairs.length : 0
  if (['text','translate','single','multiple','select','reorder'].includes(block.type)) return 1
  if (block.type === 'textarea') return block.scored === false ? 0 : 1
  if (block.type === 'audio') return block.response === false ? 0 : 1
  return 0
}
for (const file of lessonFiles) {
  const lesson = JSON.parse(await fs.readFile(file, 'utf8'))
  const calculated = (lesson.blocks || []).reduce((sum, block) => sum + scoreUnits(block), 0)
  if (calculated !== Number(lesson.totalPoints || 0)) fail(`${relative(file)} totalPoints=${lesson.totalPoints}, calculated=${calculated}`)
}
pass('Lesson scoring validation is ready; no published lessons to compare')

async function loadArray(file, property) {
  const source = await fs.readFile(file, 'utf8')
  const sandbox = { window: {} }
  vm.createContext(sandbox)
  new vm.Script(source, { filename: file }).runInContext(sandbox, { timeout: 1000 })
  return sandbox.window[property]
}
const vocab = await loadArray(path.join(root, 'data/vocabulary-data.js'), 'VOCABULARY_DATA')
const grammar = await loadArray(path.join(root, 'data/grammar-data.js'), 'GRAMMAR_DATA')
if (!Array.isArray(vocab) || vocab.length !== 0) fail('Empty mode vocabulary must be []')
if (!Array.isArray(grammar) || grammar.length !== 0) fail('Empty mode grammar must be []')
pass('Empty vocabulary and grammar datasets confirmed')

const normalized = new Set()
for (const topic of vocab || []) {
  for (const word of topic.words || []) {
    const key = String(word.uniqueKey || word.en || '').normalize('NFKC').toLowerCase().replace(/[’‘`]/g, "'").trim().replace(/\s+/g, ' ').replace(/^[\s.,!?;:()[\]{}"“”]+|[\s.,!?;:()[\]{}"“”]+$/g, '')
    if (normalized.has(key)) fail(`Duplicate vocabulary key: ${key}`)
    normalized.add(key)
  }
}
pass('Vocabulary uniqueness checked')

const textFiles = files.filter((file) => /\.(?:html|css|js|mjs|ts|json|md|sql|toml|yml)$/.test(file) && relative(file) !== 'scripts/quality-check.mjs')
const referenceNamePattern = new RegExp(['kri', 'stina'].join(''), 'ig')
const forbiddenPatterns = [
  [referenceNamePattern, 'reference student name'],
  [/svejqcrkxkiheucglikq/ig, 'foreign Supabase project'],
  [/-1003987027739/g, 'foreign Telegram chat ID'],
  [/authMode/g, 'authMode'],
  [/signInWithPassword|getSession\s*\(|signOut\s*\(|auth\.users/ig, 'Supabase Auth code'],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, 'private key'],
]
for (const file of textFiles) {
  const source = await fs.readFile(file, 'utf8')
  for (const [pattern, label] of forbiddenPatterns) {
    if (label === 'Supabase Auth code' && !/\.(?:html|js|mjs)$/.test(file)) continue
    pattern.lastIndex = 0
    if (pattern.test(source)) fail(`${label} found in ${relative(file)}`)
  }
}
pass('Reference identity, foreign project data, Auth code and private keys are absent')

const schema = await fs.readFile(path.join(root, 'supabase/schema.sql'), 'utf8')
const tableNames = ['homework_progress','vocabulary_progress','vocabulary_topic_progress','grammar_progress','telegram_recipients','material_publications','homework_reports']
for (const table of tableNames) if (!schema.includes(`public.${table}`)) fail(`schema.sql does not define ${table}`)
if (!schema.includes('homework_progress_protect_submitted')) fail('Immutable homework trigger is missing')
if (!schema.includes("student_id = 'amir'")) fail('Fixed student RLS condition is missing')
if (!schema.includes('apply_vocabulary_test')) fail('Atomic vocabulary test function is missing')
pass('Seven-table schema, RLS, immutable submission and vocabulary transaction found')

const edge = await fs.readFile(path.join(root, 'supabase/functions/notify-telegram/index.ts'), 'utf8')
for (const action of ["action === 'health'", "action === 'homework_report'", "action === 'material_published'"]) if (!edge.includes(action)) fail(`Edge Function action missing: ${action}`)
if (!edge.includes("FUNCTION_VERSION = 'english-space-v9'")) fail('Edge Function version is incorrect')
if (!edge.includes('x-notify-secret')) fail('Publication secret header is missing')
pass('Edge Function actions, version and publication secret checked')

const workflow = await fs.readFile(path.join(root, '.github/workflows/notify-new-materials.yml'), 'utf8')
const notificationScript = await fs.readFile(path.join(root, 'scripts/prepare-notification.mjs'), 'utf8')
if (/requiredEnv\(['"]LESSON_ID/.test(notificationScript)) fail('LESSON_ID is incorrectly required')
if (!workflow.includes("LESSON_ID: ${{ inputs.lesson_id || '' }}")) fail('Workflow does not support an empty LESSON_ID')
pass('Notification workflow supports empty and explicit LESSON_ID')

if (failures.length) {
  console.error(`QUALITY CHECK FAILED (${failures.length})`)
  failures.forEach((message) => console.error(`- ${message}`))
  process.exitCode = 1
} else {
  console.log(`QUALITY CHECK PASSED (${passes.length} groups)`)
  passes.forEach((message) => console.log(`- ${message}`))
}
