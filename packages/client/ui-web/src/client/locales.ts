/** `web` namespace dictionaries (the composer web networking chip's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'chip.on.aria': '联网已开启，按下关闭搜索与抓取',
  'chip.on.title': '联网已开启 — 点击关闭（/web off）',
  'chip.off.aria': '联网已关闭，按下开启搜索与抓取',
  'chip.off.title': '联网已关闭 — 点击开启（/web）',
} satisfies Record<string, string>

/** The web namespace key union. */
export type WebKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'chip.on.aria': 'Web tools on, press to turn off search and fetch',
  'chip.on.title': 'Web tools on — click to turn off (/web off)',
  'chip.off.aria': 'Web tools off, press to turn on search and fetch',
  'chip.off.title': 'Web tools off — click to turn on (/web)',
} satisfies Record<WebKey, string>
