import { BUILDER_FROZEN_MESSAGE } from '../constants';
import type {
  Address,
  IActionCodec,
  IEventManager,
  IMethodModuleReads,
  IMethodsOrchestrator,
  IRecoveryActionInteractor,
  IRecoveryClient,
  IRecoveryMethod,
  ISetupClient,
  ISignerRecovery,
} from '../interfaces';
import type {
  ActionCodecOptions,
  BuilderInputs,
  BuilderPolicyManager,
  BuilderSession,
  BuilderSettings,
  EventManagerOptions,
  ManagerReading,
  RecoveryActionFactory,
  RecoveryActionPart,
  SocialRecoveryHolderInputs,
  SocialRecoveryInputs,
  SocialRecoveryKit,
} from '../types/builder';
import { checkedInputs } from './inputs';
import { BuilderMemo } from './memo';
import { checkedAction, checkedCodec, checkedEventManager, checkedMethod, checkedPolicyManager, checkedSignerRecovery } from './options';
import { checkedReading } from './reading';

/**
 * The one class that constructs the kit's classes: it fills every part the integrator did not hand over with the shipped one,
 * constructs each once and hands the same instances to both clients. The first build that reaches the chain runs the
 * construction checks; every build memoizes, and after the first successful one every `with*` call throws a `TypeError`.
 * A builder given no provider and no account builds the methods orchestrator alone.
 */
export class SocialRecoveryBuilder<I extends SocialRecoveryInputs = SocialRecoveryInputs> {
  readonly #source: I;

  readonly #inputs: BuilderInputs;

  #settings: BuilderSettings = {
    policyManager: undefined,
    eventManager: undefined,
    action: undefined,
    codecs: [],
    methods: [],
    signerRecovery: undefined,
    versionEscape: false,
    reading: undefined,
  };

  readonly #memo = new BuilderMemo();

  /** Throws a `TypeError` or `RangeError` on malformed inputs, before any provider call. */
  private constructor(inputs: I) {
    this.#source = inputs;
    this.#inputs = checkedInputs(this.#source);
  }

  /** A fresh builder over the inputs, checked before any provider call. */
  static from<I extends SocialRecoveryInputs>(inputs: I): SocialRecoveryBuilder<I> {
    return new SocialRecoveryBuilder(inputs);
  }

  /** The holder's kit from a fresh builder with every part the shipped one. */
  static async build(inputs: SocialRecoveryHolderInputs): Promise<SocialRecoveryKit> {
    return await SocialRecoveryBuilder.from(inputs).build();
  }

  /** Replaces the shipped policy manager with this instance. */
  withPolicyManager(manager: BuilderPolicyManager): this {
    return this.#set({ policyManager: checkedPolicyManager(manager) });
  }

  /** Replaces the shipped event manager with this instance, or constructs the shipped one with these arguments. */
  withEventManager(manager: IEventManager | EventManagerOptions): this {
    return this.#set({ eventManager: checkedEventManager(manager) });
  }

  /** Binds the clients to this action address, served by the part or factory given, else by the shipped Ambire part. */
  withRecoveryAction(address: Address, implementation?: RecoveryActionPart | RecoveryActionFactory): this {
    return this.#set({ action: checkedAction(address, implementation) });
  }

  /** Adds an action codec, an instance or the shipped codec's arguments, keyed on every action it serves. */
  withCodec(codec: IActionCodec | ActionCodecOptions): this {
    return this.#set({ codecs: [...this.#settings.codecs, checkedCodec(codec)] });
  }

  /** Adds a method implementation, keyed on the modules it claims under the descriptor; the shipped methods keep the modules no one claims. */
  withMethod(method: IRecoveryMethod): this {
    return this.#set({ methods: [...this.#settings.methods, checkedMethod(method)] });
  }

  /** Hands both clients the signer recovery their removed-key inference reads. */
  withSignerRecovery(signerRecovery: ISignerRecovery): this {
    return this.#set({ signerRecovery: checkedSignerRecovery(signerRecovery) });
  }

  /**
   * Downgrades the domain's `fields`, digest version and name checks and the body encoder check from refusals to a finding
   * the reading lists; where any of them failed, both clients and the handed-out action part refuse every prepare.
   */
  withVersionEscape(): this {
    return this.#set({ versionEscape: true });
  }

  /** Takes another builder's reading of the same chain and manager in place of reading the manager again. */
  withManagerReading(reading: ManagerReading): this {
    return this.#set({ reading: checkedReading(reading) });
  }

  /** This builder's reading of the manager, once a build has taken it. */
  managerReading(): ManagerReading | undefined {
    return this.#memo.reading;
  }

  /** The setup client, the recovery client and the methods orchestrator over one set of shared parts. */
  async build(this: SocialRecoveryBuilder<SocialRecoveryHolderInputs>): Promise<SocialRecoveryKit> {
    const session = await this.#built();

    return this.#memo.kit(session, this.buildMethodsOrchestrator());
  }

  async buildSetupClient(this: SocialRecoveryBuilder<SocialRecoveryHolderInputs>): Promise<ISetupClient> {
    return (await this.#built()).setupClient;
  }

  async buildRecoveryClient(this: SocialRecoveryBuilder<SocialRecoveryHolderInputs>): Promise<IRecoveryClient> {
    return (await this.#built()).recoveryClient;
  }

  /** The action part's reads and disarming write, never its arming write; under an escaped build the disarming write refuses. */
  async recoveryAction(this: SocialRecoveryBuilder<SocialRecoveryHolderInputs>): Promise<IRecoveryActionInteractor> {
    return (await this.#built()).recoveryAction;
  }

  /** The manager part's three module reads, never its prepares. */
  async methodModuleReads(this: SocialRecoveryBuilder<SocialRecoveryHolderInputs>): Promise<IMethodModuleReads> {
    return (await this.#built()).moduleReads;
  }

  /** The methods orchestrator over the two registries and the device bindings; it reads no chain and runs no check. */
  buildMethodsOrchestrator(): IMethodsOrchestrator {
    return this.#memo.orchestrator(this.#inputs, this.#settings);
  }

  /** Applies one setter's checked value, refusing with a `TypeError` once the builder has built. */
  #set(change: Partial<BuilderSettings>): this {
    if (this.#memo.frozen) throw new TypeError(BUILDER_FROZEN_MESSAGE);

    this.#settings = { ...this.#settings, ...change };

    return this;
  }

  /** The memoized session over the settings as they stand now. */
  #built(): Promise<BuilderSession> {
    return this.#memo.session(this.#inputs, this.#settings);
  }
}
