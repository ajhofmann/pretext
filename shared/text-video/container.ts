import { gunzipSync, gzipSync } from 'node:zlib'

import { parseProjectJson, serializeProject } from './project.ts'
import type { DecodedProjectContainer, EmbeddedAssetRecord, TextVideoBundle } from './types.ts'
import type { TextVideoProject } from './schema.ts'

const LEGACY_MAGIC = 'PTXV1'
const BUNDLE_MAGIC = 'PTXV2'

export function isLegacyProjectContainer(buffer: Buffer): boolean {
  return buffer.subarray(0, LEGACY_MAGIC.length).toString('utf8') === LEGACY_MAGIC
}

export function encodeLegacyProjectContainer(project: TextVideoProject): Buffer {
  const payload = Buffer.from(serializeProject(project), 'utf8')
  const compressed = gzipSync(payload, { level: 9 })
  return Buffer.concat([Buffer.from(LEGACY_MAGIC, 'utf8'), compressed])
}

export function encodeProjectBundle(
  project: TextVideoProject,
  assets: EmbeddedAssetRecord[] = [],
): Buffer {
  const bundle: TextVideoBundle = {
    format: 'pretext-text-video-bundle',
    version: 2,
    project: serializeProject(project),
    assets,
  }
  const payload = Buffer.from(JSON.stringify(bundle), 'utf8')
  const compressed = gzipSync(payload, { level: 9 })
  return Buffer.concat([Buffer.from(BUNDLE_MAGIC, 'utf8'), compressed])
}

export function decodeProjectBundleBuffer(
  buffer: Buffer,
): { project: TextVideoProject, assets: EmbeddedAssetRecord[] } {
  const magic = buffer.subarray(0, BUNDLE_MAGIC.length).toString('utf8')
  if (magic === BUNDLE_MAGIC) {
    const json = gunzipSync(buffer.subarray(BUNDLE_MAGIC.length)).toString('utf8')
    const bundle = JSON.parse(json) as TextVideoBundle
    if (bundle.format !== 'pretext-text-video-bundle' || bundle.version !== 2) {
      throw new Error('Unsupported .ptxv bundle manifest.')
    }
    return {
      project: parseProjectJson(bundle.project),
      assets: bundle.assets,
    }
  }

  if (isLegacyProjectContainer(buffer)) {
    const json = gunzipSync(buffer.subarray(LEGACY_MAGIC.length)).toString('utf8')
    return {
      project: parseProjectJson(json),
      assets: [],
    }
  }

  throw new Error('Invalid .ptxv file header.')
}

export function decodeProjectContainer(buffer: Buffer): DecodedProjectContainer {
  const magic = buffer.subarray(0, BUNDLE_MAGIC.length).toString('utf8')
  if (magic === BUNDLE_MAGIC) {
    const decoded = decodeProjectBundleBuffer(buffer)
    return {
      version: 2,
      project: decoded.project,
      assets: decoded.assets,
      bundle: {
        format: 'pretext-text-video-bundle',
        version: 2,
        project: serializeProject(decoded.project),
        assets: decoded.assets,
      },
    }
  }
  if (isLegacyProjectContainer(buffer)) {
    const decoded = decodeProjectBundleBuffer(buffer)
    return {
      version: 1,
      project: decoded.project,
      assets: [],
      bundle: null,
    }
  }
  throw new Error('Invalid .ptxv file header.')
}
