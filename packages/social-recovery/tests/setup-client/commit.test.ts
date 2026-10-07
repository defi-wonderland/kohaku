import { decodeFunctionData } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  BACKUP_PAYLOAD_VERSION,
  KitRefusalError,
  openBackup,
  POLICY_MANAGER_WRITES_ABI,
  serializeConfiguration,
  type Hex,
  type PreparedBatch,
  type PreparedCall,
} from '../../src/index';
import {
  ACCOUNT,
  ACTION,
  ARMING_DATA,
  BAD_DRAFT,
  build,
  COMMITTED,
  configurationOf,
  DRAFT,
  members,
  PIN,
  referenceCommitment,
  standingState,
  withBackup,
} from './doubles';

const PASSWORD = 'correct horse battery staple';

/** The arguments the client passed to the manager's `prepareCommitSetup`. */
const commitArguments = (seen: ReturnType<typeof build>['seen']): readonly unknown[] => {
  const call = seen.parts.find((part) => part.member === 'prepareCommitSetup');

  if (call === undefined) throw new Error('prepareCommitSetup was not called');

  return call.args;
};

const decodeCommit = (data: Hex) => decodeFunctionData({ abi: POLICY_MANAGER_WRITES_ABI, data });

describe('prepareCommitSetup: the shape follows isAuthorized', () => {
  it('returns an atomic batch of the arming call then commitSetup on the first commit', async () => {
    const { client, seen } = build({ world: { authorized: false } });
    const prepared = (await client.prepareCommitSetup(DRAFT, PASSWORD)) as PreparedBatch;

    expect(prepared.kind).toBe('batch');
    expect(prepared.atomic).toBe(true);
    expect(prepared.block).toEqual(PIN);
    expect(prepared.calls).toHaveLength(2);

    const [arming, commit] = prepared.calls as [PreparedCall, PreparedCall];

    expect(arming.data).toBe(ARMING_DATA);
    expect(arming.sender).toBe('account');
    expect(arming.block).toEqual(PIN);
    expect(commit.block).toEqual(PIN);

    const decoded = decodeCommit(commit.data);

    expect(decoded.functionName).toBe('commitSetup');
    expect(decoded.args?.[0]?.toString().toLowerCase()).toBe(ACTION.toLowerCase());
    expect(decoded.args?.[1]).toBe(referenceCommitment(DRAFT, ACCOUNT, ACTION, 1n));
    expect(decoded.args?.[2]).toBe(1n);
    expect(decoded.args?.[3]).toBe('0x');
    expect(members(seen)).toContain('action.armingCall');
  });

  it('returns commitSetup alone on an account that authorizes the action, at the stored nonce plus one', async () => {
    const { client, seen } = build({ world: { authorized: true, state: standingState(COMMITTED, 4n, 900) } });
    const prepared = (await client.prepareCommitSetup(DRAFT, PASSWORD)) as PreparedCall;

    expect(prepared.kind).toBe('call');
    expect(prepared.block).toEqual(PIN);

    const decoded = decodeCommit(prepared.data);

    expect(decoded.args?.[1]).toBe(referenceCommitment(DRAFT, ACCOUNT, ACTION, 5n));
    expect(decoded.args?.[2]).toBe(5n);
    expect(members(seen)).not.toContain('action.armingCall');
  });

  it('returns the batch again on a re-authorization over a standing setup', async () => {
    const { client } = build({ world: { authorized: false, state: standingState(COMMITTED, 2n, 900) } });
    const prepared = (await client.prepareCommitSetup(DRAFT, PASSWORD)) as PreparedBatch;

    expect(prepared.kind).toBe('batch');
    expect(prepared.atomic).toBe(true);
    expect(prepared.calls[0]?.data).toBe(ARMING_DATA);
    expect(decodeCommit(prepared.calls[1]?.data ?? '0x').args?.[2]).toBe(3n);
  });

  it('reads the nonce through stateOf and isAuthorized at the one pinned block', async () => {
    const { client, seen } = build();

    await client.prepareCommitSetup(DRAFT, PASSWORD);

    expect(seen.blockTags).toEqual(['latest']);
    expect(members(seen)).toContain('manager.stateOf');
    expect(members(seen)).toContain('action.isAuthorized');

    for (const call of seen.parts.filter((part) => part.part !== 'events')) {
      expect(call.args[call.args.length - 1], `${call.part}.${call.member}`).toEqual(PIN);
    }
  });

  it('pins at the read tag the configuration names', async () => {
    const { client, seen } = build({ configuration: { blockTags: { read: 'finalized', watch: 'latest' } } });

    await client.prepareCommitSetup(DRAFT, PASSWORD);

    expect(seen.blockTags).toEqual(['finalized']);
  });
});

