/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import { api } from '@/lib/api'
import type {
  GeneratedImage,
  ImageStudioKey,
  ImageStudioRequest,
  ImageStudioResult,
  OutputFormat,
} from './types'

export const IMAGE_STUDIO_MODEL = 'gpt-image-2'

type UnknownRecord = Record<string, unknown>

export async function getImageStudioKeys(
  model = IMAGE_STUDIO_MODEL
): Promise<ImageStudioKey[]> {
  const res = await api.get('/api/image-studio/keys', {
    params: { model },
  })
  const data = res.data?.data
  return Array.isArray(data) ? data : []
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function toImageSrc(value: unknown, outputFormat: OutputFormat) {
  const image = asString(value)
  if (!image) return undefined
  if (
    image.startsWith('data:image/') ||
    image.startsWith('http://') ||
    image.startsWith('https://')
  ) {
    return image
  }
  return `data:image/${outputFormat};base64,${image}`
}

function collectImageFromRecord(
  record: UnknownRecord,
  outputFormat: OutputFormat
): GeneratedImage | undefined {
  const src =
    toImageSrc(record.b64_json, outputFormat) ||
    toImageSrc(record.url, outputFormat) ||
    toImageSrc(record.image, outputFormat) ||
    toImageSrc(record.base64, outputFormat) ||
    toImageSrc(record.result, outputFormat)

  if (!src) return undefined

  return {
    revisedPrompt:
      asString(record.revised_prompt) || asString(record.revisedPrompt),
    src,
  }
}

function collectFromArray(
  value: unknown,
  outputFormat: OutputFormat
): GeneratedImage[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item): GeneratedImage[] => {
    const src = toImageSrc(item, outputFormat)
    if (src) return [{ src }]
    if (!isRecord(item)) return []

    const image = collectImageFromRecord(item, outputFormat)
    if (image) return [image]

    return [
      ...collectFromArray(item.data, outputFormat),
      ...collectFromArray(item.images, outputFormat),
      ...collectFromArray(item.output, outputFormat),
      ...collectFromArray(item.content, outputFormat),
    ]
  })
}

function extractGeneratedImages(
  payload: unknown,
  outputFormat: OutputFormat
): GeneratedImage[] {
  if (!isRecord(payload)) return []
  const image = collectImageFromRecord(payload, outputFormat)
  const images = [
    ...collectFromArray(payload.data, outputFormat),
    ...collectFromArray(payload.images, outputFormat),
    ...collectFromArray(payload.output, outputFormat),
    ...collectFromArray(payload.content, outputFormat),
  ]
  return image ? [image, ...images] : images
}

function getApiError(payload: unknown) {
  if (!isRecord(payload)) return undefined
  if (isRecord(payload.error)) {
    return asString(payload.error.message) || asString(payload.error.type)
  }
  return (
    asString(payload.error) ||
    asString(payload.message) ||
    asString(payload.msg) ||
    asString(payload.detail)
  )
}

function getPayloadField(payload: unknown, key: string) {
  return isRecord(payload) ? payload[key] : undefined
}

async function parseImageResponse(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as unknown
  if (!response.ok) {
    throw new Error(getApiError(payload) || `Request failed (${response.status})`)
  }
  const error = getApiError(payload)
  if (error) throw new Error(error)
  return payload
}

async function requestSingleImage(
  request: ImageStudioRequest,
  endpoint: string,
  headers: Headers,
  hasImages: boolean
) {
  let body: BodyInit
  if (hasImages) {
    const formData = new FormData()
    formData.set('model', IMAGE_STUDIO_MODEL)
    formData.set('prompt', request.prompt)
    formData.set('n', '1')
    formData.set('size', request.size)
    formData.set('quality', request.quality)
    formData.set('background', request.background)
    formData.set('output_format', request.outputFormat)
    request.images.forEach((image) => formData.append('image', image))
    body = formData
  } else {
    const requestHeaders = new Headers(headers)
    requestHeaders.set('Content-Type', 'application/json')
    headers = requestHeaders
    body = JSON.stringify({
      background: request.background,
      model: IMAGE_STUDIO_MODEL,
      n: 1,
      output_format: request.outputFormat,
      prompt: request.prompt,
      quality: request.quality,
      size: request.size,
    })
  }

  const response = await fetch(endpoint, {
    body,
    credentials: 'include',
    headers,
    method: 'POST',
  })
  return parseImageResponse(response)
}

export async function generateImage(
  request: ImageStudioRequest
): Promise<ImageStudioResult> {
  const hasImages = request.images.length > 0
  const headers = new Headers({
    Authorization: `Bearer ${request.apiKey}`,
  })
  const uid = window.localStorage.getItem('uid')
  if (uid) headers.set('New-Api-User', uid)
  const endpoint = hasImages ? '/v1/images/edits' : '/v1/images/generations'

  const payloads = await Promise.all(
    Array.from({ length: request.imageCount }, () =>
      requestSingleImage(request, endpoint, headers, hasImages)
    )
  )
  const images = payloads.flatMap((payload) =>
    extractGeneratedImages(payload, request.outputFormat).slice(0, 1)
  )
  const firstPayload = payloads[0]

  if (!images.length) {
    throw new Error('No image data was returned by the upstream provider.')
  }

  return {
    background: getPayloadField(firstPayload, 'background'),
    created: getPayloadField(firstPayload, 'created'),
    images,
    model: IMAGE_STUDIO_MODEL,
    outputFormat: request.outputFormat,
    quality: String(getPayloadField(firstPayload, 'quality') || request.quality),
    requestedCount: request.imageCount,
    size: String(getPayloadField(firstPayload, 'size') || request.size),
    sourceCount: request.images.length,
  }
}
