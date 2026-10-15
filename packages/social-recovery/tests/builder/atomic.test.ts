import { describe, expect, it } from 'vitest';
import { BUILDER_FROZEN_MESSAGE, BUILDER_PENDING_MESSAGE, KitRefusalError, SocialRecoveryBuilder } from '../../src/index';
import { ChainDouble, EXTRA_MODULE, GatedDouble, MAINNET, failureOf, goodWorld, holder, methodClaiming, signerRecoveryStub } from './doubles';

type Builder = ReturnType<typeof SocialRecoveryBuilder.from<ReturnType<typeof holder>>>;

const MANAGER_READS = ['chainId', 'eip712Domain', 'version'];

/** The message of the TypeError a setter throws, failing the test when it does not throw one. */
function setterRefusal(set: () => unknown): string {
  try {
    set();
  } catch (thrown) {
    expect(thrown).toBeInstanceOf(TypeError);

    return (thrown as TypeError).message;
  }

  throw new Error('the setter was accepted');
}

describe('a bundle build failing after the clients were constructed', () => {
  it('caches nothing, leaves the setters open and reads the chain again on a retry', async () => {
    const provider = new ChainDouble();
    const method = methodClaiming([EXTRA_MODULE], 'no-such-binding');
    const builder = SocialRecoveryBuilder.from(holder(provider));

    expect(builder.withMethod(method)).toBe(builder);

    const thrown = await failureOf(() => builder.build());

    expect(thrown).toBeInstanceOf(Error);
    expect(provider.reads).toEqual(MANAGER_READS);
    expect(builder.managerReading()).toBeUndefined();
    expect(builder.withVersionEscape()).toBe(builder);

    await failureOf(() => builder.build());

    expect(provider.reads).toEqual([...MANAGER_READS, ...MANAGER_READS]);
    expect(builder.managerReading()).toBeUndefined();
    expect(builder.withSignerRecovery(signerRecoveryStub())).toBe(builder);

    method.deviceBinding = 'none';

    const kit = await builder.build();

    expect(provider.reads).toEqual([...MANAGER_READS, ...MANAGER_READS, ...MANAGER_READS]);
    expect(builder.managerReading()).toBeDefined();
    expect(await builder.buildSetupClient()).toBe(kit.setupClient);
    expect(builder.buildMethodsOrchestrator()).toBe(kit.methodsOrchestrator);
    expect(setterRefusal(() => builder.withVersionEscape())).toBe(BUILDER_FROZEN_MESSAGE);
  });

  it('caches no orchestrator from the failed attempt', async () => {
    const method = methodClaiming([EXTRA_MODULE], 'no-such-binding');
    const builder = SocialRecoveryBuilder.from(holder()).withMethod(method);

    await failureOf(() => builder.build());

    expect(() => builder.buildMethodsOrchestrator()).toThrow();

    method.deviceBinding = 'none';

    expect(() => builder.buildMethodsOrchestrator()).not.toThrow();
  });

  it('keeps an earlier successful named build cached and frozen', async () => {
    const provider = new ChainDouble();
    const builder = SocialRecoveryBuilder.from(holder(provider)).withMethod(methodClaiming([EXTRA_MODULE], 'no-such-binding'));
    const setup = await builder.buildSetupClient();
    const reading = builder.managerReading();

    expect(reading).toBeDefined();

    await failureOf(() => builder.build());

    expect(await builder.buildSetupClient()).toBe(setup);
    expect(builder.managerReading()).toBe(reading);
    expect(provider.reads).toEqual(MANAGER_READS);
    expect(setterRefusal(() => builder.withVersionEscape())).toBe(BUILDER_FROZEN_MESSAGE);
  });
});

describe('a setter called while a build is pending', () => {
  it('refuses with its own message, distinct from the message after a success', () => {
    expect(BUILDER_PENDING_MESSAGE).not.toBe(BUILDER_FROZEN_MESSAGE);
    expect(BUILDER_PENDING_MESSAGE.length).toBeGreaterThan(0);
  });

  it.each([
    ['build', (builder: Builder) => builder.build()],
    ['buildSetupClient', (builder: Builder) => builder.buildSetupClient()],
    ['recoveryAction', (builder: Builder) => builder.recoveryAction()],
    ['methodModuleReads', (builder: Builder) => builder.methodModuleReads()],
  ] as const)('reopens the setters after a pending %s fails by refusal', async (_name, run) => {
    const provider = new GatedDouble();
    const builder = SocialRecoveryBuilder.from(holder(provider));

    provider.hold();

    const pending = run(builder);

    expect(setterRefusal(() => builder.withVersionEscape())).toBe(BUILDER_PENDING_MESSAGE);
    expect(setterRefusal(() => builder.withSignerRecovery(signerRecoveryStub()))).toBe(BUILDER_PENDING_MESSAGE);

    provider.release({ ...goodWorld(), chainId: MAINNET });

    expect(await failureOf(() => pending)).toBeInstanceOf(KitRefusalError);
    expect(builder.managerReading()).toBeUndefined();
    expect(builder.withVersionEscape()).toBe(builder);
  });

  it('reopens the setters after a pending build fails in transport, and a retry reads again', async () => {
    const failure = new Error('socket closed');
    const provider = new GatedDouble();
    const builder = SocialRecoveryBuilder.from(holder(provider));

    provider.hold();

    const pending = builder.build();

    expect(setterRefusal(() => builder.withVersionEscape())).toBe(BUILDER_PENDING_MESSAGE);

    provider.release({ ...goodWorld(), chainId: { rejects: failure } });

    expect(await failureOf(() => pending)).toBe(failure);
    expect(builder.withVersionEscape()).toBe(builder);

    provider.world = goodWorld();

    await builder.build();

    expect(provider.reads).toEqual(['chainId', ...MANAGER_READS]);
  });

  it('stays frozen with the frozen message after the pending build succeeds', async () => {
    const provider = new GatedDouble();
    const builder = SocialRecoveryBuilder.from(holder(provider));

    provider.hold();

    const pending = builder.build();

    expect(setterRefusal(() => builder.withVersionEscape())).toBe(BUILDER_PENDING_MESSAGE);

    provider.release();
    await pending;

    expect(setterRefusal(() => builder.withVersionEscape())).toBe(BUILDER_FROZEN_MESSAGE);
    expect(setterRefusal(() => builder.withSignerRecovery(signerRecoveryStub()))).toBe(BUILDER_FROZEN_MESSAGE);
    expect(builder.managerReading()?.versionMismatch).toBe(false);
  });
});
