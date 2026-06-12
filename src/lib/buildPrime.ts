export type HistoryMessage = { role: 'user' | 'assistant'; content: string };

/**
 * Appends the conversation transcript to a prime message when there are prior
 * AI turns — used during session recovery (AIBots crash) and provider fallback
 * (AIBots → Dify) so the new session starts with full context.
 *
 * If there are no prior assistant messages the prime is returned unchanged —
 * this is a genuinely fresh session and the prime alone is sufficient.
 */
export function buildPrimeWithHistory(prime: string, history?: HistoryMessage[]): string {
  const hasPriorAITurns = history?.some(m => m.role === 'assistant') ?? false;
  if (!hasPriorAITurns) return prime;

  const transcript = history!
    .map(m => `${m.role === 'user' ? 'User' : 'Carey'}: ${m.content}`)
    .join('\n');

  return (
    prime +
    '\n\n[CONVERSATION SO FAR — for context only, do not repeat]\n' +
    transcript +
    '\n\nContinue the conversation from here.'
  );
}
