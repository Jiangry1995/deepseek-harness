import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import MemoryStore, {
  MAX_READ_BYTES,
  MAX_SEARCH_HITS,
  MAX_SEARCH_LINE_CHARS,
  isHiddenMemoryPath,
  isSkillName,
  noteFileName,
  redactMemoryText,
  resolveContainedPath,
  sanitizeSlug,
  skillFilePath,
  withSummaryVersion,
} from '../src/index.ts'
import { parseMemoryState } from '../src/state.ts'
import { SUMMARY_VERSION_LINE } from '../src/paths.ts'

let roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })))
  roots = []
})

/**
 * Create an isolated memory root.
 * @returns absolute temp directory.
 */
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-'))
  roots.push(root)
  return root
}

/**
 * Mount a MemoryStore over a fresh user root.
 * @returns context and user root.
 */
async function setup(): Promise<{ ctx: Context; userRoot: string }> {
  const userRoot = await tempRoot()
  const ctx = new Context()
  await ctx.plugin(MemoryStore, { userRoot })
  return { ctx, userRoot }
}

describe('dsh-memory paths', () => {
  it('rejects empty, NUL, root, and escaping relative paths', async () => {
    const root = await tempRoot()
    expect(() => resolveContainedPath(root, '')).toThrow(/non-empty relative path/)
    expect(() => resolveContainedPath(root, 'a\0b')).toThrow(/NUL/)
    expect(() => resolveContainedPath(root, '.')).toThrow(/must name a file/)
    expect(() => resolveContainedPath(root, '../outside.md')).toThrow(/escapes the memory root/)
    const absolute = process.platform === 'win32' ? 'C:\\Windows\\memory.md' : '/etc/passwd'
    expect(() => resolveContainedPath(root, absolute)).toThrow(/escapes the memory root/)
  })

  it('hides watermark, lock, and temp siblings', () => {
    expect(isHiddenMemoryPath('state.json')).toBe(true)
    expect(isHiddenMemoryPath('notes/state.json')).toBe(true)
    expect(isHiddenMemoryPath('MEMORY.md.lock')).toBe(true)
    expect(isHiddenMemoryPath('MEMORY.md.tmp')).toBe(true)
    expect(isHiddenMemoryPath('MEMORY.md')).toBe(false)
  })

  it('sanitizes slugs and stamps note filenames', () => {
    expect(sanitizeSlug('  Hello, World!!  ')).toBe('hello-world')
    expect(sanitizeSlug('***')).toBe('note')
    expect(noteFileName(new Date('2026-08-18T07:08:09.000Z'), 'pref')).toBe('2026-08-18T07-08-09-pref.md')
  })

  it('validates skill names and stamps the summary version line', () => {
    expect(isSkillName('mail-style')).toBe(true)
    expect(isSkillName('Mail')).toBe(false)
    expect(skillFilePath('mail-style')).toBe('skills/mail-style/SKILL.md')
    expect(() => skillFilePath('Nope')).toThrow(/invalid memory skill name/)
    expect(withSummaryVersion('hello')).toBe(`${SUMMARY_VERSION_LINE}\nhello\n`)
    expect(withSummaryVersion('hello\n')).toBe(`${SUMMARY_VERSION_LINE}\nhello\n`)
    expect(withSummaryVersion('v1')).toBe('v1\n')
    expect(withSummaryVersion('v1\nalready')).toBe('v1\nalready\n')
    expect(withSummaryVersion('\ufeffv1\n')).toBe('v1\n')
    expect(withSummaryVersion('')).toBe('v1\n')
  })
})

describe('dsh-memory redact', () => {
  it('replaces credential-shaped spans', () => {
    const text = [
      'sk-abcdefghijklmnopqrstuvwxyz',
      'Bearer abcdefghijklmnop',
      'AKIAIOSFODNN7EXAMPLE',
      '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
      'api_key=supersecretvalue',
    ].join('\n')
    const redacted = redactMemoryText(text)
    expect(redacted).not.toContain('sk-abcdefghijklmnopqrstuvwxyz')
    expect(redacted).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(redacted).not.toContain('supersecretvalue')
    expect(redacted).toContain('[redacted]')
  })
})

