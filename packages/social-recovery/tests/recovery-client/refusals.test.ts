import { describe, expect, it } from 'vitest';
import { KitRefusalError, type Configuration, type PaymentOrder } from '../../src/index';
import {
  attemptIn,
  CLIENT_CONFIGURATION,
  commitmentOf,
  CONFIGURATION,
  HANDOVER,
  HEADER,
  INJECTED,
  KEY_NEW,
  METHOD_ECDSA,
  METHOD_OTHER,
  ORDER,
  rejectionOf,
  rig,
  SETUP_NONCE,
  stateFor,
  TOKEN,
  world,
  ZERO_WORD,
} from './doubles';

const UINT48_MAX = 2 ** 48 - 1;
const WAITING = stateFor(CONFIGURATION, attemptIn('Waiting'));

const isArgumentError = (thrown: unknown): boolean => thrown instanceof TypeError || thrown instanceof RangeError;

const openWith = (overrides = world(), window = 3_600, order: PaymentOrder = ORDER) => {
  const built = rig(overrides);

  return { ...built, run: built.client.initRecoveryGathering(CONFIGURATION, HANDOVER, order, { window }) };
};

describe('an attempt already waiting', () => {
  it('refuses the opening init with a KitRefusalError', async () => {
    const thrown = await rejectionOf(openWith(world({ state: WAITING })).run);

    expect(thrown).toBeInstanceOf(KitRefusalError);
  });

  it.each(['None', 'Cancelled', 'Consumed'] as const)('an attempt in state %s does not block the opening init', async (state) => {
    await expect(openWith(world({ state: stateFor(CONFIGURATION, attemptIn(state)) })).run).resolves.toMatchObject({ purpose: 'approval' });
  });
});

describe('the cancel init without a waiting attempt', () => {
  it.each(['None', 'Cancelled', 'Consumed'] as const)('refuses with a KitRefusalError in state %s', async (state) => {
    const built = rig(world({ state: stateFor(CONFIGURATION, attemptIn(state)) }));
    const thrown = await rejectionOf(built.client.initCancelGathering(CONFIGURATION, { window: 3_600 }));

    expect(thrown).toBeInstanceOf(KitRefusalError);
  });
});

describe('restore causes on the thrown value', () => {
  const NO_SETUP = { ...stateFor(), setupCommitment: ZERO_WORD, setupNonce: 0n };
  const MISMATCH = { ...stateFor(), setupCommitment: commitmentOf(CONFIGURATION, SETUP_NONCE + 1n) };

  it.each([
    ['initRecoveryGathering', NO_SETUP, 'restore.no-backup'],
    ['initRecoveryGathering', MISMATCH, 'restore.commitment-mismatch'],
    ['initCancelGathering', { ...NO_SETUP, attempt: attemptIn('Waiting') }, 'restore.no-backup'],
    ['initCancelGathering', { ...MISMATCH, attempt: attemptIn('Waiting') }, 'restore.commitment-mismatch'],
  ] as const)('%s refuses with %s where the source does not stand', async (init, state, code) => {
    const { client } = rig(world({ state }));
    const run =
      init === 'initRecoveryGathering'
        ? client.initRecoveryGathering(CONFIGURATION, HANDOVER, ORDER, { window: 3_600 })
        : client.initCancelGathering(CONFIGURATION, { window: 3_600 });
    const thrown = await rejectionOf(run);

    expect(thrown).toBeInstanceOf(KitRefusalError);
    expect((thrown as KitRefusalError).restoreCause?.code).toBe(code);
  });

  it('a configuration source with no setup standing names the no-setup case', async () => {
    const thrown = await rejectionOf(openWith(world({ state: NO_SETUP })).run);

    expect((thrown as KitRefusalError).restoreCause?.values).toMatchObject({ case: 'no-setup' });
  });
});

describe('transport failures propagate as themselves', () => {
  it.each(['provider.block', 'manager.stateOf', 'manager.paused', 'manager.trustedParties', 'provider.code', 'action.isAuthority', 'action.holdsAnyPrivilege'])(
    'a rejecting %s rejects the opening init with the same value',
    async (member) => {
      const thrown = await rejectionOf(openWith(world({ failures: new Map([[member, INJECTED]]) })).run);

      expect(thrown).toBe(INJECTED);
    },
  );

  it.each(['provider.block', 'manager.stateOf', 'manager.paused', 'manager.trustedParties', 'provider.code'])(
    'a rejecting %s rejects the cancel init with the same value',
    async (member) => {
      const built = rig(world({ state: WAITING, failures: new Map([[member, INJECTED]]) }));
      const thrown = await rejectionOf(built.client.initCancelGathering(CONFIGURATION, { window: 3_600 }));

      expect(thrown).toBe(INJECTED);
    },
  );
});

describe('unanswered pause reads', () => {
  it.each([
    ['paused', 'opening'],
    ['trustedParties', 'opening'],
    ['paused', 'cancel'],
    ['trustedParties', 'cancel'],
  ] as const)('an unanswered %s rejects the %s init and returns no record', async (member, init) => {
    const unanswered = new Map([[METHOD_OTHER.toLowerCase(), { answered: false as const }]]);
    const overrides = member === 'paused' ? { paused: unanswered } : { parties: unanswered };
    const built = rig(world({ ...overrides, state: init === 'cancel' ? WAITING : stateFor() }));
    const run =
      init === 'opening'
        ? built.client.initRecoveryGathering(CONFIGURATION, HANDOVER, ORDER, { window: 3_600 })
        : built.client.initCancelGathering(CONFIGURATION, { window: 3_600 });

    await expect(run).rejects.toBeDefined();
  });
});

