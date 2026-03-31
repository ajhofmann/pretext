import { readFileSync } from 'node:fs'
import path from 'node:path'

import type {
  ContentBank,
  ContentCue,
  ContentCueSource,
  ContentOptions,
} from './types.ts'

type ParsedCue = {
  startSeconds: number
  endSeconds: number
  text: string
}

const knownScriptPatterns: Array<{ script: string, pattern: RegExp }> = [
  { script: 'arabic', pattern: /\p{Script=Arabic}/u },
  { script: 'hebrew', pattern: /\p{Script=Hebrew}/u },
  { script: 'devanagari', pattern: /\p{Script=Devanagari}/u },
  { script: 'thai', pattern: /\p{Script=Thai}/u },
  { script: 'khmer', pattern: /\p{Script=Khmer}/u },
  { script: 'myanmar', pattern: /\p{Script=Myanmar}/u },
  { script: 'han', pattern: /\p{Script=Han}/u },
  { script: 'hiragana', pattern: /\p{Script=Hiragana}/u },
  { script: 'katakana', pattern: /\p{Script=Katakana}/u },
  { script: 'hangul', pattern: /\p{Script=Hangul}/u },
  { script: 'latin', pattern: /\p{Script=Latin}/u },
]

const builtInCorpusBanks: ContentBank[] = [
  { id: 'mixed-app', text: readRepoText('corpora/mixed-app-text.txt'), script: 'latin' },
  { id: 'arabic-ghufran', text: readRepoText('corpora/ar-risalat-al-ghufran-part-1.txt'), script: 'arabic' },
  { id: 'arabic-bukhala', text: readRepoText('corpora/ar-al-bukhala.txt'), script: 'arabic' },
  { id: 'hindi-eidgah', text: readRepoText('corpora/hi-eidgah.txt'), script: 'devanagari' },
  { id: 'japanese-rashomon', text: readRepoText('corpora/ja-rashomon.txt'), script: 'han' },
  { id: 'japanese-kumo', text: readRepoText('corpora/ja-kumo-no-ito.txt'), script: 'han' },
  { id: 'chinese-guxiang', text: readRepoText('corpora/zh-guxiang.txt'), script: 'han' },
  { id: 'chinese-zhufu', text: readRepoText('corpora/zh-zhufu.txt'), script: 'han' },
  { id: 'korean-unsu', text: readRepoText('corpora/ko-unsu-joh-eun-nal.txt'), script: 'hangul' },
  { id: 'thai-nithan', text: readRepoText('corpora/th-nithan-vetal-story-1.txt'), script: 'thai' },
  { id: 'khmer-prachum', text: readRepoText('corpora/km-prachum-reuang-preng-khmer-volume-7-stories-1-10.txt'), script: 'khmer' },
  { id: 'myanmar-heron', text: readRepoText('corpora/my-cunning-heron-teacher.txt'), script: 'myanmar' },
  { id: 'urdu-chughd', text: readRepoText('corpora/ur-chughd.txt'), script: 'arabic' },
]

function readRepoText(relativePath: string): string {
  const absolute = path.resolve(process.cwd(), relativePath)
  return readFileSync(absolute, 'utf-8')
}

function normalizeCueText(text: string): string {
  return text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim()
}

function parseTimecode(timecode: string): number {
  const normalized = timecode.trim().replace(',', '.')
  const parts = normalized.split(':')
  if (parts.length !== 3) {
    throw new Error(`Invalid subtitle timecode: ${timecode}`)
  }
  const [hours, minutes, seconds] = parts
  return (
    Number.parseInt(hours!, 10) * 3600 +
    Number.parseInt(minutes!, 10) * 60 +
    Number.parseFloat(seconds!)
  )
}

function parsedCueToContentCue(parsed: ParsedCue, source: ContentCueSource): ContentCue {
  return {
    startSeconds: parsed.startSeconds,
    endSeconds: parsed.endSeconds,
    text: parsed.text,
    source,
    script: detectScript(parsed.text),
  }
}

export function detectScript(text: string): string {
  for (let index = 0; index < knownScriptPatterns.length; index++) {
    const entry = knownScriptPatterns[index]!
    if (entry.pattern.test(text)) return entry.script
  }
  return 'latin'
}

