import { describe, expect, it } from 'vitest';
import { SetupClient, type ClientConfiguration, type DeploymentDescriptor, type IProvider } from '../../src/index';
import {
  ACCOUNT,
  ACCOUNT_BAD_CHECKSUM,
  ACTION,
  codecFor,
  CONFIGURATION,
  defaultRegistry,
  defaultWorld,
  DESCRIPTOR,
  doubles,
} from './doubles';

/** Builds a client over fresh doubles with one record replaced, answering what it threw and how many provider reads ran. */
function construct(overrides: {
  readonly descriptor?: unknown;
  readonly configuration?: unknown;
  readonly dropProvider?: keyof IProvider;
}): { thrown: unknown; reads: number } {
  const made = doubles(defaultWorld());
  const provider = { ...made.provider } as Partial<IProvider>;

  if (overrides.dropProvider !== undefined) delete provider[overrides.dropProvider];

  try {
    new SetupClient(
      provider as IProvider,
      (overrides.descriptor ?? DESCRIPTOR) as DeploymentDescriptor,
      ACCOUNT,
      ACTION,
      (overrides.configuration ?? CONFIGURATION) as ClientConfiguration,
      'kit',
      made.manager,
      made.action,
      made.events,
      defaultRegistry(),
      codecFor(ACTION),
    );

    return { thrown: undefined, reads: made.seen.provider.length };
  } catch (thrown) {
    return { thrown, reads: made.seen.provider.length };
  }
}

describe('construction-time checks of the consumed fields', () => {
  it('builds over well-formed records with no provider read', () => {
    expect(construct({})).toEqual({ thrown: undefined, reads: 0 });
  });

  it.each([
    ['descriptor.manager not an address', { ...DESCRIPTOR, manager: '0x1234' }],
    ['descriptor.action with a bad checksum', { ...DESCRIPTOR, action: ACCOUNT_BAD_CHECKSUM }],
    ['descriptor.methodEcdsa not a string', { ...DESCRIPTOR, methodEcdsa: 7 }],
    ['descriptor.chainId negative', { ...DESCRIPTOR, chainId: -1 }],
    ['descriptor.deployedAt fractional', { ...DESCRIPTOR, deployedAt: 1.5 }],
    ['descriptor.deployedAt a string', { ...DESCRIPTOR, deployedAt: '100' }],
  ])('refuses %s at construction with no provider read', (_name, descriptor) => {
    const { thrown, reads } = construct({ descriptor });

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown instanceof TypeError || thrown instanceof RangeError).toBe(true);
    expect(reads).toBe(0);
  });

  it.each([
    ['configuration.maxWait negative', { ...CONFIGURATION, maxWait: -1 }],
    ['configuration.shortWait unsafe', { ...CONFIGURATION, shortWait: 2 ** 60 }],
    ['configuration.ruleCostBound a string', { ...CONFIGURATION, ruleCostBound: '1' }],
    ['configuration.defaultWait fractional', { ...CONFIGURATION, defaultWait: 0.5 }],
    ['configuration.simulate not a boolean', { ...CONFIGURATION, simulate: 'yes' }],
    ['configuration.candidateKeys not an array', { ...CONFIGURATION, candidateKeys: '0xabc' }],
    ['configuration.candidateKeys holding a malformed address', { ...CONFIGURATION, candidateKeys: ['0x12'] }],
    ['configuration.candidateKeys holding a bad checksum', { ...CONFIGURATION, candidateKeys: [ACCOUNT_BAD_CHECKSUM] }],
  ])('refuses %s at construction with no provider read', (_name, configuration) => {
    const { thrown, reads } = construct({ configuration });

    expect(thrown instanceof TypeError || thrown instanceof RangeError).toBe(true);
    expect(reads).toBe(0);
  });

  it.each(['block', 'call', 'code', 'transaction'] as const)('refuses a provider without %s at construction', (member) => {
    const { thrown, reads } = construct({ dropProvider: member });

    expect(thrown).toBeInstanceOf(TypeError);
    expect(reads).toBe(0);
  });
});
