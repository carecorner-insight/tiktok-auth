// Redacts STRUCTURED PII from free text before it is written to a review log
// (the SharePoint conversation list and the UAT live log). Deterministic and
// fully local — no external calls — so redaction itself never leaks data.
//
// Catches: Singapore NRIC/FIN, email, phone numbers, and payment-card numbers.
// Does NOT catch names or free-form addresses (those need NER, not regex).
//
// Only applied to log sinks — never to the session store or the AI request,
// which need the raw text to work. Carey's own resources survive: the crisis
// numbers 1771 / 995 are too short to match, and the INSIGHT URL has no PII.

const NRIC = /\b[STFGM]\d{7}[A-Za-z]\b/g; // Singapore NRIC / FIN
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
// SG mobile/landline: 8 digits starting 3/6/8/9, optional +65 prefix.
const SG_PHONE = /(?<!\d)(?:\+?65[\s-]?)?[3689]\d{3}[\s-]?\d{4}(?!\d)/g;
// 13–19 digit runs with separators only BETWEEN digits (never trailing, so we
// don't swallow following whitespace) — Luhn-checked below.
const CARD_CANDIDATE = /\b\d(?:[ -]?\d){12,18}\b/g;

function luhnValid(digits: string): boolean {
  if (digits.length < 13) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function redactPII(input: string | null | undefined): string {
  if (!input) return input ?? '';
  let out = input;
  out = out.replace(NRIC, '[REDACTED_ID]');
  out = out.replace(EMAIL, '[REDACTED_EMAIL]');
  // Cards before phone so a 16-digit run isn't partially eaten by the phone rule.
  out = out.replace(CARD_CANDIDATE, m =>
    luhnValid(m.replace(/[ -]/g, '')) ? '[REDACTED_CARD]' : m,
  );
  out = out.replace(SG_PHONE, '[REDACTED_PHONE]');
  return out;
}
