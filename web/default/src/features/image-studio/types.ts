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

export type ImageStudioKey = {
  id: number
  name: string
  key: string
  group: string
  resolved_groups: string[]
  remain_quota: number
  unlimited_quota: boolean
  expired_time: number
}

export type GeneratedImage = {
  src: string
  revisedPrompt?: string
}

export type ImageStudioResult = {
  background?: unknown
  created?: unknown
  images: GeneratedImage[]
  model: string
  outputFormat: OutputFormat
  quality: string
  requestedCount: number
  size: string
  sourceCount: number
}

export type OutputFormat = 'png' | 'jpeg' | 'webp'
export type BackgroundMode = 'auto' | 'transparent' | 'opaque'

export type ImageStudioRequest = {
  apiKey: string
  background: BackgroundMode
  imageCount: number
  images: File[]
  outputFormat: OutputFormat
  prompt: string
  quality: string
  size: string
}
