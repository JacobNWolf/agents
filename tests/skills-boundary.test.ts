import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { afterEach, expect, it } from 'vitest'
import { syncSkills } from '../src/core/skills.js'
import { pathExists } from '../src/core/fs.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it.each(['skill', 'group'])('rejects an external %s directory before copying its contents', async kind => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agents-skill-boundary-'))
  roots.push(root)
  const projectRoot = path.join(root, 'project')
  const source = path.join(projectRoot, '.agents/skills')
  const outside = path.join(root, 'outside')
  const skill = kind === 'group' ? path.join(outside, 'private-skill') : outside
  await mkdir(source, { recursive: true })
  await mkdir(skill, { recursive: true })
  await writeFile(path.join(skill, 'SKILL.md'), '---\nname: private-skill\ndescription: fixture\n---\n')
  await writeFile(path.join(skill, 'private.txt'), 'fixture private data')
  await symlink(outside, path.join(source, 'linked'))
  const changed: string[] = []
  const warnings: string[] = []
  await syncSkills({ projectRoot, enabledIntegrations: ['antigravity'], check: false, changed, warnings })
  expect(await pathExists(path.join(projectRoot, '.gemini/skills/private-skill/private.txt'))).toBe(false)
  expect(await pathExists(path.join(projectRoot, '.gemini/skills/linked/private.txt'))).toBe(false)
  expect(warnings.join(' ')).toContain('outside')
})
