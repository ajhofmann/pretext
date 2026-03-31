import type { ContentBank } from './types.ts'
import {
  detectScript,
  getBuiltInBanks,
  parseDescriptionJson,
  parseSrt,
  parseVtt,
} from './content-shared.ts'

export {
  detectScript,
  getBuiltInBanks,
  parseDescriptionJson,
  parseSrt,
  parseVtt,
} from './content-shared.ts'

export function createInlineBank(id: string, text: string): ContentBank {
  return {
    id,
    text,
    script: detectScript(text),
  }
}
