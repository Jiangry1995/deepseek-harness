// @vitest-environment jsdom
// Image blocks on a settled Tool result render as chat-history thumbnails
// outside the disclosure (visible while the envelope is collapsed) and in
// the details Output section.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { RenderMessageImages } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { zh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'
import { ToolResultImages } from '../src/client/tool/components/ToolResultImages.tsx'
import { ToolRow } from '../src/client/tool/components/ToolRow.tsx'
import { GenericToolCard, type GenericToolCardProps } from '../src/client/tool/toolviews/GenericToolCard.tsx'
import { ToolDetails } from '../src/client/tool/ToolDetails.tsx'

afterEach(() => {
  cleanup()
})

const t: GenericToolCardProps['t'] = makeTranslate(zh, commonZh)

const attachment = {
  attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
  mediaType: 'image/png' as const,
  bytes: 68,
  width: 1920,
  height: 1080,
  name: 'shot.png',
}

const imageResult = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 10, time: 2_000, callId: 'c1',
  call: { name: 'read_image', argsRaw: '{"file_path":"shot.png"}' },
  callTime: 1_000,
  content: [
    { type: 'text', text: '<path>shot.png</path>\n<type>image</type>' },
    { type: 'image', attachment },
  ],
  isError: false, callView: null, resultView: null, subCalls: [], ...over,
})

/** Render a deterministic attachment-slot probe without importing its presentation plugin. */
function imageRenderer(spy?: (owner: Parameters<RenderMessageImages>[0]) => void): RenderMessageImages {
  return (owner) => {
    spy?.(owner)
    return (
      <div data-testid="image-gallery" data-align={owner.align}>
        {owner.images.map(image => <span key={image.attachment.attachmentId}>{image.attachment.name}</span>)}
      </div>
    )
  }
}

describe('ToolResultImages', () => {
  it('renders nothing when the result carried no images', () => {
    const renderImages = vi.fn(imageRenderer())
    const view = render(
      <ToolResultImages images={[]} renderImages={renderImages} />,
    )
    expect(renderImages).not.toHaveBeenCalled()
    expect(view.container.textContent).toBe('')
  })
})

describe('tool row image preview', () => {
  it('shows the attachment slot while collapsed and keeps the envelope inside the disclosure', () => {
    const renderImages = vi.fn(imageRenderer())
    const view = render(
      <ToolRow
        t={t}
        variant="read"
        toolName="read_image"
        icon={<i data-testid="tool-icon" />}
        title="Read image"
        summary="shot.png"
        body={null}
        output="<path>shot.png</path>"
        state="ok"
        images={[attachment]}
        renderImages={renderImages}
      />,
    )
    expect(renderImages).toHaveBeenCalledWith({ images: [{ attachment }], align: 'start' })
    expect(view.getByTestId('image-gallery')).toBeTruthy()
    expect(view.getAllByText('shot.png')).toHaveLength(2)
    expect(view.queryByText(/<path>shot.png<\/path>/)).toBeNull()
    fireEvent.click(view.getByRole('button', { name: /Read image/ }))
    expect(view.getByText(/<path>shot.png<\/path>/)).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: /Read image/ }))
    expect(view.queryByText(/<path>shot.png<\/path>/)).toBeNull()
    expect(view.getByTestId('image-gallery')).toBeTruthy()
  })

  it('stays collapsed without a loader even when image attachments are present', () => {
    const view = render(
      <ToolRow
        t={t}
        variant="read"
        icon={<i />}
        title="Read image"
        summary="shot.png"
        body={null}
        state="ok"
        images={[attachment]}
      />,
    )
    expect(view.queryByRole('button')).toBeNull()
    expect(view.queryByTestId('image-gallery')).toBeNull()
  })
})

describe('GenericToolCard read_image', () => {
  it('titles the row Read image, links the path, and previews the result image', () => {
    const openFile = vi.fn()
    const view = render(
      <GenericToolCard
        callId="c1"
        toolName="read_image"
        block={imageResult()}
        openFile={openFile}
        renderImages={imageRenderer()}
        t={t}
      />,
    )
    expect(view.getByText('Read image')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'shot.png' }))
    expect(openFile).toHaveBeenCalledWith('shot.png')
    expect(view.getByTestId('image-gallery')).toBeTruthy()
    expect(view.queryByText(/<type>image<\/type>/)).toBeNull()
    fireEvent.click(view.getByRole('button', { name: /Read image/ }))
    expect(view.getByText(/<type>image<\/type>/)).toBeTruthy()
    expect(view.queryByText(/"type": "image"/)).toBeNull()
  })
})

describe('ToolDetails image preview', () => {
  it('renders the attachment slot above the metadata envelope', () => {
    const view = render(
      <ToolDetails
        block={imageResult()}
        renderImages={imageRenderer()}
        useHostDescription={selector => selector({ home: '/home/user' } as never)}
        t={t}
      />,
    )
    expect(view.getByTestId('image-gallery')).toBeTruthy()
    expect(view.getByText(/<type>image<\/type>/)).toBeTruthy()
    expect(view.queryByText(/"attachmentId"/)).toBeNull()
  })
})
