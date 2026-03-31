import { detectScript, getBuiltInBanks, loadCueFile, parseDescriptionJson, parseSrt, parseVtt } from './content-core.ts'
import { selectContentTextShared } from './content-shared.ts'
import type { ContentBank, ContentCue, ContentOptions } from './types.ts'

export { detectScript, getBuiltInBanks, loadCueFile, parseDescriptionJson, parseSrt, parseVtt }

export function selectContentText(
  options: ContentOptions,
  timestampSeconds: number,
  frameIndex: number,
  cut: boolean,
): { text: string, cue: ContentCue | null, bank: ContentBank | null } {
  return selectContentTextShared(options, timestampSeconds, frameIndex, cut, getBuiltInBanks(), detectScript)
}
