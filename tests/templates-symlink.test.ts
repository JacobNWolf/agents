import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { afterEach, expect, it } from 'vitest'
import { scaffoldBaseTemplates } from '../src/core/templates.js'
import { pathExists } from '../src/core/fs.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it.each([true, false])('preserves external template symlink targets (force=%s)', async force => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agents-template-link-'))
  roots.push(root)
  const projectRoot = path.join(root, 'project')
  const target = path.join(root, 'notes.md')
  const destination = path.join(projectRoot, '.agents/skills/docs-research/SKILL.md')
  await mkdir(path.dirname(destination), { recursive: true })
  await writeFile(target, 'private original notes\n')
  await symlink(target, destination)
  await scaffoldBaseTemplates(projectRoot, force)
  expect(await readFile(target, 'utf8')).toBe('private original notes\n')
  if (force) expect(await readFile(destination, 'utf8')).toContain('name: docs-research')
  else expect(await readlink(destination)).toBe(target)
})

it('replaces a dangling destination link without creating its external target', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agents-template-dangling-'))
  roots.push(root)
  const projectRoot = path.join(root, 'project')
  await mkdir(path.join(projectRoot, '.agents'), { recursive: true })
  const target = path.join(root, 'missing.md')
  await symlink(target, path.join(projectRoot, '.agents/README.md'))
  await scaffoldBaseTemplates(projectRoot, true)
  expect(await pathExists(target)).toBe(false)
  expect(await readFile(path.join(projectRoot, '.agents/README.md'), 'utf8')).toContain('agents')
})
