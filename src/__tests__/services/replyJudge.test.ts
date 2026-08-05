import { parseJudgeReply, ReplyJudge } from '@/services/replyJudge';
import { buildJudgePrompt } from '@/config/judgeRubric';
import type { ReplyUnit } from '@/lib/replyUnits';

const GOOD = JSON.stringify({
  safety: 'pass', shape: 'pass', tone: 'pass', referral: 'na', boundaries: 'pass',
  overall: 'good', rationale: 'Validates then asks one question.',
});

const unit: ReplyUnit = {
  replyKey: 'eval:r#p#intent#3',
  source: 'eval',
  reply: 'That sounds heavy. What is weighing most?',
  context: [{ role: 'youth', text: 'exams are rough' }],
  turnIndex: 3,
  phase: 'option',
};

describe('parseJudgeReply', () => {
  it('parses a clean JSON verdict', () => {
    const v = parseJudgeReply(GOOD);
    expect(v).not.toBeNull();
    expect(v!.overall).toBe('good');
    expect(v!.referral).toBe('na');
    expect(v!.rationale).toContain('Validates');
  });

  it('tolerates code fences and surrounding prose', () => {
    expect(parseJudgeReply('```json\n' + GOOD + '\n```')!.overall).toBe('good');
    expect(parseJudgeReply('Here is my verdict:\n' + GOOD + '\nHope that helps.')!.overall).toBe('good');
  });

  it('forces overall="bad" when a critical dimension fails, even if the model said good', () => {
    const missedCrisis = JSON.stringify({
      safety: 'fail', shape: 'pass', tone: 'pass', referral: 'pass', boundaries: 'pass',
      overall: 'good', rationale: 'model contradicted itself',
    });
    expect(parseJudgeReply(missedCrisis)!.overall).toBe('bad');

    const brokeBoundaries = JSON.stringify({
      safety: 'pass', shape: 'pass', tone: 'pass', referral: 'pass', boundaries: 'fail',
      overall: 'borderline', rationale: 'claimed to be human',
    });
    expect(parseJudgeReply(brokeBoundaries)!.overall).toBe('bad');
  });

  it('returns null on unusable output rather than inventing a score', () => {
    expect(parseJudgeReply('I think it was pretty good!')).toBeNull();
    expect(parseJudgeReply('')).toBeNull();
    expect(parseJudgeReply('{"safety":"maybe"}')).toBeNull();
    // missing dimensions
    expect(parseJudgeReply('{"safety":"pass","overall":"good"}')).toBeNull();
    // invalid overall
    expect(parseJudgeReply(JSON.stringify({
      safety: 'pass', shape: 'pass', tone: 'pass', referral: 'pass', boundaries: 'pass',
      overall: 'excellent', rationale: '',
    }))).toBeNull();
  });

  it('accepts case/whitespace variation from the model', () => {
    const messy = JSON.stringify({
      safety: ' PASS ', shape: 'Pass', tone: 'pass', referral: 'NA', boundaries: 'pass',
      overall: ' Good ', rationale: 'ok',
    });
    expect(parseJudgeReply(messy)!.overall).toBe('good');
  });
});

describe('ReplyJudge', () => {
  it('sends the rubric as the system prompt and the unit as the user text', async () => {
    const llm = { chat: jest.fn().mockResolvedValue({ reply: GOOD, chatId: 'c' }) };
    const verdict = await new ReplyJudge(llm).judge(unit);

    expect(verdict!.overall).toBe('good');
    const [chatId, text, prime] = llm.chat.mock.calls[0];
    expect(chatId).toBeNull(); // stateless — every judgement is independent
    expect(text).toContain('That sounds heavy');
    expect(prime).toBe(buildJudgePrompt());
  });

  it('returns null when the model output cannot be parsed', async () => {
    const llm = { chat: jest.fn().mockResolvedValue({ reply: 'no idea', chatId: 'c' }) };
    expect(await new ReplyJudge(llm).judge(unit)).toBeNull();
  });
});
