import { seed } from '../gathering';
import type {
  Address,
  ClientConfiguration,
  ConfigurationSource,
  DeploymentDescriptor,
  Gathering,
  Handover,
  IActionCodec,
  IEventManager,
  IPolicyManagerInteractor,
  IProvider,
  IRecoveryActionInteractor,
  ISignerRecovery,
  PaymentOrder,
  ValidityWindow,
} from '../interfaces';
import type { MethodRegistry } from '../types';
import type { RecoveryClientParts } from '../types/recovery-client';
import { assertSource, cancellingWindow, checkedHandover, serializedOrder, windowEnd, windowWidth } from './arguments';
import { namedHandover } from './handover';
import { assertAttemptWaiting, assertNoAttemptWaiting, gatheredSetup, readState } from './reading';
import { sharedRequest } from './record';
import { checkedParts } from './parts';

/**
 * The entry an integrator builds when a key is lost, bound to one chain, deployment, account and action.
 * Each init pins one block at the read tag and reads everything behind it at that block; it holds no state between calls.
 */
export class RecoveryClient {
  /** The event manager shared with the setup client. */
  readonly events: IEventManager;
  private readonly parts: RecoveryClientParts;

  /** Throws a `TypeError` on a malformed part or address and a `RangeError` where the codec does not serve the action. */
  constructor(
    provider: IProvider,
    descriptor: DeploymentDescriptor,
    account: Address,
    action: Address,
    configuration: ClientConfiguration,
    policyManager: IPolicyManagerInteractor,
    recoveryAction: IRecoveryActionInteractor,
    events: IEventManager,
    methods: MethodRegistry,
    codec: IActionCodec,
    signerRecovery?: ISignerRecovery,
  ) {
    this.parts = checkedParts({
      provider,
      descriptor,
      account,
      action,
      configuration,
      policyManager,
      recoveryAction,
      events,
      methods,
      codec,
      signerRecovery,
    });
    this.events = this.parts.events;
  }

  /**
   * The approval gathering for a handover, its payload encoded through the codec and its deadline the pinned block's
   * timestamp plus the window. Throws a `TypeError` or `RangeError` on a malformed argument before any read, and a
   * `KitRefusalError` while an attempt is waiting, on a restore cause or on a handover the action would refuse.
   */
  async initRecoveryGathering(
    source: ConfigurationSource,
    handover: Handover,
    order: PaymentOrder,
    window: ValidityWindow,
  ): Promise<Gathering> {
    const { parts } = this;
    const given = checkedHandover(handover);
    const storedOrder = serializedOrder(order);
    const width = windowWidth(window);

    assertSource(source);

    const reading = await readState(parts);

    assertNoAttemptWaiting(reading.state);

    const validUntil = windowEnd(reading.pinned.header.timestamp, width);
    const setup = await gatheredSetup(parts, source, reading);
    const named = await namedHandover(parts, given, reading.pinned.block);
    const request = sharedRequest(parts, reading, setup, reading.state.nextAttemptId, reading.state.setupNonce, validUntil);

    return seed({ purpose: 'approval', request: { ...request, payload: parts.codec.encode(named), order: storedOrder } }, setup.places);
  }

  /**
   * The cancellation gathering for the attempt waiting, its `consumableAfter` copied from the manager.
   * Throws a `TypeError` or `RangeError` on a malformed argument or a window longer than the configured cancel window
   * before any read, and a `KitRefusalError` while no attempt is waiting or on a restore cause.
   */
  async initCancelGathering(source: ConfigurationSource, window: ValidityWindow): Promise<Gathering> {
    const { parts } = this;
    const width = cancellingWindow(window, parts.configuration);

    assertSource(source);

    const reading = await readState(parts);
    const { attempt, setupNonce } = reading.state;

    assertAttemptWaiting(reading.state, parts);

    const validUntil = windowEnd(reading.pinned.header.timestamp, width);
    const setup = await gatheredSetup(parts, source, reading);
    const request = sharedRequest(parts, reading, setup, attempt.attemptId, setupNonce, validUntil);

    return seed({ purpose: 'cancellation', request: { ...request, consumableAfter: String(attempt.consumableAfter) } }, setup.places);
  }
}