describe('dsh-memory state.json', () => {
  it('rejects malformed watermark documents', () => {
    expect(() => parseMemoryState('null')).toThrow(/must be an object/)
    expect(() => parseMemoryState('[]')).toThrow(/must be an object/)
    expect(() => parseMemoryState('{"version":2,"sessions":{}}')).toThrow(/unsupported memory state version/)
    expect(() => parseMemoryState('{"version":1,"sessions":[]}')).toThrow(/sessions must be an object/)
    expect(() => parseMemoryState('{"version":1,"sessions":{"s":[]}}')).toThrow(/must be an object/)
    expect(() => parseMemoryState('{"version":1,"sessions":{"s":{"lastTurn":-1}}}')).toThrow(/invalid lastTurn/)
    expect(() => parseMemoryState('{"version":1,"sessions":{"s":{}}}')).toThrow(/invalid lastTurn/)
    expect(parseMemoryState('{"version":1}')).toEqual({ version: 1, sessions: {} })
    expect(parseMemoryState('{"version":1,"sessions":{"a":{"lastTurn":2}}}')).toEqual({
      version: 1,
      sessions: { a: { lastTurn: 2 } },
    })
  })
})

describe('MemoryStore', () => {
  it('defaults projectDir through the schemastery Config and the constructor', async () => {
    expect(MemoryStore.Config({ userRoot: '/tmp/memory-user' })).toMatchObject({
      userRoot: '/tmp/memory-user',
      projectDir: '.dsh/memory',
    })
    const userRoot = await tempRoot()
    const ctx = new Context()
    const store = new MemoryStore(ctx, { userRoot })
    expect(store.rootFor('user')).toBe(userRoot)
  })

  it('rejects empty roots at construction', async () => {
    const ctx = new Context()
    await expect(ctx.plugin(MemoryStore, { userRoot: '  ' })).rejects.toThrow(/userRoot must be a non-empty path/)
    const userRoot = await tempRoot()
    await expect(ctx.plugin(MemoryStore, { userRoot, projectDir: '  ' })).rejects.toThrow(/projectDir must be a non-empty path/)
  })

  it('treats a missing tree as empty and hides host-private files', async () => {
    const { ctx, userRoot } = await setup()
    expect(await ctx.memory.list('user')).toEqual([])
    expect(await ctx.memory.search('user', 'anything')).toEqual([])
    expect(await ctx.memory.readSummary('user')).toBe('')
    expect(ctx.memory.promptSummary('user')).toBe('')
    await writeFile(join(userRoot, 'state.json'), '{"version":1,"sessions":{}}\n')
    await writeFile(join(userRoot, 'MEMORY.md.lock'), 'lock\n')
    expect(await ctx.memory.list('user')).toEqual([])
    await expect(ctx.memory.read('user', 'state.json')).rejects.toThrow(/not readable by tools/)
  })

  it('writes notes, lists, searches, and reads them', async () => {
    const { ctx } = await setup()
    const path = await ctx.memory.writeNote('user', { content: '  prefer dark theme  ', slug: 'theme' })
    expect(path).toMatch(/^notes\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-theme\.md$/)
    const files = await ctx.memory.list('user')
    expect(files.map(file => file.path)).toEqual([path])
    const hits = await ctx.memory.search('user', 'dark')
    expect(hits).toEqual([{ path, line: 1, text: 'prefer dark theme' }])
    expect(await ctx.memory.read('user', path)).toBe('prefer dark theme\n')
    expect(await ctx.memory.listPendingNotes('user')).toEqual([path])
  })

  it('redacts secrets in notes and rejects empty search/read paths', async () => {
    const { ctx } = await setup()
    const path = await ctx.memory.writeNote('user', { content: 'token=abcdefghijkl' })
    expect(await ctx.memory.read('user', path)).toContain('[redacted]')
    await expect(ctx.memory.search('user', '   ')).rejects.toThrow(/non-empty string/)
    await expect(ctx.memory.read('user', 'missing.md')).rejects.toThrow(/memory file not found/)
    await expect(ctx.memory.writeNote('user', { content: '   ' })).rejects.toThrow(/non-empty string/)
  })

  it('truncates oversized search lines and reads', async () => {
    const { ctx, userRoot } = await setup()
    const longLine = `needle ${'x'.repeat(MAX_SEARCH_LINE_CHARS)}`
    await mkdir(userRoot, { recursive: true })
    await writeFile(join(userRoot, 'MEMORY.md'), `${longLine}\n`)
    const hits = await ctx.memory.search('user', 'needle')
    expect(hits[0]?.text.endsWith('…')).toBe(true)
    const huge = 'a'.repeat(MAX_READ_BYTES + 50)
    await writeFile(join(userRoot, 'raw_memories.md'), huge)
    const read = await ctx.memory.read('user', 'raw_memories.md')
    expect(read.endsWith('\n…(truncated)')).toBe(true)
  })

  it('caps search hits and walks nested markdown while hiding nested watermarks', async () => {
    const { ctx, userRoot } = await setup()
    const lines = Array.from({ length: MAX_SEARCH_HITS + 5 }, (_, index) => `hit ${String(index)}`)
    await writeFile(join(userRoot, 'MEMORY.md'), `${lines.join('\n')}\n`)
    expect((await ctx.memory.search('user', 'hit')).length).toBe(MAX_SEARCH_HITS)
    await mkdir(join(userRoot, 'notes', 'extra'), { recursive: true })
    await writeFile(join(userRoot, 'notes', 'extra', 'nested.md'), 'nested needle\n')
    await writeFile(join(userRoot, 'notes', 'state.json'), '{"version":1}\n')
    expect((await ctx.memory.list('user')).map(file => file.path)).toContain('notes/extra/nested.md')
    expect((await ctx.memory.list('user')).map(file => file.path).some(path => path.endsWith('state.json'))).toBe(false)
    expect(await ctx.memory.search('user', 'nested needle')).toEqual([
      { path: 'notes/extra/nested.md', line: 1, text: 'nested needle' },
    ])
  })

  it('propagates non-ENOENT file reads', async () => {
    const { ctx, userRoot } = await setup()
    await mkdir(join(userRoot, 'folder.md'))
    await expect(ctx.memory.read('user', 'folder.md')).rejects.toThrow()
    await mkdir(join(userRoot, 'memory_summary.md'))
    await expect(ctx.memory.readSummary('user')).rejects.toThrow()
    expect(() => ctx.memory.promptSummary('user')).toThrow()
    await mkdir(join(userRoot, 'raw_memories.md'))
    await expect(ctx.memory.appendRawMemory('user', 'later')).rejects.toThrow()
  })

  it('appends raw memory, writes summaries, and replaces the handbook', async () => {
    const { ctx, userRoot } = await setup()
    await ctx.memory.appendRawMemory('user', 'first fact')
    await ctx.memory.appendRawMemory('user', 'second fact')
    expect(await ctx.memory.read('user', 'raw_memories.md')).toContain('---')
    await expect(ctx.memory.writeSessionSummary('user', 'blank', '   ')).rejects.toThrow(/non-empty string/)
    const summaryPath = await ctx.memory.writeSessionSummary('user', 'Turn One', 'recap')
    expect(summaryPath).toBe('session_summaries/turn-one.md')
    await ctx.memory.writeHandbook('user', {
      memoryMd: 'User likes tea.',
      memorySummaryMd: 'likes tea',
      skills: [{ name: 'tea-order', content: 'Always order oolong.' }],
    })
    expect(await ctx.memory.read('user', 'MEMORY.md')).toBe('User likes tea.\n')
    expect(await ctx.memory.readSummary('user')).toBe('v1\nlikes tea\n')
    expect(ctx.memory.promptSummary('user')).toContain('likes tea')
    expect(await ctx.memory.read('user', 'skills/tea-order/SKILL.md')).toContain('oolong')
    expect(await readFile(join(userRoot, 'memory_summary.md'), 'utf8')).toMatch(/^v1\n/)
    await ctx.memory.writeHandbook('user', { memoryMd: 'No skills.', memorySummaryMd: 'none' })
    expect(await ctx.memory.read('user', 'MEMORY.md')).toBe('No skills.\n')
  })

  it('moves pending notes after a successful consolidate', async () => {
    const { ctx } = await setup()
    const path = await ctx.memory.writeNote('user', { content: 'remember the badge color' })
    await ctx.memory.markNotesProcessed('user', [path])
    expect(await ctx.memory.listPendingNotes('user')).toEqual([])
    expect((await ctx.memory.list('user')).some(file => file.path.startsWith('notes/processed/'))).toBe(true)
    await expect(ctx.memory.markNotesProcessed('user', ['MEMORY.md'])).rejects.toThrow(/not a pending inbox path/)
  })

  it('requires a cwd for project scope and stores project files under it', async () => {
    const { ctx } = await setup()
    const project = await tempRoot()
    expect(() => ctx.memory.rootFor('project')).toThrow(/working directory/)
    const path = await ctx.memory.writeNote('project', { content: 'repo uses pnpm' }, project)
    expect(await ctx.memory.read('project', path, project)).toContain('pnpm')
    expect(await ctx.memory.list('project', project)).toHaveLength(1)
  })

  it('tracks per-session watermarks on the user root', async () => {
    const { ctx } = await setup()
    expect(await ctx.memory.lastTurn('sess-1')).toBe(0)
    await ctx.memory.setLastTurn('sess-1', 3)
    expect(await ctx.memory.lastTurn('sess-1')).toBe(3)
    await ctx.memory.setLastTurn('sess-2', 1)
    expect(await ctx.memory.lastTurn('sess-1')).toBe(3)
    await expect(ctx.memory.lastTurn('sess-1')).resolves.toBe(3)
    await writeFile(join((ctx.memory.rootFor('user')), 'state.json'), 'not-json')
    await expect(ctx.memory.lastTurn('sess-1')).rejects.toThrow()
    expect(() => {
      void ctx.memory.setLastTurn('sess-1', -1)
    }).toThrow(/non-negative integer/)
  })

  it('propagates a watermark path that is a directory', async () => {
    const { ctx, userRoot } = await setup()
    await mkdir(join(userRoot, 'state.json'))
    await expect(ctx.memory.lastTurn('sess-1')).rejects.toThrow()
  })

  it('rejects already-processed note paths', async () => {
    const { ctx } = await setup()
    await expect(ctx.memory.markNotesProcessed('user', ['notes/processed/done.md'])).rejects.toThrow(/not a pending inbox path/)
  })

  it('ignores empty raw appends after redaction', async () => {
    const { ctx } = await setup()
    await ctx.memory.appendRawMemory('user', '   ')
    expect(await ctx.memory.list('user')).toEqual([])
  })
})

describe('MemoryStore file modes', () => {
  it('creates owner-only files when the platform honors mode', async () => {
    if (process.platform === 'win32') return
    const { ctx, userRoot } = await setup()
    await ctx.memory.writeNote('user', { content: 'unix mode' })
    const info = await stat(join(userRoot, (await ctx.memory.list('user'))[0]!.path))
    expect(info.mode & 0o777).toBe(0o600)
    await chmod(userRoot, 0o700)
  })
})