export function parseSrt(input: string): ContentCue[] {
  const blocks = input.replace(/\r/g, '').trim().split(/\n\s*\n/g)
  const cues: ContentCue[] = []
  for (let index = 0; index < blocks.length; index++) {
    const lines = blocks[index]!.split('\n').map(line => line.trimEnd())
    if (lines.length < 2) continue
    const timeLine = lines[1]!.includes('-->') ? lines[1]! : lines[0]!
    const textStart = timeLine === lines[1] ? 2 : 1
    const [start, end] = timeLine.split('-->').map(part => part.trim())
    if (start === undefined || end === undefined) continue
    const text = normalizeCueText(lines.slice(textStart).join('\n'))
    if (text.length === 0) continue
    cues.push(parsedCueToContentCue({
      startSeconds: parseTimecode(start),
      endSeconds: parseTimecode(end),
      text,
    }, 'subtitle'))
  }
  return cues
}

export function parseVtt(input: string): ContentCue[] {
  const normalized = input.replace(/\r/g, '').trim()
  const body = normalized.startsWith('WEBVTT') ? normalized.slice('WEBVTT'.length).trim() : normalized
  const blocks = body.split(/\n\s*\n/g)
  const cues: ContentCue[] = []
  for (let index = 0; index < blocks.length; index++) {
    const lines = blocks[index]!.split('\n').map(line => line.trimEnd())
    const timeLineIndex = lines.findIndex(line => line.includes('-->'))
    if (timeLineIndex < 0) continue
    const [start, endWithSettings] = lines[timeLineIndex]!.split('-->').map(part => part.trim())
    if (start === undefined || endWithSettings === undefined) continue
    const end = endWithSettings.split(/\s+/)[0]!
    const text = normalizeCueText(lines.slice(timeLineIndex + 1).join('\n'))
    if (text.length === 0) continue
    cues.push(parsedCueToContentCue({
      startSeconds: parseTimecode(start),
      endSeconds: parseTimecode(end),
      text,
    }, 'subtitle'))
  }
  return cues
}

export function parseDescriptionJson(input: string): ContentCue[] {
  const parsed = JSON.parse(input) as Array<{
    startSeconds: number
    endSeconds: number
    text: string
  }>
  return parsed
    .filter(entry => entry.text.trim().length > 0)
    .map(entry => ({
      startSeconds: entry.startSeconds,
      endSeconds: entry.endSeconds,
      text: entry.text.trim(),
      source: 'description' as const,
      script: detectScript(entry.text),
    }))
}

export function loadCueFile(cuePath: string): ContentCue[] {
  const absolute = path.resolve(cuePath)
  const contents = readFileSync(absolute, 'utf-8')
  if (absolute.toLowerCase().endsWith('.srt')) return parseSrt(contents)
  if (absolute.toLowerCase().endsWith('.vtt')) return parseVtt(contents)
  if (absolute.toLowerCase().endsWith('.json')) return parseDescriptionJson(contents)
  throw new Error(`Unsupported cue file: ${cuePath}`)
}

export function getBuiltInBanks(): ContentBank[] {
  return builtInCorpusBanks.map(bank => ({ ...bank }))
}

export function selectContentText(
  options: ContentOptions,
  timestampSeconds: number,
  frameIndex: number,
  cut: boolean,
): { text: string, cue: ContentCue | null, bank: ContentBank | null } {
  const activeCue = options.cues.find(cue => (
    timestampSeconds >= cue.startSeconds && timestampSeconds < cue.endSeconds
  )) ?? null

  if (activeCue !== null) {
    return { text: activeCue.text, cue: activeCue, bank: null }
  }

  const activeDescription = options.descriptions.find(cue => (
    timestampSeconds >= cue.startSeconds && timestampSeconds < cue.endSeconds
  )) ?? null
  if (activeDescription !== null) {
    return { text: activeDescription.text, cue: activeDescription, bank: null }
  }

  const banks = options.banks.length > 0 ? options.banks : getBuiltInBanks()
  if (banks.length === 0) {
    return { text: options.text, cue: null, bank: null }
  }

  if (options.cycleOnCuts || cut) {
    const bank = banks[frameIndex % banks.length]!
    return { text: bank.text, cue: null, bank }
  }

  const baseScript = detectScript(options.text)
  const bank = options.scriptMatch
    ? banks.find(candidate => candidate.script === baseScript) ?? banks[0]!
    : banks[0]!

  return {
    text: options.text.trim().length > 0 ? options.text : bank.text,
    cue: null,
    bank,
  }
}
