import { constants, existsSync } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'

import type {
  AssetContext,
  BundleAssetPayload,
  DecodedProjectContainer,
  ResolvedAssetSource,
} from './types.ts'
import type { ImageAsset, Layer, TextVideoAsset, TextVideoProject } from './schema.ts'
import { isGroupLayer, isImageLayer } from './type-guards.ts'

const TEXT_VIDEO_PREFIX = 'text-video://asset/'

export function indexProjectAssets(project: TextVideoProject): Map<string, TextVideoAsset> {
  const map = new Map<string, TextVideoAsset>()
  for (let index = 0; index < project.assets.length; index++) {
    const asset = project.assets[index]!
    map.set(asset.id, asset)
  }
  return map
}

export function getAssetMimeType(asset: TextVideoAsset): string | undefined {
  if (asset.type === 'font') return 'font/ttf'
  return asset.mimeType
}

function isExternalUrl(value: string): boolean {
  return /^(?:[a-z]+:)?\/\//i.test(value) || value.startsWith('data:')
}

function normalizeAssetReference(reference: string): string {
  return reference.startsWith(TEXT_VIDEO_PREFIX) ? reference.slice(TEXT_VIDEO_PREFIX.length) : reference
}

export function getBundleAssetKey(assetId: string): string {
  return `${TEXT_VIDEO_PREFIX}${assetId}`
}

export function shouldEmbedAsset(asset: TextVideoAsset): boolean {
  if (asset.embed === false) return false
  if (!('src' in asset) || typeof asset.src !== 'string') return false
  return !isExternalUrl(asset.src)
}

export function resolveFilesystemAssetPath(asset: TextVideoAsset, projectPath?: string): string | null {
  if (!('src' in asset) || typeof asset.src !== 'string') return null
  if (isExternalUrl(asset.src)) return null
  if (projectPath !== undefined) {
    const projectRelative = path.resolve(path.dirname(projectPath), asset.src)
    if (existsSync(projectRelative)) return projectRelative
  }
  const cwdRelative = path.resolve(process.cwd(), asset.src)
  if (existsSync(cwdRelative)) return cwdRelative
  return projectPath !== undefined ? path.resolve(path.dirname(projectPath), asset.src) : cwdRelative
}

export async function resolveAssetSource(
  asset: TextVideoAsset,
  context: AssetContext = {},
): Promise<ResolvedAssetSource | null> {
  const normalizedKey = normalizeAssetReference(asset.id)
  const embedded = context.embeddedAssets?.get(normalizedKey)
  if (embedded !== undefined) {
    return {
      kind: 'embedded',
      key: embedded.key,
      data: embedded.bytes,
      mimeType: embedded.mimeType ?? getAssetMimeType(asset),
    }
  }

  const pathOnDisk = resolveFilesystemAssetPath(asset, context.projectPath)
  if (pathOnDisk !== null) {
    await access(pathOnDisk, constants.F_OK)
    return {
      kind: 'filesystem',
      path: pathOnDisk,
      mimeType: getAssetMimeType(asset),
    }
  }

  if ('src' in asset && typeof asset.src === 'string' && isExternalUrl(asset.src)) {
    return {
      kind: 'filesystem',
      path: asset.src,
      mimeType: getAssetMimeType(asset),
    }
  }

  return null
}

export async function collectEmbeddableAssets(
  project: TextVideoProject,
  projectPath?: string,
): Promise<Map<string, BundleAssetPayload>> {
  const collected = new Map<string, BundleAssetPayload>()
  for (let index = 0; index < project.assets.length; index++) {
    const asset = project.assets[index]!
    if (!shouldEmbedAsset(asset)) continue
    const absolutePath = resolveFilesystemAssetPath(asset, projectPath)
    if (absolutePath === null) continue
    const bytes = new Uint8Array(await readFile(absolutePath))
    collected.set(asset.id, {
      key: asset.id,
      bytes,
      mimeType: getAssetMimeType(asset),
      originalPath: absolutePath,
    })
  }
  return collected
}

export function asDataUri(bytes: Uint8Array, mimeType: string): string {
  const encoded = Buffer.from(bytes).toString('base64')
  return `data:${mimeType};base64,${encoded}`
}

export function decodeEmbeddedAssets(
  container: DecodedProjectContainer | null | undefined,
): Map<string, BundleAssetPayload> {
  const map = new Map<string, BundleAssetPayload>()
  if (container?.assets === undefined) return map
  for (let index = 0; index < container.assets.length; index++) {
    const asset = container.assets[index]!
    map.set(asset.id, {
      key: asset.id,
      bytes: Uint8Array.from(Buffer.from(asset.data, 'base64')),
      mimeType: asset.mediaType,
      originalPath: asset.fileName,
    })
  }
  return map
}

export function resolveProjectAssetMap(project: TextVideoProject): Map<string, TextVideoAsset> {
  return indexProjectAssets(project)
}

export async function getResolvedAssetData(
  asset: TextVideoAsset,
  context: AssetContext = {},
): Promise<Uint8Array | null> {
  const source = await resolveAssetSource(asset, context)
  if (source === null) return null
  if (source.kind === 'embedded') return source.data
  if (isExternalUrl(source.path)) return null
  return new Uint8Array(await readFile(source.path))
}

export async function resolveImageHref(
  asset: ImageAsset,
  context: AssetContext = {},
): Promise<string> {
  const source = await resolveAssetSource(asset, context)
  if (source === null) {
    throw new Error(`Unable to resolve image asset "${asset.id}"`)
  }
  if (source.kind === 'filesystem') {
    if (isExternalUrl(source.path)) return source.path
    const bytes = new Uint8Array(await readFile(source.path))
    return asDataUri(bytes, source.mimeType ?? 'image/png')
  }
  return asDataUri(source.data, source.mimeType ?? 'image/png')
}

function collectLayerAssetIds(layer: Layer, assetIds: Set<string>): void {
  if (isImageLayer(layer)) {
    assetIds.add(layer.assetId)
    return
  }
  if (isGroupLayer(layer)) {
    const groupLayer = layer
    for (let index = 0; index < groupLayer.children.length; index++) {
      collectLayerAssetIds(groupLayer.children[index]!, assetIds)
    }
  }
}

export function collectReferencedAssetIds(project: TextVideoProject): Set<string> {
  const assetIds = new Set<string>()
  for (let sceneIndex = 0; sceneIndex < project.scenes.length; sceneIndex++) {
    const scene = project.scenes[sceneIndex]!
    for (let layerIndex = 0; layerIndex < scene.layers.length; layerIndex++) {
      const layer = scene.layers[layerIndex] as Layer
      collectLayerAssetIds(layer, assetIds)
    }
  }
  return assetIds
}
