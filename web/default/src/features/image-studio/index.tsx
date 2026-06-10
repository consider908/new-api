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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  Download,
  ImageIcon,
  Images,
  KeyRound,
  LoaderCircle,
  Paintbrush,
  Plus,
  RefreshCw,
  Sparkles,
  WandSparkles,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { fetchTokenKey } from '@/features/keys/api'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { IMAGE_STUDIO_MODEL, generateImage, getImageStudioKeys } from './api'
import type {
  GeneratedImage,
  ImageStudioKey,
  ImageStudioResult,
  OutputFormat,
} from './types'

const MAX_UPLOADS = 4
const MAX_FILE_SIZE = 10 * 1024 * 1024
const MIN_CUSTOM_DIMENSION = 64
const MAX_CUSTOM_DIMENSION = 8192
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])
const SIZE_OPTIONS = [
  'auto',
  '1024x1024',
  '1536x1024',
  '1024x1536',
  '2048x2048',
  '2048x1152',
  '3840x2160',
  '2160x3840',
]
const IMAGE_COUNT_OPTIONS = [1, 2, 3, 4]
const QUALITY_OPTIONS = ['auto', 'low', 'medium', 'high', 'standard', 'hd']
const OUTPUT_FORMAT_OPTIONS: OutputFormat[] = ['png', 'jpeg', 'webp']

function normalizeCustomSize(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '').replace(/×/g, 'x')
  const match = /^([1-9]\d{1,4})x([1-9]\d{1,4})$/.exec(normalized)
  if (!match) return ''
  const width = Number(match[1])
  const height = Number(match[2])
  if (
    width < MIN_CUSTOM_DIMENSION ||
    width > MAX_CUSTOM_DIMENSION ||
    height < MIN_CUSTOM_DIMENSION ||
    height > MAX_CUSTOM_DIMENSION
  ) {
    return ''
  }
  return `${width}x${height}`
}

function getImageAspect(size: string) {
  const normalized = size === 'auto' ? '1024x1024' : normalizeCustomSize(size)
  if (!normalized) return '1 / 1'
  const [width, height] = normalized.split('x').map(Number)
  return `${width} / ${height}`
}

function formatQuota(key: ImageStudioKey, t: (key: string) => string) {
  if (key.unlimited_quota) return t('Unlimited')
  return key.remain_quota.toLocaleString()
}

