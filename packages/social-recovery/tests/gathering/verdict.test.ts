import ts from 'typescript';
import { beforeAll, describe, expect, expectTypeOf, it } from 'vitest';
import * as core from '../../src/index';
import {
  fileReply,
  GATHERING_ORDER_REFUSAL_MESSAGES,
  GATHERING_ORDER_REFUSALS,
  GATHERING_RULE_UNSATISFIED_MESSAGE,
  GATHERING_SELECTION_UNFILLED_MESSAGE,
  GATHERING_WINDOW_PASSED_MESSAGE,
  order,
  orderVerdict,
  submissionFindings,
  type Gathering,
  type GatheringPlace,
  type OrderRefusal,
  type OrderVerdict,
  type ProofPlace,
  type Reply,
  type ValidationResult,
} from '../../src/index';
import { windowFactsOf } from '../../src/gathering/edge';
import { constituents, exportedType, loadRecords, propertyNames, propertyType, stringLiterals, type RecordContext } from '../helpers/records';
import {
  approvalGathering,
  bodyOver,
  cancellationGathering,
  methodAt,
  PINNED_AT,
  placeEntry,
  readFixture,
  replyFor,
  SKEW_SPAN,
  VALID_UNTIL,
} from './support';

const NOW = PINNED_AT + 60;

/** A record with replies filed at the given places, in the given order. */
function withReplies(record: Gathering, places: readonly number[]): Gathering {
  return places.reduce((acc, place) => {
    const result = fileReply(acc, replyFor(acc, place));

    if (result.outcome !== 'filed') throw new Error(`refused at ${place}: ${result.reason.cause}`);

    return result.gathering;
  }, record);
}

/** What a call threw, failing loudly where it returns. */
function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (thrown) {
    return thrown;
  }

  throw new Error('expected a throw');
}

type CriteriaInput = {
  clauses: { threshold: number; places: number[] }[];
  places: { place: number; method: number; standing: GatheringPlace['standing']; stoppable: boolean }[];
  filed: number[];
  ignoresPause: boolean;
  refiled?: number[];
};

/** The gathering a criteria row describes, its replies filed (and refiled) in the row's order. */
function criteriaRecord(input: CriteriaInput): Gathering {
  const places = input.places.map((p) => placeEntry(p.place, { method: methodAt(p.method), standing: p.standing, stoppable: p.stoppable }));
  const record = withReplies(approvalGathering(places, bodyOver(input.clauses, places, input.ignoresPause)), input.filed);

  return (input.refiled ?? []).reduce((acc, place) => {
    const result = fileReply(acc, replyFor(acc, place, { proof: '0xfeed' }));

    if (result.outcome !== 'filed') throw new Error('refile refused');

    return result.gathering;
  }, record);
}

/** A rule-unsatisfied finding on one short clause. */
const shortClause = (clause: number, threshold: number, filled: number) => ({
  code: 'request.rule-unsatisfied',
  subject: 'request',
  values: { clause, threshold, filled },
});

