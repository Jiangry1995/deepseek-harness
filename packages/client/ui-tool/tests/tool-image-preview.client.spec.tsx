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

describe('ToolResultImages', () => {
  it('renders nothing when the result carried no images', () => {
    const view = render(
      <ToolResultImages images={[]} load={() => Promise.resolve('blob:empty')} t={t} />,
    )
    expect(view.container.querySelector('img')).toBeNull()
    expect(view.container.textContent).toBe('')
  })
})

describe('tool row image preview', () => {
  it('shows the thumbnail while collapsed and keeps the envelope inside the disclosure', async () => {
    const load = vi.fn(() => Promise.resolve('blob:shot'))
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
        loadImage={load}
      />,
    )
    const frame = await view.findByRole('button', { name: 'shot.png，点击查看原图' })
    expect(load).toHaveBeenCalledWith(attachment)
    await view.findByAltText('shot.png')
    expect(view.queryByText(/<path>shot.png<\/path>/)).toBeNull()
    fireEvent.click(frame)
    expect(view.getByRole('dialog', { name: '原图预览' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '关闭原图预览' }))
    expect(view.queryByRole('dialog')).toBeNull()
    expect(view.queryByText(/<path>shot.png<\/path>/)).toBeNull()
    fireEvent.click(view.getByRole('button', { name: /Read image/ }))
    expect(view.getByText(/<path>shot.png<\/path>/)).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: /Read image/ }))
    expect(view.queryByText(/<path>shot.png<\/path>/)).toBeNull()
    expect(view.getByAltText('shot.png')).toBeTruthy()
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
    expect(view.container.querySelector('img')).toBeNull()
  })
})

describe('GenericToolCard read_image', () => {
  it('titles the row Read image, links the path, and previews the result image', async () => {
    const openFile = vi.fn()
    const loadImage = vi.fn(() => Promise.resolve('blob:card'))
    const view = render(
      <GenericToolCard
        callId="c1"
        toolName="read_image"
        block={imageResult()}
        openFile={openFile}
        loadImage={loadImage}
        t={t}
      />,
    )
    expect(view.getByText('Read image')).toBeTruthy()
    fireEvent.click(view.getByText('shot.png'))
    expect(openFile).toHaveBeenCalledWith('shot.png')
    await view.findByAltText('shot.png')
    expect(view.queryByText(/<type>image<\/type>/)).toBeNull()
    fireEvent.click(view.getByRole('button', { name: /Read image/ }))
    expect(view.getByText(/<type>image<\/type>/)).toBeTruthy()
    expect(view.queryByText(/"type": "image"/)).toBeNull()
  })
})

describe('ToolDetails image preview', () => {
  it('renders the thumbnail above the metadata envelope', async () => {
    const view = render(
      <ToolDetails
        block={imageResult()}
        loadImage={() => Promise.resolve('blob:details')}
        t={t}
      />,
    )
    await view.findByAltText('shot.png')
    expect(view.getByText(/<type>image<\/type>/)).toBeTruthy()
    expect(view.queryByText(/"attachmentId"/)).toBeNull()
  })
})