describe('prepareCommitSetup: the backup the draft names', () => {
  it('seals an encrypted backup that opens under the five authenticated values to the configuration without labels', async () => {
    const { client, seen } = build({ world: { state: standingState(COMMITTED, 6n, 900), authorized: true } });

    await client.prepareCommitSetup(DRAFT, PASSWORD);

    const args = commitArguments(seen);
    const commitment = referenceCommitment(DRAFT, ACCOUNT, ACTION, 7n);

    expect(args[1]).toBe(commitment);
    expect(args[2]).toBe(7n);

    const opened = await openBackup(args[4] as Hex, PASSWORD, {
      account: ACCOUNT,
      action: ACTION,
      setupCommitment: commitment,
      nonce: 7n,
      payloadVersion: BACKUP_PAYLOAD_VERSION,
    });

    expect(opened).toEqual(configurationOf(DRAFT));
  });

  it('draws a fresh cipher nonce, so two seals of one draft differ', async () => {
    const first = build();
    const second = build();

    await first.client.prepareCommitSetup(DRAFT, PASSWORD);
    await second.client.prepareCommitSetup(DRAFT, PASSWORD);

    expect(commitArguments(first.seen)[4]).not.toBe(commitArguments(second.seen)[4]);
  });

  it('commits an empty field for the empty choice', async () => {
    const { client, seen } = build();

    await client.prepareCommitSetup(withBackup(DRAFT, 'empty'));

    expect(commitArguments(seen)[4]).toBe('0x');
  });

  it('commits the serialized configuration, unpadded, for the clear choice', async () => {
    const { client, seen } = build();

    await client.prepareCommitSetup(withBackup(DRAFT, 'clear'));

    expect(commitArguments(seen)[4]).toBe(serializeConfiguration(configurationOf(DRAFT)));
  });

  it('passes the public metadata through unjudged, lower-cased', async () => {
    const { client, seen } = build();
    const draft = { ...DRAFT, privacy: { publicMetadata: '0xDEADBEEF' as Hex, backup: 'empty' as const } };

    await client.prepareCommitSetup(draft);

    expect(commitArguments(seen)[3]).toBe('0xdeadbeef');
  });

  it.each([
    ['encrypted without a password', DRAFT, undefined],
    ['clear with a password', withBackup(DRAFT, 'clear'), PASSWORD],
    ['empty with a password', withBackup(DRAFT, 'empty'), PASSWORD],
  ] as const)('refuses %s before any read', async (_name, draft, password) => {
    const { client, seen } = build();

    await expect(client.prepareCommitSetup(draft, password)).rejects.toThrow();
    expect(seen.provider).toEqual([]);
    expect(seen.parts).toEqual([]);
  });
});

describe('prepareCommitSetup: validation inside the prepare', () => {
  it('throws a KitRefusalError carrying every finding validateSetup returns, and prepares nothing', async () => {
    const reference = build();
    const findings = await reference.client.validateSetup(BAD_DRAFT);

    expect(findings.errors.length).toBeGreaterThan(0);

    const { client, seen } = build();
    const thrown = await client.prepareCommitSetup(BAD_DRAFT, PASSWORD).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(thrown).toBeInstanceOf(KitRefusalError);
    expect((thrown as KitRefusalError).findings).toEqual(findings);
    expect((thrown as KitRefusalError).restoreCause).toBeUndefined();
    expect(members(seen)).not.toContain('manager.prepareCommitSetup');
    expect(members(seen)).not.toContain('action.armingCall');
    expect(seen.calls).toEqual([]);
  });

  it('never blocks on a warning', async () => {
    const { client } = build();
    const draft = withBackup(DRAFT, 'clear');
    const findings = await client.validateSetup(draft);

    expect(findings.errors).toEqual([]);
    expect(findings.warnings.map((warning) => warning.code)).toContain('backup.clear');

    await expect(build().client.prepareCommitSetup(draft)).resolves.toBeDefined();
  });
});

describe('prepareCommitSetup: a code-less account', () => {
  it('reads the code first and, on 0x, makes no isAuthorized call and arms', async () => {
    const { client, seen } = build({ world: { code: '0x', authorized: { rejects: { data: '0x' } } } });
    const prepared = await client.prepareCommitSetup(DRAFT, PASSWORD);

    expect(prepared.kind).toBe('batch');
    expect(members(seen)).not.toContain('action.isAuthorized');
    expect(seen.codes.map((code) => code.address.toLowerCase())).toContain(ACCOUNT.toLowerCase());
    expect(seen.codes.every((code) => code.block === PIN.number)).toBe(true);
  });
});

describe('prepareCommitSetup: the version escape', () => {
  it('throws while the escape flag is set, preparing nothing', async () => {
    const { client, seen } = build({ escaped: true });

    await expect(client.prepareCommitSetup(DRAFT, PASSWORD)).rejects.toThrow();
    expect(members(seen)).not.toContain('manager.prepareCommitSetup');
    expect(members(seen)).not.toContain('action.armingCall');
  });

  it('prepares as usual with the flag explicitly false', async () => {
    const { client } = build({ escaped: false });

    await expect(client.prepareCommitSetup(DRAFT, PASSWORD)).resolves.toBeDefined();
  });
});
