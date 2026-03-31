import type { ContentBank, ContentCue, ContentOptions } from './types.ts'
import { detectScript, selectContentTextShared } from './content-shared.ts'
export { detectScript, parseDescriptionJson, parseSrt, parseVtt } from './content-shared.ts'

export function createInlineBank(id: string, text: string): ContentBank {
  return {
    id,
    text,
    script: detectScript(text),
  }
}

export function selectContentText(
  options: ContentOptions,
  timestampSeconds: number,
  frameIndex: number,
  cut: boolean,
): { text: string, cue: ContentCue | null, bank: ContentBank | null } {
  return selectContentTextShared(options, timestampSeconds, frameIndex, cut, [])
}
