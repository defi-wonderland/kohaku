import { describe, expect, it } from 'vitest';
import { KitRefusalError, REPLY_FAILURE_CAUSES, type ApproverRequest, type Hex, type Verdict } from '../../src/index';
import {
  approval,
  BROKEN_CHECKSUM,
  cancellation,
  isArgumentError,
  orchestratorOver,
  recordingMethod,
  rejectionOf,
  REQUEST_METHOD,
  thrownBy,
} from './doubles';

const malformed: readonly [string, ApproverRequest][] = [
  ['a manager that is not an address', approval({ manager: '0x1234' })],
  ['an account that is not a string', approval({ account: 7 })],
  ['an action with a failing checksum', approval({ action: BROKEN_CHECKSUM })],
  ['a chain id that is not decimal', approval({ chainId: '0x1' })],
  ['a chain id past the safe integers', approval({ chainId: '9007199254740993' })],
  ['an attempt id past uint64', approval({ attemptId: (1n << 64n).toString() })],
  ['a setup nonce with a sign', approval({ setupNonce: '-1' })],
  ['a window end past uint48', approval({ validUntil: (2 ** 48).toString() })],
  ['a digest version that is not decimal', approval({ digestVersion: 'v1' })],
  ['an empty digest version', approval({ digestVersion: '' })],
  ['a negative place', approval({ place: -1 })],
  ['a fractional place', approval({ place: 1.5 })],
  ['a place given as a string', approval({ place: '0' })],
  ['a config of half a byte', approval({ config: '0x123' })],
  ['a salt of 31 bytes', approval({ salt: `0x${'5a'.repeat(31)}` })],
  ['a setup body hash that is not hex', approval({ setupBodyHash: 'hash' })],
  ['a credentialHoldsCode that is not a boolean', approval({ credentialHoldsCode: 'false' })],
  ['an approval with no order', approval({ order: undefined })],
  ['an approval whose order amount is a number', approval({ order: { token: REQUEST_METHOD, amount: 5, payee: REQUEST_METHOD } })],
  ['an approval whose payload is not hex', approval({ payload: 'abc' })],
  ['a cancellation whose method is not an address', cancellation({ method: 'wallet' })],
];

describe('a malformed request member is a malformed argument in every request-taking member', () => {
  for (const [name, request] of malformed) {
    it(`${name}: TypeError or RangeError, and no implementation is called`, async () => {
      const { method, calls } = recordingMethod();
      const orchestrator = orchestratorOver([[REQUEST_METHOD, method]]);
      const errors = [
        thrownBy(() => orchestrator.signingInput(request)),
        thrownBy(() => orchestrator.describeRequest(request)),
        await rejectionOf(() => orchestrator.replyFrom(request, {}, undefined)),
        await rejectionOf(() => orchestrator.verify(request, typeof request.place === 'number' ? request.place : 0, '0x01')),
      ];

      for (const error of errors) {
        expect(isArgumentError(error), String(error)).toBe(true);
        expect(error).not.toBeInstanceOf(KitRefusalError);
      }

      expect(calls).toHaveLength(0);
    });
  }
});

describe('a non-object params or input is a malformed argument', () => {
  for (const bad of [null, 'rpId', 3, true]) {
    it(`${String(bad)}: signingInput, enrollInput and configFrom throw TypeError and call nothing`, async () => {
      const { method, calls } = recordingMethod();
      const orchestrator = orchestratorOver([[REQUEST_METHOD, method]]);

      expect(thrownBy(() => orchestrator.signingInput(approval(), bad as never))).toBeInstanceOf(TypeError);
      expect(thrownBy(() => orchestrator.enrollInput(REQUEST_METHOD, bad as never))).toBeInstanceOf(TypeError);
      expect(await rejectionOf(() => orchestrator.configFrom(REQUEST_METHOD, bad as never, undefined))).toBeInstanceOf(TypeError);
      expect(calls).toHaveLength(0);
    });
  }

  it('a malformed method address in the enrolling pair throws TypeError', async () => {
    const orchestrator = orchestratorOver([]);

    for (const bad of ['0x12', 'wallet', undefined, 5]) {
      expect(thrownBy(() => orchestrator.enrollInput(bad as never, {}))).toBeInstanceOf(TypeError);
      expect(await rejectionOf(() => orchestrator.configFrom(bad as never, { kind: 'nothing-to-perform' }, undefined))).toBeInstanceOf(TypeError);
    }
  });

  it('signingInput without params hands the method none, and with params hands them on', () => {
    const { method, calls } = recordingMethod();
    const orchestrator = orchestratorOver([[REQUEST_METHOD, method]]);
    const params = { relyingPartyId: 'example.org' };

    orchestrator.signingInput(approval());
    orchestrator.signingInput(approval(), params);

    expect(calls[0]?.args[1]).toBeUndefined();
    expect(calls[1]?.args[1]).toStrictEqual(params);
  });
});

describe('an implementation\'s own typed failure passes through unchanged', () => {
  for (const cause of REPLY_FAILURE_CAUSES) {
    it(`${cause} from replyFrom and configFrom`, async () => {
      const failure = { kind: 'reply-failure', cause } as const;
      const { method } = recordingMethod('none', { replyFrom: async () => failure, configFrom: async () => failure });
      const orchestrator = orchestratorOver([[REQUEST_METHOD, method]]);

      expect(await orchestrator.replyFrom(approval(), {}, undefined)).toStrictEqual(failure);
      expect(await orchestrator.configFrom(REQUEST_METHOD, { kind: 'ceremony' }, undefined)).toStrictEqual(failure);
    });
  }

  it('the method\'s config bytes come back as the method gave them', async () => {
    const { method, calls } = recordingMethod('none', { configFrom: async () => '0xabcdef' });
    const input = { kind: 'ceremony', session: 1 } as const;
    const material = { result: 2 };

    expect(await orchestratorOver([[REQUEST_METHOD, method]]).configFrom(REQUEST_METHOD, input, material)).toBe('0xabcdef');
    expect(calls[0]?.args).toStrictEqual([input, material]);
  });

  it('enrollInput returns the method\'s answer for the params given', () => {
    const { method, calls } = recordingMethod();
    const params = { address: REQUEST_METHOD };

    expect(orchestratorOver([[REQUEST_METHOD, method]]).enrollInput(REQUEST_METHOD, params)).toStrictEqual({
      kind: 'nothing-to-perform',
      echoed: params,
    });
    expect(calls[0]?.args).toStrictEqual([params]);
  });
});

