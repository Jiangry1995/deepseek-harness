/** Inline thumbnails for image blocks on a settled Tool result. */
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { RenderMessageImages } from '@deepseek-ai/dsh-client-ui-conversation/client'

/**
 * Render durable Tool-result images with the same thumbnail and lightbox the
 * chat history uses. Callers omit this when the result has no image blocks or
 * the session image loader is unavailable.
 * @param props.images - attachment refs in content order.
 * @param props.renderImages - attachment presentation callback supplied by the conversation shell.
 * @param props.className - optional layout class from the render site.
 * @returns the gallery, or null when `images` is empty.
 */
export function ToolResultImages({ images, renderImages, className }: {
  images: readonly ImageAttachmentRef[]
  renderImages: RenderMessageImages
  className?: string | undefined
}) {
  if (images.length === 0) return null
  return (
    <div className={className}>
      {renderImages({ images: images.map(attachment => ({ attachment })), align: 'start' })}
    </div>
  )
}
