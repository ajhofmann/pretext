import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { decodeProjectContainer, serializeProject } from '../shared/text-video/runtime.ts'

const [, , inputArg, outputArg] = process.argv

if (!inputArg) {
  console.error('Usage: npm run text-video:decode -- <input.ptxv> [output.json]')
  process.exit(1)
}

const inputPath = path.resolve(process.cwd(), inputArg)
const outputPath = path.resolve(
  process.cwd(),
  outputArg ?? inputArg.replace(/\.ptxv$/i, '') + '.decoded.json',
)

const project = decodeProjectContainer(await readFile(inputPath)).project
await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(outputPath, serializeProject(project), 'utf8')
console.log(`Decoded ${inputPath} -> ${outputPath}`)
