/**
 * Shorten a catalog model name for the plugin composer trigger.
 * Desktop keeps the full name; the trigger tooltip and aria-label still
 * carry it. Only a leading `DeepSeek-` vendor prefix is stripped so
 * `DeepSeek-V4-Flash` reads as `V4-Flash` in ~400px.
 * @param name - catalog display name.
 * @returns the name without a leading DeepSeek vendor prefix.
 */
export function compactModelLabel(name: string): string {
  const stripped = name.replace(/^DeepSeek-?/i, '').trim()
  return stripped === '' ? name : stripped
}