describe('orderVerdict: ordered, the proofs order gives', () => {
  const fixture = readFixture('order-criteria.json');

  it.each(fixture.vectors.map((r) => [r['id'] as string, r] as const))('criteria row %s', (_name, row) => {
    const record = criteriaRecord(row.input as CriteriaInput);

    expect(orderVerdict(record, undefined, NOW)).toStrictEqual({ outcome: 'ordered', proofs: order(record, undefined, NOW) });
  });

  it.each<[string, () => Gathering, readonly number[] | undefined]>([
    ['an approval, preferred set', () => withReplies(approvalGathering(), [2, 0, 3]), undefined],
    ['an approval, a larger satisfying selection', () => withReplies(approvalGathering(), [0, 1, 2, 3]), [0, 1, 2, 3]],
    ['an approval, a selection out of order', () => withReplies(approvalGathering(), [0, 1, 2, 3]), [3, 0, 2]],
    ['an approval, a selection naming a place twice', () => withReplies(approvalGathering(), [0, 1, 2, 3]), [3, 0, 3, 2]],
    ['a cancellation, preferred set', () => withReplies(cancellationGathering(), [3, 2, 1, 0]), undefined],
    ['a cancellation, a selection', () => withReplies(cancellationGathering(), [3, 2, 1, 0]), [1, 0, 3]],
  ])('%s', (_name, make, selection) => {
    const verdict = orderVerdict(make(), selection, NOW);

    expect(verdict).toStrictEqual({ outcome: 'ordered', proofs: order(make(), selection, NOW) });
    expect(Object.keys(verdict).sort()).toStrictEqual(['outcome', 'proofs']);
  });

  it('carries each chosen reply\'s method, config, salt and proof, the latest at a refiled place', () => {
    const record = withReplies(approvalGathering(), [2, 0, 3]);
    const refiled = fileReply(record, replyFor(record, 2, { proof: '0x0b0b' }));

    if (refiled.outcome !== 'filed') throw new Error('refused');

    const replyAt = (place: number) => refiled.gathering.replies.find((r) => r.place === place) as Reply;

    expect(orderVerdict(refiled.gathering, undefined, NOW)).toStrictEqual({
      outcome: 'ordered',
      proofs: [0, 2, 3].map((place) => {
        const { method, config, salt, proof } = replyAt(place);

        return { place, method, config, salt, proof };
      }),
    });
  });

  it('orders at the window end itself', () => {
    expect(orderVerdict(withReplies(approvalGathering(), [0, 1, 2]), undefined, VALID_UNTIL).outcome).toBe('ordered');
  });
});

describe('orderVerdict: window-passed', () => {
  it.each([
    ['one second past the window, the moment also skewed', VALID_UNTIL + 1],
    ['far past the window', VALID_UNTIL + 100_000],
  ])('%s: the findings are the whole submission findings, warnings included', (_name, now) => {
    const record = withReplies(approvalGathering(), [0, 1, 2]);
    const verdict = orderVerdict(record, undefined, now);

    expect(verdict).toStrictEqual({ outcome: 'refused', reason: 'window-passed', findings: submissionFindings(windowFactsOf(record), now) });
    expect(verdict.outcome === 'refused' && verdict.findings).toStrictEqual({
      errors: [{ code: 'request.expired', subject: 'request', values: { validUntil: VALID_UNTIL, moment: now, blockTimestamp: PINNED_AT } }],
      warnings: [{ code: 'request.moment-skew', subject: 'request', values: { moment: now, blockTimestamp: PINNED_AT, span: SKEW_SPAN } }],
    });
  });

  it('a pinned block past the window refuses with no warning when the moment sits beside it', () => {
    const base = withReplies(approvalGathering(), [0, 1, 2]);
    const late = String(VALID_UNTIL + 10);
    const record = { ...base, request: { ...base.request, block: { ...base.request.block, timestamp: late } } } as Gathering;
    const verdict = orderVerdict(record, undefined, VALID_UNTIL + 10);

    expect(verdict).toStrictEqual({
      outcome: 'refused',
      reason: 'window-passed',
      findings: {
        errors: [{ code: 'request.expired', subject: 'request', values: { validUntil: VALID_UNTIL, moment: VALID_UNTIL + 10, blockTimestamp: VALID_UNTIL + 10 } }],
        warnings: [],
      },
    });
  });

  it('a cancellation past its window refuses the same way', () => {
    const record = withReplies(cancellationGathering(), [0, 1, 2]);

    expect(orderVerdict(record, undefined, VALID_UNTIL + 1)).toStrictEqual({
      outcome: 'refused',
      reason: 'window-passed',
      findings: submissionFindings(windowFactsOf(record), VALID_UNTIL + 1),
    });
  });

  it('wins over an unsatisfied rule', () => {
    const verdict = orderVerdict(withReplies(approvalGathering(), [1]), undefined, VALID_UNTIL + 1);

    expect(verdict.outcome === 'refused' && verdict.reason).toBe('window-passed');
  });

  it('wins over a selection naming an unfilled place', () => {
    const verdict = orderVerdict(withReplies(approvalGathering(), [0, 1]), [0, 2], VALID_UNTIL + 1);

    expect(verdict.outcome === 'refused' && verdict.reason).toBe('window-passed');
  });
});

