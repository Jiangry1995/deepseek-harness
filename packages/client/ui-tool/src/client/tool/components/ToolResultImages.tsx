/** Inline thumbnails for image blocks on a settled Tool result. */
import { ImageGallery, type ImageLoader, type MessageImageLabels } from '@deepseek-ai/dsh-client-ui-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Resolve conversation-namespace strings for the shared message-image atoms.
 * @param t - conversation locale seat already bound at the Tool render site.
 * @returns labels the gallery forwards to thumbnails and the original-image lightbox.
 */
function toolImageLabels(t: TranslateNS<'conversation'>): MessageImageLabels {
  return {
    image: t('image.label'),
    open: t('image.openOriginal'),
    openNamed: label => t('image.openOriginalLabel', { label }),
    loading: t('image.loading'),
    loadFailed: t('image.loadFailed'),
    lightbox: { dialog: t('image.preview'), close: t('image.closePreview') },
  }
}

/**
 * Render durable Tool-result images with the same thumbnail and lightbox the
 * chat history uses. Callers omit this when the result has no image blocks or
 * the session image loader is unavailable.
 * @param props.images - attachment refs in content order.
 * @param props.load - session-authorized URL loader.
 * @param props.t - conversation locale seat.
 * @param props.className - optional layout class from the render site.
 * @returns the gallery, or null when `images` is empty.
 */
export function ToolResultImages({ images, load, t, className }: {
  images: readonly ImageAttachmentRef[]
  load: ImageLoader
  t: TranslateNS<'conversation'>
  className?: string | undefined
}) {
  if (images.length === 0) return null
  return (
    <div className={className}>
      <ImageGallery
        images={images.map(attachment => ({ attachment }))}
        load={load}
        align="start"
        labels={toolImageLabels(t)}
      />
    </div>
  )
}
