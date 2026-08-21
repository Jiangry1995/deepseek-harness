/** Card-aware output body for the selected Tool call in details. */
import { DiffBlock, ReadBlock, SearchBlock, TerminalBlock, WebBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolDetailsProps } from '../contract/slots.ts'
import { diffCardModel } from './models/diff-card-model.ts'
import { readCardModel } from './models/read-card-model.ts'
import { searchCardModel } from './models/search-card-model.ts'
import { terminalBlockLabels, terminalCardModel } from './models/terminal-card-model.ts'
import { resultImages, resultText } from './models/tool-call-model.ts'
import { webCardModel } from './models/web-card-model.ts'
import { ToolResultImages } from './components/ToolResultImages.tsx'
import css from './ToolDetails.module.css'

/** Pure details-body inputs; framework session seats stay at the slot boundary. */
interface ToolDetailsContentProps {
  block: ToolDetailsProps['block']
  cwd?: ToolDetailsProps['cwd']
  loadImage?: ToolDetailsProps['loadImage']
  t: ToolDetailsProps['t']
}

/**
 * Render the selected Tool call's structured output when its presentation
 * intent is known, otherwise preserve the flattened result text and any
 * image-block thumbnails.
 * @param props - selected call slice, workspace root, image loader, and locale seat.
 * @returns the details output body.
 */
export function ToolDetails({ block, cwd, loadImage, t }: ToolDetailsContentProps) {
  const terminal = terminalCardModel(block, cwd)
  if (terminal !== null) {
    return (
      <>
        {terminal.description !== undefined ? (
          <div className={css.description}>{terminal.description}</div>
        ) : null}
        <TerminalBlock {...terminal.card} labels={terminalBlockLabels(t)} className={css.cardBody} />
      </>
    )
  }
  const read = readCardModel(block, cwd)
  if (read !== null) return <ReadBlock {...read} className={css.read} />
  const diff = diffCardModel(block)
  if (diff !== null) return <DiffBlock {...diff.card} className={css.cardBody} />
  const search = searchCardModel(block)
  if (search !== null) {
    return (
      <>
        <SearchBlock {...search.card} className={css.cardBody} />
        {search.recovery !== undefined ? <div className={css.recovery}>{search.recovery}</div> : null}
      </>
    )
  }
  const web = webCardModel(block)
  if (web !== null) {
    const body = 'kind' in block ? resultText(block) : ''
    return (
      <>
        <WebBlock {...web} className={css.web} />
        {body !== '' ? <pre className={css.code}>{body}</pre> : null}
      </>
    )
  }
  if (!('kind' in block)) return <div className={css.empty}>{t('details.running')}</div>
  const images = resultImages(block)
  const text = resultText(block)
  return (
    <>
      {loadImage !== undefined && images.length > 0 ? (
        <ToolResultImages images={images} load={loadImage} t={t} className={css.resultImages} />
      ) : null}
      {text !== '' || images.length === 0 ? (
        <pre className={css.code} data-error={block.isError || undefined}>
          {text}
        </pre>
      ) : null}
    </>
  )
}
