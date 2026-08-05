import { timingSafeEqual } from 'crypto';

/**
 * Reviewer identity for the labelling platform.
 *
 * Each reviewer has a personal token, so every label carries who made it and
 * inter-rater agreement can be computed. A single shared token would make that
 * impossible.
 *
 * SOURCE OF TRUTH is the SharePoint "Reviewers" list, read via Power Automate
 * and cached in Redis — see LabelerService. A non-technical admin adds or
 * removes reviewers there with no deploy.
 *
 * This module holds the pieces that don't depend on where the list came from:
 * the env-var format (break-glass / local dev) and constant-time matching.
 *
 * Env fallback format:
 *   LABELER_TOKENS="tok1:Alice Tan:alice@x.org,tok2:Bob:bob@x.org"
 *   token : display name : email        (comma-separated entries)
 *
 * Tokens are secrets: anyone holding one can read conversation excerpts and
 * write labels.
 */

export interface Labeler {
  /** Stable id used in stored labels — the email when present. Never change it
   *  for an existing reviewer, or their old labels detach from their new id. */
  id: string;
  name: string;
  email: string;
}

export interface LabelerEntry extends Labeler {
  token: string;
}

export function parseLabelerTokens(raw: string | undefined): LabelerEntry[] {
  if (!raw) return [];
  const out: LabelerEntry[] = [];
  for (const chunk of raw.split(',')) {
    const parts = chunk.split(':').map(s => s.trim());
    const [token, name, email] = parts;
    if (!token || !name) continue;
    out.push({ token, name, email: email ?? '', id: email || name });
  }
  return out;
}

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Matches a presented token against a set of entries in constant time.
 * Every entry is checked (no early exit) so timing does not reveal which
 * reviewer — or how many — a token nearly matched.
 */
export function matchToken(provided: string, entries: LabelerEntry[]): Labeler | null {
  if (!provided) return null;
  let found: Labeler | null = null;
  for (const entry of entries) {
    if (tokenMatches(provided, entry.token)) {
      found = { id: entry.id, name: entry.name, email: entry.email };
    }
  }
  return found;
}

/**
 * Env-var-only resolution. Kept for local dev and tests; production goes
 * through LabelerService so SharePoint is the source of truth.
 */
export function resolveLabeler(
  provided: string,
  raw: string | undefined = process.env.LABELER_TOKENS,
): Labeler | null {
  return matchToken(provided, parseLabelerTokens(raw));
}
