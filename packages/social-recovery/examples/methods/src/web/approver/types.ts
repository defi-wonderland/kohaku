import type { ApproverRequest, EnrollInput, Input, Material, Params } from '@kohaku-eth/social-recovery';

/** The material a device produced, with a check the flow runs after each later step (the wallet session's). */
export type MaterialStep = {
  readonly material: Material;
  readonly checkpoint?: () => void;
};

/** What one action hands a method: whether testing mode is on, and the abort signal of the Abort button. */
export type Run = {
  readonly testing: boolean;
  readonly signal: AbortSignal;
};

/** One method's side of the approver page: the parameters it passes the orchestrator and the material its device makes. */
export type ApproverMethod = {
  /** What testing mode simulates for this method, or `undefined` where the method has no testing mode. */
  readonly testingLabel: string | undefined;
  /** What real mode uses. */
  readonly realLabel: string;
  enrolParams(run: Run): Promise<Params>;
  enrolMaterial(input: EnrollInput, run: Run): Promise<MaterialStep>;
  signParams(request: ApproverRequest, run: Run): Promise<Params | undefined>;
  signMaterial(request: ApproverRequest, input: Input, run: Run): Promise<MaterialStep>;
};
