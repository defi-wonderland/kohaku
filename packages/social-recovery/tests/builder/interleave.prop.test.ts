import fc from 'fast-check';
import { getAddress } from 'viem';
import { beforeAll, describe, expect, it } from 'vitest';
import { SocialRecoveryBuilder, type ManagerReading } from '../../src/index';
import {
  ACTION,
  ChainDouble,
  FC_PARAMS,
  TIMEOUT,
  actionStub,
  codecServing,
  eventsStub,
  holder,
  managerStub,
  methodServing,
  signerRecoveryStub,
} from './doubles';

type Builder = ReturnType<typeof SocialRecoveryBuilder.from<ReturnType<typeof holder>>>;

const SETTERS = [
  'withPolicyManager',
  'withEventManager',
  'withEventManagerOptions',
  'withRecoveryAction',
  'withCodec',
  'withCodecOptions',
  'withMethod',
  'withSignerRecovery',
  'withVersionEscape',
  'withManagerReading',
] as const;

const BUILDS = ['build', 'buildSetupClient', 'buildRecoveryClient', 'buildMethodsOrchestrator', 'recoveryAction', 'methodModuleReads'] as const;

type Step = { readonly kind: 'set'; readonly name: (typeof SETTERS)[number] } | { readonly kind: 'build'; readonly name: (typeof BUILDS)[number] };

let READING: ManagerReading;

beforeAll(async () => {
  const builder = SocialRecoveryBuilder.from(holder());

  await builder.buildSetupClient();
  READING = builder.managerReading()!;
});

/** A fresh address per call, so added methods and codecs never collide. */
const fresh = (counter: { value: number }) => getAddress(`0x${(0xf000 + (counter.value += 1)).toString(16).padStart(40, '0')}`);

function set(builder: Builder, name: (typeof SETTERS)[number], counter: { value: number }): unknown {
  switch (name) {
    case 'withPolicyManager':
      return builder.withPolicyManager(managerStub());
    case 'withEventManager':
      return builder.withEventManager(eventsStub());
    case 'withEventManagerOptions':
      return builder.withEventManager({ logChunkSize: 1 + counter.value });
    case 'withRecoveryAction':
      return builder.withRecoveryAction(ACTION, actionStub());
    case 'withCodec':
      return builder.withCodec(codecServing(fresh(counter)));
    case 'withCodecOptions':
      return builder.withCodec({ actions: [fresh(counter)] });
    case 'withMethod':
      return builder.withMethod(methodServing([fresh(counter)]));
    case 'withSignerRecovery':
      return builder.withSignerRecovery(signerRecoveryStub());
    case 'withVersionEscape':
      return builder.withVersionEscape();
    case 'withManagerReading':
      return builder.withManagerReading(READING);
  }
}

/** The instances one build hands out, flattened so a bundle compares member by member. */
async function run(builder: Builder, name: (typeof BUILDS)[number]): Promise<readonly unknown[]> {
  const result = await builder[name]();

  return name === 'build' ? Object.values(result as object) : [result];
}

const stepArbitrary: fc.Arbitrary<Step> = fc.oneof(
  fc.constantFrom(...SETTERS).map((name): Step => ({ kind: 'set', name })),
  fc.constantFrom(...BUILDS).map((name): Step => ({ kind: 'build', name })),
);

describe('setter and build interleavings', () => {
  it(
    'refuse every setter after the first successful build and hand back the memoized instances',
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.array(stepArbitrary, { minLength: 1, maxLength: 8 }), async (steps) => {
          const provider = new ChainDouble();
          const builder = SocialRecoveryBuilder.from(holder(provider));
          const counter = { value: 0 };
          const seen = new Map<string, readonly unknown[]>();
          let frozen = false;

          for (const step of steps) {
            if (step.kind === 'set') {
              if (frozen) expect(() => set(builder, step.name, counter)).toThrow(TypeError);
              else expect(set(builder, step.name, counter)).toBe(builder);

              continue;
            }

            const instances = await run(builder, step.name);
            const first = seen.get(step.name);

            if (first === undefined) seen.set(step.name, instances);
            else instances.forEach((instance, place) => expect(instance).toBe(first[place]));

            frozen = true;
          }

          expect(provider.managerCalls()).toBeLessThanOrEqual(2);
          expect(provider.reads.filter((read) => read === 'chainId').length).toBeLessThanOrEqual(1);
        }),
        FC_PARAMS,
      );
    },
    TIMEOUT,
  );
});