describe('orderVerdict: rule-unsatisfied, with the exact findings', () => {
  it('names every short clause with its threshold and filled count', () => {
    expect(orderVerdict(withReplies(approvalGathering(), [1]), undefined, NOW)).toStrictEqual({
      outcome: 'refused',
      reason: 'rule-unsatisfied',
      findings: { errors: [shortClause(0, 1, 0), shortClause(1, 2, 1)], warnings: [] },
    });
  });

  it('names only the short clause when the other holds', () => {
    expect(orderVerdict(withReplies(approvalGathering(), [1, 2, 3]), undefined, NOW)).toStrictEqual({
      outcome: 'refused',
      reason: 'rule-unsatisfied',
      findings: { errors: [shortClause(0, 1, 0)], warnings: [] },
    });
  });

  it('refuses a record with no reply, every clause short', () => {
    expect(orderVerdict(approvalGathering(), undefined, NOW)).toStrictEqual({
      outcome: 'refused',
      reason: 'rule-unsatisfied',
      findings: { errors: [shortClause(0, 1, 0), shortClause(1, 2, 0)], warnings: [] },
    });
  });

  it('judges a selection, not the filed places', () => {
    expect(orderVerdict(withReplies(approvalGathering(), [0, 1, 2, 3]), [1, 0], NOW)).toStrictEqual({
      outcome: 'refused',
      reason: 'rule-unsatisfied',
      findings: { errors: [shortClause(1, 2, 1)], warnings: [] },
    });
    expect(orderVerdict(withReplies(approvalGathering(), [0, 1, 2, 3]), [], NOW)).toStrictEqual({
      outcome: 'refused',
      reason: 'rule-unsatisfied',
      findings: { errors: [shortClause(0, 1, 0), shortClause(1, 2, 0)], warnings: [] },
    });
  });

  it('refuses a body with no clauses once, allThresholdsZero false', () => {
    expect(orderVerdict(approvalGathering([], bodyOver([], [])), undefined, NOW)).toStrictEqual({
      outcome: 'refused',
      reason: 'rule-unsatisfied',
      findings: { errors: [{ code: 'request.rule-unsatisfied', subject: 'request', values: { clauses: 0, allThresholdsZero: false } }], warnings: [] },
    });
  });

  it.each([
    ['one clause', [{ threshold: 0, places: [0] }]],
    ['two clauses', [{ threshold: 0, places: [0] }, { threshold: 0, places: [1, 2] }]],
  ])('refuses an all-zero rule over %s once, allThresholdsZero true', (_name, clauses) => {
    const places = clauses.flatMap((clause) => clause.places).map((p) => placeEntry(p));
    const record = withReplies(approvalGathering(places, bodyOver(clauses, places)), places.map((p) => p.place));

    expect(orderVerdict(record, undefined, NOW)).toStrictEqual({
      outcome: 'refused',
      reason: 'rule-unsatisfied',
      findings: {
        errors: [{ code: 'request.rule-unsatisfied', subject: 'request', values: { clauses: clauses.length, allThresholdsZero: true } }],
        warnings: [],
      },
    });
  });

  it('a hand-built record whose places name a place past the body\'s count refuses with proof.place-out-of-range', () => {
    const places = [0, 1, 2, 3, 4].map((p) => placeEntry(p));
    const start = approvalGathering(places);
    const record = approvalGathering(places, undefined, [0, 1, 2, 4].map((place) => replyFor(start, place)));

    expect(orderVerdict(record, undefined, NOW)).toStrictEqual({
      outcome: 'refused',
      reason: 'rule-unsatisfied',
      findings: { errors: [{ code: 'proof.place-out-of-range', subject: 'request', values: { place: 4, count: 4 } }], warnings: [] },
    });
  });

  it('order now refuses that record too, with the rule message, where a selection reaches the place past the count', () => {
    const places = [0, 1, 2, 3, 4].map((p) => placeEntry(p));
    const start = approvalGathering(places);
    const record = approvalGathering(places, undefined, [0, 1, 2, 4].map((place) => replyFor(start, place)));

    expect(() => order(record, undefined, NOW)).toThrow(GATHERING_RULE_UNSATISFIED_MESSAGE);
    expect(() => order(record, [0, 1, 2, 4], NOW)).toThrow(GATHERING_RULE_UNSATISFIED_MESSAGE);
    expect(orderVerdict(record, [2, 0, 1], NOW)).toStrictEqual({ outcome: 'ordered', proofs: order(record, [2, 0, 1], NOW) });
  });

  it('a rule refusal carries no window warning, even at a skewed moment', () => {
    const now = PINNED_AT + SKEW_SPAN + 1;

    expect(submissionFindings(windowFactsOf(approvalGathering()), now).warnings).toHaveLength(1);
    expect(orderVerdict(withReplies(approvalGathering(), [1, 2, 3]), undefined, now)).toStrictEqual({
      outcome: 'refused',
      reason: 'rule-unsatisfied',
      findings: { errors: [shortClause(0, 1, 0)], warnings: [] },
    });
  });

  it('a refused verdict carries exactly outcome, reason and findings', () => {
    expect(Object.keys(orderVerdict(approvalGathering(), undefined, NOW)).sort()).toStrictEqual(['findings', 'outcome', 'reason']);
  });
});