describe('windows', () => {
  it.each([
    ['zero', 0],
    ['over uint48', UINT48_MAX + 1],
    ['negative', -1],
    ['fractional', 1.5],
  ])('an opening window that is %s throws an argument error before any read', async (_name, window) => {
    const built = openWith(world(), window);
    const thrown = await rejectionOf(built.run);

    expect(isArgumentError(thrown)).toBe(true);
    expect(built.seen).toEqual([]);
  });

  it('an opening window carrying validUntil past uint48 throws a RangeError', async () => {
    const thrown = await rejectionOf(openWith(world(), UINT48_MAX - HEADER.timestamp + 1).run);

    expect(thrown).toBeInstanceOf(RangeError);
  });

  it('an opening window reaching exactly uint48 builds', async () => {
    const record = await openWith(world(), UINT48_MAX - HEADER.timestamp).run;

    expect(record.request.validUntil).toBe(String(UINT48_MAX));
  });

  it('a cancel window above the configured cancel window throws a RangeError', async () => {
    const built = rig(world({ state: WAITING }));
    const thrown = await rejectionOf(built.client.initCancelGathering(CONFIGURATION, { window: CLIENT_CONFIGURATION.cancelWindow + 1 }));

    expect(thrown).toBeInstanceOf(RangeError);
  });

  it.each([undefined, null, 3_600, {}, { window: '3600' }])('a window argument %j throws an argument error before any read', async (window) => {
    const built = rig(world());
    const thrown = await rejectionOf(built.client.initRecoveryGathering(CONFIGURATION, HANDOVER, ORDER, window as never));

    expect(isArgumentError(thrown)).toBe(true);
    expect(built.seen).toEqual([]);
  });
});

describe('a malformed order', () => {
  it.each([
    ['a negative amount', { ...ORDER, amount: -1n }],
    ['an amount past uint256', { ...ORDER, amount: 1n << 256n }],
    ['a number amount', { ...ORDER, amount: 5 as unknown as bigint }],
    ['a short token', { ...ORDER, token: '0x1234' as `0x${string}` }],
    ['a bad checksum payee', { ...ORDER, payee: '0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed' as `0x${string}` }],
    ['a missing payee', { token: TOKEN, amount: 1n } as PaymentOrder],
    ['no order at all', undefined as unknown as PaymentOrder],
  ])('%s throws an argument error before any read', async (_name, order) => {
    const built = rig(world());
    const thrown = await rejectionOf(built.client.initRecoveryGathering(CONFIGURATION, HANDOVER, order, { window: 3_600 }));

    expect(isArgumentError(thrown)).toBe(true);
    expect(built.seen).toEqual([]);
  });

  it('a zero payee and a lower-cased token are well formed and stored checksummed', async () => {
    const record = await openWith(world(), 3_600, { token: TOKEN.toLowerCase() as `0x${string}`, amount: 0n, payee: `0x${'00'.repeat(20)}` }).run;

    if (record.purpose !== 'approval') throw new Error('approval expected');

    expect(record.request.order).toEqual({ token: TOKEN, amount: '0', payee: `0x${'00'.repeat(20)}` });
  });
});

describe('malformed handover addresses', () => {
  it.each([
    ['a bad checksum', { newAuthority: '0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed' as `0x${string}`, removedAuthority: HANDOVER.removedAuthority }],
    ['a short address', { newAuthority: '0x1234' as `0x${string}`, removedAuthority: HANDOVER.removedAuthority }],
    ['a non-string removed key', { newAuthority: KEY_NEW, removedAuthority: 7 as unknown as `0x${string}` }],
  ])('%s throws an argument error before any read', async (_name, handover) => {
    const built = rig(world());
    const thrown = await rejectionOf(built.client.initRecoveryGathering(CONFIGURATION, handover, ORDER, { window: 3_600 }));

    expect(isArgumentError(thrown)).toBe(true);
    expect(built.seen).toEqual([]);
  });
});

describe('a configuration hole', () => {
  it('a hole in the clauses throws a TypeError', async () => {
    const clauses = [...CONFIGURATION.clauses];

    delete clauses[0];

    const holed = { ...CONFIGURATION, clauses } as Configuration;
    const thrown = await rejectionOf(rig(world()).client.initRecoveryGathering(holed, HANDOVER, ORDER, { window: 3_600 }));

    expect(thrown).toBeInstanceOf(TypeError);
  });

  it('a hole in the credentials throws a TypeError', async () => {
    const credentials = [{ method: METHOD_ECDSA, config: '0x' as const }, { method: METHOD_ECDSA, config: '0x' as const }];

    delete credentials[1];

    const holed: Configuration = { ...CONFIGURATION, clauses: [{ threshold: 1, credentials }] };
    const thrown = await rejectionOf(rig(world()).client.initRecoveryGathering(holed, HANDOVER, ORDER, { window: 3_600 }));

    expect(thrown).toBeInstanceOf(TypeError);
  });
});
