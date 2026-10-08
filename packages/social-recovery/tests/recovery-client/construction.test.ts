import { describe, expect, it } from 'vitest';
import type { ClientConfiguration, DeploymentDescriptor } from '../../src/index';
import { CLIENT_CONFIGURATION, CONFIGURATION, DESCRIPTOR, HANDOVER, ORDER, rig, world, type Seen } from './doubles';

const BAD_CHECKSUM = '0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';

const isArgumentError = (thrown: unknown): boolean => thrown instanceof TypeError || thrown instanceof RangeError;

/** What the construction threw, beside every read the doubles saw. */
function construct(descriptor: DeploymentDescriptor, configuration: ClientConfiguration = CLIENT_CONFIGURATION): { thrown: unknown; seen: Seen[] } {
  const seen: Seen[] = [];

  try {
    rig(world(), configuration, { descriptor, seen });
  } catch (thrown) {
    return { thrown, seen };
  }

  return { thrown: undefined, seen };
}

const descriptorWith = (member: string, value: unknown): DeploymentDescriptor => ({ ...DESCRIPTOR, [member]: value }) as DeploymentDescriptor;

describe('construction refuses a malformed consumed field with no read', () => {
  it.each([
    ['manager, a bad checksum', 'manager', BAD_CHECKSUM],
    ['manager, a short address', 'manager', '0x1234'],
    ['manager, not a string', 'manager', 7],
    ['action, a bad checksum', 'action', BAD_CHECKSUM],
    ['action, missing', 'action', undefined],
    ['chainId, negative', 'chainId', -1],
    ['chainId, fractional', 'chainId', 1.5],
    ['chainId, past the safe integers', 'chainId', 2 ** 53],
    ['chainId, a decimal string', 'chainId', '11155111'],
    ['deployedAt, negative', 'deployedAt', -1],
    ['deployedAt, a bigint', 'deployedAt', 100n],
    ['digestVersion, a number', 'digestVersion', 1],
    ['digestVersion, empty', 'digestVersion', ''],
    ['digestVersion, not decimal', 'digestVersion', 'v1'],
  ])('descriptor %s', (_name, member, value) => {
    const { thrown, seen } = construct(descriptorWith(member, value));

    expect(isArgumentError(thrown)).toBe(true);
    expect(seen).toEqual([]);
  });

  it.each([
    ['negative', -1],
    ['fractional', 1.5],
    ['a string', '7200'],
    ['past the safe integers', 2 ** 53],
  ])('configuration cancelWindow %s', (_name, value) => {
    const { thrown, seen } = construct(DESCRIPTOR, { ...CLIENT_CONFIGURATION, cancelWindow: value as number });

    expect(isArgumentError(thrown)).toBe(true);
    expect(seen).toEqual([]);
  });

  it.each(['pending', 7, undefined])('configuration blockTags.read %j', (tag) => {
    const { thrown, seen } = construct(DESCRIPTOR, { ...CLIENT_CONFIGURATION, blockTags: { read: tag as 'latest', watch: 'latest' } });

    expect(isArgumentError(thrown)).toBe(true);
    expect(seen).toEqual([]);
  });

  it('the well-formed descriptor and configuration construct with no read', () => {
    const { thrown, seen } = construct(DESCRIPTOR);

    expect(thrown).toBeUndefined();
    expect(seen).toEqual([]);
  });

  it('all-lower and all-upper spellings of the addresses are accepted and come back checksummed in the record', async () => {
    const descriptor = {
      ...DESCRIPTOR,
      manager: DESCRIPTOR.manager.toLowerCase() as `0x${string}`,
      action: `0x${DESCRIPTOR.action.slice(2).toUpperCase()}` as `0x${string}`,
    };
    const { client } = rig(world(), CLIENT_CONFIGURATION, { descriptor });
    const record = await client.initRecoveryGathering(CONFIGURATION, HANDOVER, ORDER, { window: 3_600 });

    expect(record.request.manager).toBe(DESCRIPTOR.manager);
  });
});
