/**
 * Vendoring discipline, mechanized: any staged change under a vendored package
 * `src/` tree or a vendored `bin.js` must come with a vendor/README.md change
 * in the same commit (the manifest's local-modification log is the contract —
 * see vendor/README.md).
 *
 * Node entrypoint so pre-commit works on Windows, where `bash` may be the WSL
 * launcher rather than Git Bash.
 */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

/**
 * Return staged repository paths using Git's `/` separators.
 *
 * @returns Paths currently in the index, excluding the empty trailing line.
 */
function stagedPaths(): string[] {
  const result = spawnSync('git', ['diff', '--cached', '--name-only'], {
    cwd: root,
    encoding: 'utf8',
  })
  if (result.error) {
    throw new Error(`git diff --cached --name-only failed: ${result.error.message}`, { cause: result.error })
  }
  if (result.status !== 0) {
    throw new Error(`git diff --cached --name-only failed with status ${String(result.status)}: ${result.stderr.trim()}`)
  }
  return result.stdout.split(/\r?\n/).filter(Boolean)
}

const staged = stagedPaths()
const vendorSrcChanged = staged.filter(file => /^vendor\/[^/]+\/(src\/|bin\.js)/.test(file))
const manifestChanged = staged.includes('vendor/README.md')

if (vendorSrcChanged.length > 0 && !manifestChanged) {
  console.error('vendor manifest guard: vendored SOURCE changed without updating vendor/README.md:')
  for (const file of vendorSrcChanged) console.error(`  ${file}`)
  console.error('Log the modification in vendor/README.md ("Local modifications") and stage it.')
  process.exit(1)
}
