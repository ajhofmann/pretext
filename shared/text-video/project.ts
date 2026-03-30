import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  decodeProjectContainer,
  isLegacyProjectContainer,
} from './container.ts'
import { textVideoProjectSchema } from './schema.ts'
import type { DecodedProjectContainer, LoadedProject } from './types.ts'
import type { TextVideoProject } from './schema.ts'

export function parseProject(input: string): TextVideoProject {
  return textVideoProjectSchema.parse(JSON.parse(input))
}

export function parseProjectJson(input: string): TextVideoProject {
  return parseProject(input)
}

export function serializeProject(project: TextVideoProject): string {
  return `${JSON.stringify(textVideoProjectSchema.parse(project), null, 2)}\n`
}

export async function readProjectFromPath(inputPath: string): Promise<LoadedProject> {
  const absoluteProjectPath = path.resolve(process.cwd(), inputPath)
  const buffer = await readFile(absoluteProjectPath)

  if (absoluteProjectPath.toLowerCase().endsWith('.ptxv') || isLegacyProjectContainer(buffer)) {
    const container: DecodedProjectContainer = decodeProjectContainer(buffer)
    return {
      project: container.project,
      absoluteProjectPath,
      container,
    }
  }

  return {
    project: parseProject(buffer.toString('utf8')),
    absoluteProjectPath,
    container: null,
  }
}

export async function decodeProjectBundle(inputPath: string): Promise<TextVideoProject> {
  const absolutePath = path.resolve(process.cwd(), inputPath)
  const buffer = await readFile(absolutePath)
  return decodeProjectContainer(buffer).project
}

export async function writeProjectFile(pathname: string, project: TextVideoProject): Promise<void> {
  await writeFile(pathname, serializeProject(project), 'utf8')
}
