import { BUILDER_APPROVER_MESSAGE, BUILDER_UNRESOLVED_CHAIN_MESSAGE } from '../constants';
import type { IMethodsOrchestrator } from '../interfaces';
import { MethodsOrchestrator } from '../methods-orchestrator';
import type { BuilderInputs, BuilderRegistries, BuilderSession, BuilderSettings, ManagerReading, SocialRecoveryKit } from '../types/builder';
import { resolvedDescriptor } from './inputs';
import { assembledSession } from './parts';
import { builtRegistries } from './registries';
import { constructionChecks } from './sequence';

/** The construction checks, then every shared part and both clients over the settings as they stood when it started. */
async function constructedSession(
  inputs: BuilderInputs,
  settings: BuilderSettings,
  registries: () => BuilderRegistries | undefined,
): Promise<BuilderSession> {
  const { holder } = inputs;

  if (holder === undefined) throw new TypeError(BUILDER_APPROVER_MESSAGE);

  const { descriptor, reading } = await constructionChecks({
    provider: holder.provider,
    descriptor: inputs.descriptor,
    chainId: inputs.chainId,
    readTag: holder.configuration.blockTags.read,
    versionEscape: settings.versionEscape,
    reading: settings.reading,
  });

  return assembledSession(holder, descriptor, reading, registries() ?? builtRegistries(descriptor, settings), settings);
}

/** What one builder has constructed: each entry once, frozen against further settings after the first success. */
export class BuilderMemo {
  #frozen = false;
  #pending: Promise<BuilderSession> | undefined;
  #session: BuilderSession | undefined;
  #registries: BuilderRegistries | undefined;
  #orchestrator: IMethodsOrchestrator | undefined;
  #kit: SocialRecoveryKit | undefined;

  /** Whether a build has succeeded or is still running, either of which bars a setting from changing. */
  get frozen(): boolean {
    return this.#frozen || this.#pending !== undefined;
  }

  /** The reading the session took, once one has. */
  get reading(): ManagerReading | undefined {
    return this.#session?.reading;
  }

  /** The session, constructed once; a failed construction caches nothing, so a later build runs the checks again. */
  session(inputs: BuilderInputs, settings: BuilderSettings): Promise<BuilderSession> {
    this.#pending ??= constructedSession(inputs, settings, () => this.#registries).then(
      (session) => {
        this.#session = session;
        this.#registries = session.registries;
        this.#frozen = true;

        return session;
      },
      (thrown: unknown) => {
        this.#pending = undefined;

        throw thrown;
      },
    );

    return this.#pending;
  }

  /**
   * The orchestrator over the registries the session keyed, else over registries keyed under the descriptor the inputs
   * name; a holder that names no chain gets a `TypeError` until a client build has resolved one.
   */
  orchestrator(inputs: BuilderInputs, settings: BuilderSettings): IMethodsOrchestrator {
    if (this.#orchestrator !== undefined) return this.#orchestrator;

    if (this.#registries === undefined && inputs.chainId === undefined) throw new TypeError(BUILDER_UNRESOLVED_CHAIN_MESSAGE);

    const registries = this.#registries ?? builtRegistries(resolvedDescriptor(inputs.descriptor, inputs.chainId as number), settings);
    const orchestrator = new MethodsOrchestrator(registries.methods, registries.codecs, inputs.bindings);

    this.#registries = registries;
    this.#orchestrator = orchestrator;
    this.#frozen = true;

    return orchestrator;
  }

  /** The three entries of one session as one frozen record, the same record on every call. */
  kit(session: BuilderSession, methodsOrchestrator: IMethodsOrchestrator): SocialRecoveryKit {
    this.#kit ??= Object.freeze({ setupClient: session.setupClient, recoveryClient: session.recoveryClient, methodsOrchestrator });

    return this.#kit;
  }
}
