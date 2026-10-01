/** A request window as the record carrying it states it, every value in seconds. */
export type WindowFacts = {
  readonly validUntil: number;
  /** The pinned block's timestamp, where the window is measured from. */
  readonly blockTimestamp: number;
  /** Present on a cancellation alone: when the attempt it cancels becomes spendable. */
  readonly consumableAfter?: number;
};