export function ImageStudio() {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [selectedKeyId, setSelectedKeyId] = useState<string>('')
  const [prompt, setPrompt] = useState('')
  const [imageCount, setImageCount] = useState(1)
  const [size, setSize] = useState('1024x1024')
  const [customSize, setCustomSize] = useState('')
  const [quality, setQuality] = useState('auto')
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('png')
  const [sourceImages, setSourceImages] = useState<File[]>([])
  const [result, setResult] = useState<ImageStudioResult | null>(null)
  const [selectedImageIndex, setSelectedImageIndex] = useState(0)

  const keysQuery = useQuery({
    queryKey: ['image-studio-keys', IMAGE_STUDIO_MODEL],
    queryFn: () => getImageStudioKeys(IMAGE_STUDIO_MODEL),
  })

  const keys = keysQuery.data ?? []
  const selectedKey = keys.find((item) => String(item.id) === selectedKeyId)
  const resolvedSize = size === 'custom' ? normalizeCustomSize(customSize) : size
  const canSubmit = Boolean(selectedKey && prompt.trim() && resolvedSize)

  const selectedImage = result?.images[selectedImageIndex] ?? null

  const generationMutation = useMutation({
    mutationFn: async () => {
      if (!selectedKey) throw new Error('Select an API key first.')
      const keyResult = await fetchTokenKey(selectedKey.id)
      if (!keyResult.success || !keyResult.data?.key) {
        throw new Error(keyResult.message || 'Failed to load API key')
      }
      return generateImage({
        apiKey: keyResult.data.key,
        background: 'auto',
        imageCount,
        images: sourceImages,
        outputFormat,
        prompt,
        quality,
        size: resolvedSize,
      })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? t(error.message) : t('Image generation failed'))
    },
    onSuccess: (data) => {
      setResult(data)
      setSelectedImageIndex(0)
      toast.success(t('Images generated successfully.'))
    },
  })

  const previews = useMemo(
    () =>
      sourceImages.map((file) => ({
        file,
        url: URL.createObjectURL(file),
      })),
    [sourceImages]
  )

  useEffect(() => {
    return () => {
      previews.forEach((preview) => URL.revokeObjectURL(preview.url))
    }
  }, [previews])

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const next = [...sourceImages]
      for (const file of Array.from(files)) {
        if (next.length >= MAX_UPLOADS) {
          toast.error(t('You can upload up to 4 reference images.'))
          break
        }
        if (!ACCEPTED_TYPES.has(file.type)) {
          toast.error(t('Only JPEG, PNG, and WebP images are supported.'))
          continue
        }
        if (file.size > MAX_FILE_SIZE) {
          toast.error(t('Each reference image must be 10 MB or smaller.'))
          continue
        }
        next.push(file)
      }
      setSourceImages(next)
    },
    [sourceImages, t]
  )

  const useGeneratedAsSource = async (image: GeneratedImage) => {
    try {
      const response = await fetch(image.src)
      const blob = await response.blob()
      const file = new File([blob], `image-studio-source.${outputFormat}`, {
        type: blob.type || `image/${outputFormat}`,
      })
      setSourceImages([file])
      toast.success(t('Selected image is ready as a reference.'))
    } catch {
      toast.error(t('Failed to prepare the selected image.'))
    }
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-y-auto bg-background'>
      <div className='border-b px-4 py-4 lg:px-6'>
        <div className='flex flex-col gap-3 md:flex-row md:items-center md:justify-between'>
          <div className='min-w-0'>
            <div className='flex flex-wrap items-center gap-2'>
              <h1 className='text-xl font-semibold tracking-tight'>{t('Image Studio')}</h1>
              <Badge variant='secondary' className='rounded-md font-mono'>
                {IMAGE_STUDIO_MODEL}
              </Badge>
            </div>
            <p className='mt-1 text-sm text-muted-foreground'>
              {t('Create and iterate images through your configured relay channels.')}
            </p>
          </div>
          <Button
            variant='outline'
            className='h-9 rounded-md'
            onClick={() => keysQuery.refetch()}
            disabled={keysQuery.isFetching}
          >
            <RefreshCw className={cn('size-4', keysQuery.isFetching && 'animate-spin')} />
            {t('Refresh keys')}
          </Button>
        </div>
      </div>

      <div className='grid flex-1 gap-4 p-4 lg:grid-cols-[360px_minmax(0,1fr)] lg:p-6'>
        <aside className='flex min-w-0 flex-col gap-4'>
          <Card className='rounded-lg'>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <KeyRound className='size-4 text-primary' />
                {t('API key')}
              </CardTitle>
              <CardDescription>
                {t('Only keys whose group can access gpt-image-2 are shown.')}
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-3'>
              <Select
                value={selectedKeyId}
                onValueChange={(value) => {
                  if (value) setSelectedKeyId(value)
                }}
              >
                <SelectTrigger className='h-10 w-full rounded-md'>
                  <SelectValue placeholder={t('Select an API key')}>
                    {selectedKey?.name}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align='start'>
                  {keys.map((key) => (
                    <SelectItem key={key.id} value={String(key.id)}>
                      <span className='min-w-0 truncate'>{key.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {keysQuery.isLoading ? (
                <Skeleton className='h-16 rounded-md' />
              ) : selectedKey ? (
                <div className='rounded-md border bg-muted/30 p-3 text-xs'>
                  <div className='flex items-center justify-between gap-3'>
                    <span className='text-muted-foreground'>{t('Key')}</span>
                    <span className='font-mono'>{selectedKey.key}</span>
                  </div>
                  <div className='mt-2 flex items-center justify-between gap-3'>
                    <span className='text-muted-foreground'>{t('Quota')}</span>
                    <span>{formatQuota(selectedKey, t)}</span>
                  </div>
                  <div className='mt-2 flex items-center justify-between gap-3'>
                    <span className='text-muted-foreground'>{t('Groups')}</span>
                    <span className='truncate text-right'>
                      {selectedKey.resolved_groups.join(', ') || selectedKey.group || 'default'}
                    </span>
                  </div>
                </div>
              ) : (
                <Empty className='min-h-32 rounded-md border'>
                  <EmptyHeader>
                    <EmptyTitle>{t('No eligible API keys')}</EmptyTitle>
                    <EmptyDescription>
                      {t('Create or update an API key whose group can use gpt-image-2.')}
                    </EmptyDescription>
                  </EmptyHeader>
                  <Link className={buttonVariants({ variant: 'outline', size: 'sm' })} to='/keys'>
                    <Plus className='size-4' />
                    {t('Manage API keys')}
                  </Link>
                </Empty>
              )}
            </CardContent>
          </Card>

          <Card className='rounded-lg'>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <Paintbrush className='size-4 text-primary' />
                {t('Prompt')}
              </CardTitle>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='space-y-2'>
                <Label htmlFor='image-studio-prompt'>{t('Prompt')}</Label>
                <Textarea
                  id='image-studio-prompt'
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder={t('Describe the image you want to create...')}
                  className='min-h-32 resize-y rounded-md'
                />
              </div>

              <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2'>
                <Select
                  value={String(imageCount)}
                  onValueChange={(value) => {
                    if (value) setImageCount(Number(value))
                  }}
                >
                  <SelectTrigger className='h-10 w-full rounded-md'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align='start'>
                    {IMAGE_COUNT_OPTIONS.map((count) => (
                      <SelectItem key={count} value={String(count)}>
                        {count}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={size}
                  onValueChange={(value) => {
                    if (value) setSize(value)
                  }}
                >
                  <SelectTrigger className='h-10 w-full rounded-md'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align='start'>
                    {SIZE_OPTIONS.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                    <SelectItem value='custom'>{t('Custom size')}</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={quality}
                  onValueChange={(value) => {
                    if (value) setQuality(value)
                  }}
                >
                  <SelectTrigger className='h-10 w-full rounded-md'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align='start'>
                    {QUALITY_OPTIONS.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={outputFormat}
                  onValueChange={(value) => {
                    if (value) setOutputFormat(value as OutputFormat)
                  }}
                >
                  <SelectTrigger className='h-10 w-full rounded-md'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align='start'>
                    {OUTPUT_FORMAT_OPTIONS.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item.toUpperCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {size === 'custom' && (
                <div className='space-y-2'>
                  <Label htmlFor='image-studio-custom-size'>{t('Custom size')}</Label>
                  <Input
                    id='image-studio-custom-size'
                    value={customSize}
                    onChange={(event) => setCustomSize(event.target.value)}
                    placeholder='1280x720'
                    className='h-10 rounded-md'
                  />
                </div>
              )}
            </CardContent>
          </Card>

          <Card className='rounded-lg'>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <Images className='size-4 text-primary' />
                {t('Reference images')}
              </CardTitle>
              <CardDescription>
                {t('Upload up to 4 images for image-to-image generation.')}
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-3'>
              <button
                type='button'
                className='flex min-h-28 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/20 p-4 text-center text-sm transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none'
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault()
                  addFiles(event.dataTransfer.files)
                }}
              >
                <ImageIcon className='size-5 text-muted-foreground' />
                <span className='font-medium'>{t('Drop images here or browse')}</span>
                <span className='text-xs text-muted-foreground'>JPEG, PNG, WebP · 10 MB</span>
              </button>
              <input
                ref={fileInputRef}
                type='file'
                accept='image/jpeg,image/png,image/webp'
                multiple
                className='hidden'
                onChange={(event) => {
                  if (event.target.files) addFiles(event.target.files)
                  event.target.value = ''
                }}
              />
              {previews.length > 0 && (
                <div className='grid grid-cols-2 gap-2'>
                  {previews.map((preview, index) => (
                    <div key={`${preview.file.name}-${index}`} className='group relative overflow-hidden rounded-md border'>
                      <img
                        src={preview.url}
                        alt={t('Reference image')}
                        className='aspect-square w-full object-cover'
                      />
                      <Button
                        size='icon'
                        variant='destructive'
                        className='absolute top-2 right-2 size-7 rounded-md opacity-90'
                        aria-label={t('Remove reference image')}
                        onClick={() => setSourceImages((items) => items.filter((_, itemIndex) => itemIndex !== index))}
                      >
                        <X className='size-3.5' />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <Button
                className='h-11 w-full rounded-md'
                disabled={!canSubmit || generationMutation.isPending}
                onClick={() => generationMutation.mutate()}
              >
                {generationMutation.isPending ? (
                  <LoaderCircle className='size-4 animate-spin' />
                ) : (
                  <WandSparkles className='size-4' />
                )}
                {sourceImages.length > 0 ? t('Generate from references') : t('Generate images')}
              </Button>
            </CardContent>
          </Card>
        </aside>

        <main className='min-w-0'>
          <Card className='rounded-lg'>
            <CardHeader className='border-b'>
              <div className='flex flex-col gap-2 md:flex-row md:items-start md:justify-between'>
                <div>
                  <CardTitle className='flex items-center gap-2'>
                    <Sparkles className='size-4 text-primary' />
                    {t('Generation canvas')}
                  </CardTitle>
                  <CardDescription>
                    {t('Results stay in this browser session until you refresh the page.')}
                  </CardDescription>
                </div>
                {result && (
                  <div className='flex flex-wrap gap-2'>
                    <Badge variant='outline' className='rounded-md'>
                      {result.size}
                    </Badge>
                    <Badge variant='outline' className='rounded-md'>
                      {result.outputFormat.toUpperCase()}
                    </Badge>
                    <Badge variant='outline' className='rounded-md'>
                      {t('References')}: {result.sourceCount}
                    </Badge>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className='p-4 lg:p-5'>
              {generationMutation.isPending ? (
                <GenerationSkeleton count={imageCount} />
              ) : result ? (
                <div className='grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]'>
                  <div className='grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]'>
                    {result.images.map((image, index) => {
                      const selected = index === selectedImageIndex
                      return (
                        <article
                          key={`${image.src}-${index}`}
                          className={cn(
                            'overflow-hidden rounded-lg border bg-card transition-colors',
                            selected ? 'border-primary ring-3 ring-primary/15' : 'hover:border-foreground/30'
                          )}
                        >
                          <button
                            type='button'
                            className='relative block w-full cursor-pointer bg-background text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none'
                            onClick={() => setSelectedImageIndex(index)}
                          >
                            <img
                              src={image.src}
                              alt={`${t('Generated image')} ${index + 1}`}
                              className='w-full object-cover'
                              style={{ aspectRatio: getImageAspect(result.size) }}
                            />
                            <Badge className='absolute top-2 left-2 rounded-md'>
                              {String(index + 1).padStart(2, '0')}
                            </Badge>
                          </button>
                          <div className='grid grid-cols-2 gap-2 p-3'>
                            <Button
                              variant='secondary'
                              size='sm'
                              className='h-9 rounded-md'
                              onClick={() => useGeneratedAsSource(image)}
                            >
                              <ImageIcon className='size-4' />
                              {t('Use as reference')}
                            </Button>
                            <a
                              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-9 rounded-md')}
                              download={`image-studio-${index + 1}.${result.outputFormat}`}
                              href={image.src}
                            >
                              <Download className='size-4' />
                              {t('Download')}
                            </a>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                  <Card className='h-fit rounded-lg xl:sticky xl:top-4'>
                    <CardHeader>
                      <CardTitle>{t('Selected image')}</CardTitle>
                      <CardDescription>{t('Use a result as the next reference or download it.')}</CardDescription>
                    </CardHeader>
                    <CardContent className='space-y-3'>
                      {selectedImage && (
                        <>
                          <img
                            src={selectedImage.src}
                            alt={t('Selected image')}
                            className='w-full rounded-md border object-cover'
                            style={{ aspectRatio: getImageAspect(result.size) }}
                          />
                          {selectedImage.revisedPrompt && (
                            <div className='rounded-md border bg-muted/30 p-3 text-xs leading-5'>
                              <div className='mb-1 font-medium'>{t('Revised prompt')}</div>
                              <p className='text-muted-foreground'>{selectedImage.revisedPrompt}</p>
                            </div>
                          )}
                          <Button
                            className='h-10 w-full rounded-md'
                            onClick={() => useGeneratedAsSource(selectedImage)}
                          >
                            <ImageIcon className='size-4' />
                            {t('Use as reference')}
                          </Button>
                        </>
                      )}
                    </CardContent>
                  </Card>
                </div>
              ) : (
                <Empty className='min-h-[560px] rounded-lg border bg-muted/10'>
                  <EmptyHeader>
                    <EmptyTitle>{t('Ready for your first image')}</EmptyTitle>
                    <EmptyDescription>
                      {t('Choose an eligible API key, write a prompt, then generate images through the relay.')}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  )
}

function GenerationSkeleton({ count }: { count: number }) {
  const items = Array.from({ length: Math.min(Math.max(count, 1), 4) }, (_, index) => index)
  return (
    <div className='grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]'>
      {items.map((item) => (
        <Card key={item} className='overflow-hidden rounded-lg py-0'>
          <Skeleton className='aspect-square rounded-none' />
          <div className='grid grid-cols-2 gap-2 p-3'>
            <Skeleton className='h-9 rounded-md' />
            <Skeleton className='h-9 rounded-md' />
          </div>
        </Card>
      ))}
    </div>
  )
}
