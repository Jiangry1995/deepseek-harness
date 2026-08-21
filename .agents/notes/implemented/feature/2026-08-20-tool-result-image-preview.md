# Agent Note: Tool-result image blocks preview in the Web conversation

Status: implemented

English | [中文](2026-08-20-tool-result-image-preview.zh.md)

## Problem

`read_image` already returns a durable `ImageBlock` on `ToolResultNode.content` beside the metadata envelope, and user/assistant messages already render those attachments through `ImageGallery`. Tool rows skipped that path: `resultText` JSON-stringified every non-text block, `AssistantMarkdown` does not draw `tool-call` heads, and no keyed `read_image` toolview existed, so the expanded IN/OUT card showed `<path>`/`<type>`/`<content>` XML and a JSON attachment dump instead of pixels.

## Decision

The generic Tool row and the details Output section render `type: 'image'` content as the same session-authorized thumbnails the chat history uses. `resultImages` extracts attachment refs from the frozen result; `resultText` omits image blocks so Output is the envelope, not a JSON dump. `ToolRow` places the gallery outside the disclosure, as a sibling of the IN/OUT body, so collapsing hides only the envelope and a 240px long-edge preview is not clipped by the 150px text cap. `ToolDetails` puts the gallery above the envelope.

Image presentation follows the Client slot architecture. The Chat Node owner supplies `renderMessageImages`, which the generic row receives as `renderImages` and routes through `conversation.message.images`. The details panel declares `conversation.details.images`, combines that slot with its session-authorized `loadImage`, and supplies the resulting `renderImages` callback to `ToolDetails`. `ui-attachment` fills both image slots with the same `MessageImages` component, so rows, details, and message history share loading, labels, sizing, and lightbox behavior without importing presentation components across plugins.

`read_image` classifies as the read-family row titled `Read image`, with `file_path` as an openable host link. There is no new `card:` tag and no keyed `read_image` toolview: any tool whose settled content includes an `ImageBlock` gets the preview, and `read_image` keeps `presentCall` `{ card: 'generic', kind: 'read' }`.

## Alternatives considered

**A keyed `read_image` toolview that only that tool uses.** Rejected because the pixels already live on `content`; a name-keyed row would hide the same blocks from every other image-returning tool and duplicate `GenericToolCard`.

**A new `card: 'image'` render intent and `presentResult`.** Rejected because the attachment is already a content block the Web host and model adapters consume. A card tag would persist a second copy of facts the log already has, against the rule that presentation is a pure function of logged content.

**A thumbnail in the summary line, or auto-expanding image rows.** Rejected because the summary line is a single 24px clip and every other card starts collapsed so a run of calls stays scannable. The gallery sits below the header, outside the disclosure, so the screenshot stays in the flow while the envelope remains optional.

## Consequences

A successful `read_image` row shows the screenshot under the title while the metadata envelope stays collapsed by default. Expanding reveals the envelope; collapsing hides it and keeps the thumbnail. Opening the call in details also shows the screenshot. An unfilled attachment presentation slot leaves the envelope without a thumbnail; image bytes remain behind the conversation-owned session authorization. JSON dumps of image blocks no longer appear in Output.

## Testing

`packages/client/ui-tool/tests/tool-row.client.spec.tsx` pins `resultText` skipping image blocks, `resultImages` collecting attachments, and the `read_image` row title/path. `packages/client/ui-tool/tests/tool-image-preview.client.spec.tsx` pins row/details slot routing, the envelope staying inside the disclosure, and the GenericToolCard `read_image` path. `packages/client/ui-attachment/tests/message-image.client.spec.tsx` pins thumbnail loading and the lightbox, while `packages/client/ui-attachment/tests/plugin.client.spec.ts` pins both image-slot registrations.

## Related

- [A minimal read_image tool over existing seams](2026-08-10-minimal-read-image-tool.md) — produces the `ImageBlock` this renders.
- [Web read card frontend](2026-07-30-web-read-card-frontend.md) — the card-consuming pattern this does not extend; image preview stays on generic content blocks.