describe('orderVerdict: the throws', () => {
  it('a selection naming a place no reply fills throws the RangeError, even when its filled part satisfies', () => {
    const thrown = thrownBy(() => orderVerdict(withReplies(approvalGathering(), [0, 1, 2]), [0, 1, 2, 3], NOW));

    expect(thrown).toBeInstanceOf(RangeError);
    expect((thrown as Error).message).toBe(GATHERING_SELECTION_UNFILLED_MESSAGE);
  });

  it('throws the same RangeError when the selection would also fail the rule', () => {
    const thrown = thrownBy(() => orderVerdict(withReplies(approvalGathering(), [0, 1]), [1, 2], NOW));

    expect(thrown).toBeInstanceOf(RangeError);
    expect((thrown as Error).message).toBe(GATHERING_SELECTION_UNFILLED_MESSAGE);
  });

  it('a place filed outside the place map does not fill a selection', () => {
    const full = withReplies(approvalGathering(), [0, 1, 2, 3]);
    const short = { ...full, places: full.places.slice(0, 3) } as Gathering;

    expect(() => orderVerdict(short, [0, 1, 3], NOW)).toThrow(RangeError);
  });

  it.each([
    ['version 2', { version: 2 }],
    ['version 0', { version: 0 }],
    ['the kind Gathering', { kind: 'Gathering' }],
    ['no kind', { kind: undefined }],
  ] as [string, Record<string, unknown>][])('a record at %s throws a TypeError, as order does', (_label, change) => {
    const unread = { ...withReplies(approvalGathering(), [0, 1, 2]), ...change } as Gathering;

    expect(() => orderVerdict(unread, undefined, NOW)).toThrow(TypeError);
    expect(() => orderVerdict(unread, undefined, VALID_UNTIL + 1)).toThrow(TypeError);
  });
});

/** The refusal reasons, listed independently of src/. */
const REFUSAL_VALUES = ['window-passed', 'rule-unsatisfied'];

