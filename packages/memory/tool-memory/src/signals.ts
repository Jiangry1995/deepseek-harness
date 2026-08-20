/**
 * Cheap pre-LLM gate: skip extraction when the turn has nothing to remember.
 * @module @deepseek-ai/dsh-tool-memory/signals
 */

const REMEMBER_PHRASES = [
  '记住',
  '记得',
  '忘掉',
  '别忘',
  'forget that',
  'forget this',
  "don't forget",
  'dont forget',
  'remember this',
  'remember that',
  'remember:',
  '以后都',
  '下次',
  'from now on',
  'always use',
]

/**
 * Return whether user text asks to remember, forget, or change a stored fact.
 * @param text - concatenated user text from one turn.
 * @returns true when a standing remember/forget phrase is present.
 */
export function hasRememberPhrase(text: string): boolean {
  const haystack = text.toLowerCase()
  return REMEMBER_PHRASES.some(phrase => haystack.includes(phrase.toLowerCase()))
}
