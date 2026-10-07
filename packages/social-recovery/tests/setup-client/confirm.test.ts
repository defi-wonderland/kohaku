import { describe, expect, it } from 'vitest';
import type { PreparedBatch, PreparedCall } from '../../src/index';
import {
  ACCOUNT,
  ACTION,
  BOUND_FILTER,
  build,
  COMMITTED,
  committed,
  DRAFT,
  HEADER,
  members,
  PIN,
  position,
  referenceCommitment,
  standingState,
  withBackup,
} from './doubles';

const DRAFT_EMPTY = withBackup(DRAFT, 'empty');
const LATER = { number: HEADER.number + 12, timestamp: HEADER.timestamp + 144, hash: `0x${'6c'.repeat(32)}` as const };
const LATER_PIN = { number: LATER.number, hash: LATER.hash };

/** A first-commit batch and a later single commit, both prepared at `PIN` over doubles. */
async function preparedCommits(): Promise<{ batch: PreparedBatch; single: PreparedCall }> {
  const batch = (await build().client.prepareCommitSetup(DRAFT_EMPTY)) as PreparedBatch;
  const single = (await build({ world: { authorized: true, state: standingState(COMMITTED, 4n, 900) } }).client.prepareCommitSetup(
    DRAFT_EMPTY,
  )) as PreparedCall;

  return { batch, single };
}

describe('confirmSetup', () => {
  it('answers landed with the event position when the event at the predicted nonce carries the commitment', async () => {
    const { batch } = await preparedCommits();
    const commitment = referenceCommitment(DRAFT_EMPTY, ACCOUNT, ACTION, 1n);
    const at = position(HEADER.number + 3, 2);
    const { client, seen } = build({ world: { header: LATER, authorized: true, bound: [committed(1n, commitment, '0x', at)] } });
    const confirmation = await client.confirmSetup(DRAFT_EMPTY, batch);

    expect(confirmation).toEqual({ landed: true, nonce: 1n, setupCommitment: commitment, isAuthorized: true, position: at });
    expect('cause' in confirmation).toBe(false);
    expect(seen.fetches).toEqual([{ filter: BOUND_FILTER, range: { from: PIN.number, to: LATER.number } }]);
    expect(seen.filterOptions.every((options) => options?.allActions !== true)).toBe(true);
  });

  it('decodes the nonce and commitment of a single commitSetup call', async () => {
    const { single } = await preparedCommits();
    const commitment = referenceCommitment(DRAFT_EMPTY, ACCOUNT, ACTION, 5n);
    const at = position(HEADER.number + 1);
    const { client } = build({ world: { header: LATER, authorized: true, bound: [committed(5n, commitment, '0x', at)] } });
    const confirmation = await client.confirmSetup(DRAFT_EMPTY, single);

    expect(confirmation.landed).toBe(true);
    expect(confirmation.nonce).toBe(5n);
    expect(confirmation.setupCommitment).toBe(commitment);
    expect(confirmation.position).toEqual(at);
  });

  it("answers 'no-event' with no position when nothing was committed at the nonce", async () => {
    const { batch } = await preparedCommits();
    const commitment = referenceCommitment(DRAFT_EMPTY, ACCOUNT, ACTION, 1n);
    const { client } = build({
      world: { header: LATER, authorized: false, bound: [committed(2n, `0x${'99'.repeat(32)}`, '0x', position(HEADER.number + 2))] },
    });
    const confirmation = await client.confirmSetup(DRAFT_EMPTY, batch);

    expect(confirmation).toEqual({ landed: false, cause: 'no-event', nonce: 1n, setupCommitment: commitment, isAuthorized: false });
    expect('position' in confirmation).toBe(false);
  });

  it("answers 'other-commitment' with that event's position when the nonce carries another commitment", async () => {
    const { batch } = await preparedCommits();
    const other = `0x${'ab'.repeat(32)}` as const;
    const at = position(HEADER.number + 4, 1);
    const { client } = build({ world: { header: LATER, authorized: true, bound: [committed(1n, other, '0x', at)] } });
    const confirmation = await client.confirmSetup(DRAFT_EMPTY, batch);

    expect(confirmation.landed).toBe(false);
    expect(confirmation.cause).toBe('other-commitment');
    expect(confirmation.position).toEqual(at);
    expect(confirmation.setupCommitment).toBe(referenceCommitment(DRAFT_EMPTY, ACCOUNT, ACTION, 1n));
  });

  it('ignores a setup-cleared event at the nonce', async () => {
    const { batch } = await preparedCommits();
    const { client } = build({
      world: {
        header: LATER,
        bound: [{ kind: 'setup-cleared', account: ACCOUNT, action: ACTION, nonce: 1n, at: position(HEADER.number + 1) }],
      },
    });

    expect((await client.confirmSetup(DRAFT_EMPTY, batch)).cause).toBe('no-event');
  });

  it('throws when the draft does not recompute to the commitment the prepare carried', async () => {
    const { batch } = await preparedCommits();
    const { client } = build({ world: { header: LATER } });

    await expect(client.confirmSetup({ ...DRAFT_EMPTY, wait: DRAFT_EMPTY.wait + 1 }, batch)).rejects.toThrow();
  });

  it('pins once at the read tag, not the watch tag, and reads isAuthorized at that block', async () => {
    const { batch } = await preparedCommits();
    const { client, seen } = build({
      world: { header: LATER },
      configuration: { blockTags: { read: 'latest', watch: 'finalized' } },
    });

    await client.confirmSetup(DRAFT_EMPTY, batch);

    expect(seen.blockTags).toEqual(['latest']);
    expect(members(seen)).toContain('action.isAuthorized');

    for (const call of seen.parts.filter((part) => part.part !== 'events')) {
      expect(call.args[call.args.length - 1]).toEqual(LATER_PIN);
    }
  });

  it('reads a code-less account as unauthorized without calling isAuthorized', async () => {
    const { batch } = await preparedCommits();
    const { client, seen } = build({ world: { header: LATER, code: '0x', authorized: { rejects: { data: '0x' } } } });
    const confirmation = await client.confirmSetup(DRAFT_EMPTY, batch);

    expect(confirmation.isAuthorized).toBe(false);
    expect(members(seen)).not.toContain('action.isAuthorized');
  });

  it('rejects with a fetch transport failure as itself', async () => {
    const { batch } = await preparedCommits();
    const failure = new Error('timeout');
    const { client } = build({ world: { header: LATER, bound: { rejects: failure } } });

    await expect(client.confirmSetup(DRAFT_EMPTY, batch)).rejects.toBe(failure);
  });

  it('refuses a prepared record that carries no commitSetup', async () => {
    const clear = await build({ world: { state: standingState(COMMITTED, 3n, 900) } }).client.prepareClearSetup();
    const { client } = build({ world: { header: LATER } });

    await expect(client.confirmSetup(DRAFT_EMPTY, clear)).rejects.toThrow();
  });
});