describe('the ordering verdict\'s records and constants', () => {
  let context: RecordContext;

  beforeAll(() => {
    context = loadRecords();
  });

  it.each(['GATHERING_ORDER_REFUSALS', 'GATHERING_ORDER_REFUSAL_MESSAGES', 'orderVerdict'])('the core entry exports %s as a value', (name) => {
    const symbol = context.entry.get(name);

    expect(symbol, `${name} is not exported from src/index.ts`).toBeDefined();
    expect((symbol?.flags ?? 0) & (ts.SymbolFlags.Variable | ts.SymbolFlags.Function)).not.toBe(0);
  });

  it('GATHERING_ORDER_REFUSALS is the two reasons in order, once each, from the core entry', () => {
    expect(GATHERING_ORDER_REFUSALS).toStrictEqual(REFUSAL_VALUES);
    expect(new Set(GATHERING_ORDER_REFUSALS).size).toBe(2);
    expect(core.GATHERING_ORDER_REFUSALS).toBe(GATHERING_ORDER_REFUSALS);
    expectTypeOf(GATHERING_ORDER_REFUSALS).toEqualTypeOf<readonly ['window-passed', 'rule-unsatisfied']>();
    expectTypeOf<OrderRefusal>().toEqualTypeOf<(typeof GATHERING_ORDER_REFUSALS)[number]>();
    expect(stringLiterals(exportedType(context, 'OrderRefusal'))).toStrictEqual([...REFUSAL_VALUES].sort());
  });

  it('GATHERING_ORDER_REFUSAL_MESSAGES maps each reason to the existing message, frozen, nothing more', () => {
    expect(GATHERING_ORDER_REFUSAL_MESSAGES).toStrictEqual({
      'window-passed': GATHERING_WINDOW_PASSED_MESSAGE,
      'rule-unsatisfied': GATHERING_RULE_UNSATISFIED_MESSAGE,
    });
    expect(GATHERING_ORDER_REFUSAL_MESSAGES['window-passed']).toBe('gathering: the window has passed at this moment');
    expect(GATHERING_ORDER_REFUSAL_MESSAGES['rule-unsatisfied']).toBe('gathering: the replies do not satisfy the rule');
    expect(Object.isFrozen(GATHERING_ORDER_REFUSAL_MESSAGES)).toBe(true);
    expect(core.GATHERING_ORDER_REFUSAL_MESSAGES).toBe(GATHERING_ORDER_REFUSAL_MESSAGES);
  });

  it('OrderVerdict is a union over outcome: ordered with proofs, refused with reason and findings', () => {
    const members = constituents(exportedType(context, 'OrderVerdict'));
    const byOutcome = new Map(members.map((member) => [stringLiterals(propertyType(context.checker, member, 'outcome'))?.join(), member]));

    expect(members).toHaveLength(2);
    expect([...byOutcome.keys()].sort()).toStrictEqual(['ordered', 'refused']);
    expect(propertyNames(context.checker, byOutcome.get('ordered') as ts.Type)).toStrictEqual(['outcome', 'proofs']);
    expect(propertyNames(context.checker, byOutcome.get('refused') as ts.Type)).toStrictEqual(['findings', 'outcome', 'reason']);
    expectTypeOf<Extract<OrderVerdict, { outcome: 'ordered' }>['proofs']>().toEqualTypeOf<readonly ProofPlace[]>();
    expectTypeOf<Extract<OrderVerdict, { outcome: 'refused' }>['reason']>().toEqualTypeOf<OrderRefusal>();
    expectTypeOf<Extract<OrderVerdict, { outcome: 'refused' }>['findings']>().toEqualTypeOf<ValidationResult>();
  });

  it('orderVerdict takes order\'s arguments', () => {
    expectTypeOf(orderVerdict).parameters.toEqualTypeOf<Parameters<typeof order>>();
    expectTypeOf(orderVerdict).returns.toEqualTypeOf<OrderVerdict>();
  });
});