describe('an implementation that throws: the error propagates unchanged', () => {
  const boom = new Error('the method broke');
  const thrower = () => {
    throw boom;
  };

  it('from signingInput and enrollInput', () => {
    const { method } = recordingMethod('none', { signingInput: thrower, enrollInput: thrower });
    const orchestrator = orchestratorOver([[REQUEST_METHOD, method]]);

    expect(thrownBy(() => orchestrator.signingInput(approval()))).toBe(boom);
    expect(thrownBy(() => orchestrator.enrollInput(REQUEST_METHOD, {}))).toBe(boom);
  });

  it('from replyFrom, configFrom and verify', async () => {
    const reject = async (): Promise<never> => {
      throw boom;
    };
    const { method } = recordingMethod('none', { replyFrom: reject, configFrom: reject, verify: reject });
    const orchestrator = orchestratorOver([[REQUEST_METHOD, method]]);
    const request = approval();

    expect(await rejectionOf(() => orchestrator.replyFrom(request, {}, undefined))).toBe(boom);
    expect(await rejectionOf(() => orchestrator.configFrom(REQUEST_METHOD, { kind: 'ceremony' }, undefined))).toBe(boom);
    expect(await rejectionOf(() => orchestrator.verify(request, request.place, '0x01'))).toBe(boom);
  });
});

describe('an implementation that answers junk: TypeError naming the member', () => {
  const junkReplies: readonly unknown[] = [
    'not hex',
    '0xabc',
    '0xZZ',
    42,
    undefined,
    null,
    { kind: 'reply-failure', cause: 'gave-up' },
    { kind: 'reply-failure' },
    { kind: 'failure', cause: 'device-refused' },
    ['0x01'],
  ];

  for (const junk of junkReplies) {
    it(`replyFrom and configFrom answering ${JSON.stringify(junk) ?? 'undefined'}`, async () => {
      const answer = async () => junk as Hex;
      const { method } = recordingMethod('none', { replyFrom: answer, configFrom: answer });
      const orchestrator = orchestratorOver([[REQUEST_METHOD, method]]);
      const reply = await rejectionOf(() => orchestrator.replyFrom(approval(), {}, undefined));
      const config = await rejectionOf(() => orchestrator.configFrom(REQUEST_METHOD, { kind: 'ceremony' }, undefined));

      expect(reply).toBeInstanceOf(TypeError);
      expect((reply as Error).message).toContain('replyFrom');
      expect(config).toBeInstanceOf(TypeError);
      expect((config as Error).message).toContain('configFrom');
    });
  }

  for (const junk of ['maybe', 'SATISFIED', undefined, true, { verdict: 'satisfied' }]) {
    it(`verify answering ${JSON.stringify(junk) ?? 'undefined'}`, async () => {
      const { method } = recordingMethod('none', { verify: async () => junk as Verdict });
      const request = approval();
      const error = await rejectionOf(() => orchestratorOver([[REQUEST_METHOD, method]]).verify(request, request.place, '0x01'));

      expect(error).toBeInstanceOf(TypeError);
      expect((error as Error).message).toContain('verify');
    });
  }

  it('every typed failure either member returns names a closed cause', async () => {
    const answers = [...REPLY_FAILURE_CAUSES.map((cause) => ({ kind: 'reply-failure', cause })), { kind: 'reply-failure', cause: 'other' }];

    for (const answer of answers) {
      const { method } = recordingMethod('none', { replyFrom: async () => answer as never, configFrom: async () => answer as never });
      const orchestrator = orchestratorOver([[REQUEST_METHOD, method]]);

      for (const outcome of [
        orchestrator.replyFrom(approval(), {}, undefined),
        orchestrator.configFrom(REQUEST_METHOD, { kind: 'ceremony' }, undefined),
      ]) {
        const settled = await outcome.then(
          (value) => value,
          (error: unknown) => error,
        );

        if (typeof settled === 'object' && settled !== null && 'kind' in settled && settled.kind === 'reply-failure') {
          expect(REPLY_FAILURE_CAUSES).toContain((settled as unknown as { cause: string }).cause);
        }
      }
    }
  });

  it('a failure whose cause a getter changes after the check comes back as a fresh frozen record of the checked cause', async () => {
    let reads = 0;
    const shifty = {
      kind: 'reply-failure',
      get cause() {
        reads += 1;

        return reads === 1 ? 'device-refused' : 'gave-up';
      },
    };
    const { method } = recordingMethod('none', { replyFrom: async () => shifty as never });
    const settled = await orchestratorOver([[REQUEST_METHOD, method]]).replyFrom(approval(), {}, undefined);

    expect(settled).not.toBe(shifty);
    expect(Object.isFrozen(settled)).toBe(true);
    expect(settled).toStrictEqual({ kind: 'reply-failure', cause: 'device-refused' });
    expect(REPLY_FAILURE_CAUSES).toContain((settled as { cause: string }).cause);
  });
});
