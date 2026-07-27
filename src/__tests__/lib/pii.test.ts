import { redactPII } from '@/lib/pii';

describe('redactPII', () => {
  it('redacts a Singapore NRIC/FIN', () => {
    expect(redactPII('my ic is S1234567A ok')).toBe('my ic is [REDACTED_ID] ok');
  });

  it('redacts email addresses', () => {
    expect(redactPII('reach me at jane.doe+x@example.com')).toBe('reach me at [REDACTED_EMAIL]');
  });

  it('redacts SG phone numbers (with and without +65, spaced or not)', () => {
    expect(redactPII('call 91234567')).toBe('call [REDACTED_PHONE]');
    expect(redactPII('call +65 9123 4567')).toBe('call [REDACTED_PHONE]');
  });

  it('redacts a valid (Luhn) payment card', () => {
    expect(redactPII('card 4111 1111 1111 1111 please')).toBe('card [REDACTED_CARD] please');
  });

  it('does NOT redact a non-Luhn long number', () => {
    expect(redactPII('order 1234567890123456')).toBe('order 1234567890123456');
  });

  it('does NOT redact the crisis numbers or short numbers', () => {
    expect(redactPII('please call 1771 or 995')).toBe('please call 1771 or 995');
    expect(redactPII('I am 15 years old')).toBe('I am 15 years old');
  });

  it('does NOT redact the INSIGHT support URL', () => {
    const url = 'https://carecorner-ist.my.site.com/insight/';
    expect(redactPII(`see ${url}`)).toBe(`see ${url}`);
  });

  it('handles null/undefined/empty safely', () => {
    expect(redactPII(null)).toBe('');
    expect(redactPII(undefined)).toBe('');
    expect(redactPII('')).toBe('');
  });

  it('redacts multiple PII items in one string', () => {
    const out = redactPII('S1234567A, email a@b.com, hp 98765432');
    expect(out).toBe('[REDACTED_ID], email [REDACTED_EMAIL], hp [REDACTED_PHONE]');
  });
});
