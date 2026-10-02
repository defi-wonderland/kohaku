import type {
  Address,
  ClientConfiguration,
  DeploymentDescriptor,
  IActionCodec,
  ReadResult,
  RemovedKey,
} from '../interfaces';
import type { ActionReads, MethodReads } from './validation';

/** Action codec implementations, keyed by the action address each serves. */
export type ActionCodecRegistry = ReadonlyMap<Address, IActionCodec>;

/** One named method module's reads at the pinned block, with its pause holder beside them. */
export type MethodDescriptionReads = MethodReads & {
  readonly pauseHolder: ReadResult<Address>;
};

/** The action's `isAuthority` answer for one of the configuration's candidate keys. */
export type CandidateKeyAuthority = {
  readonly key: Address;
  readonly isAuthority: boolean;
};

/** The reads a setup client hands `describeSetup`, all pinned to one block. */
export type SetupDescriptionContext = {
  readonly descriptor: DeploymentDescriptor;
  readonly configuration: ClientConfiguration;
  /** One entry per distinct method the draft names. */
  readonly methods: readonly MethodDescriptionReads[];
  readonly action: ActionReads;
  /** One entry per address of the configuration's `candidateKeys`. */
  readonly candidateKeys: readonly CandidateKeyAuthority[];
  /** As the client computed it; `describeSetup` copies it and infers nothing. */
  readonly removedKey: RemovedKey;
};
