import type { Ctx, PaymentOrder } from '../interfaces';
import type { CancellationMembers } from './formats';

/** A request checked whole: the ctx an implementation reads, with the converted members its digest closes over. */
export type CheckedRequest = {
  readonly ctx: Ctx;
  readonly members: CancellationMembers;
  /** The opening request's order; absent for a cancellation. */
  readonly order: PaymentOrder | undefined;
};
