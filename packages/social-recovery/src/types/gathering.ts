import type { Gathering, GatheringPlace, Standing } from '../interfaces';

/** What the init read for one place: its method's stop and pause holder and whether its config address holds code. */
export type PlaceStanding = {
  readonly standing: Standing;
  readonly stoppable: boolean;
  readonly credentialHoldsCode: boolean;
};

/** The purpose and request block a gathering is seeded from. */
export type GatheringMembers = Gathering extends infer Record
  ? Record extends Gathering
    ? Pick<Record, 'purpose' | 'request'>
    : never
  : never;

/** One filled place: its map entry and the position its reply holds in the filing order. */
export type FiledPlace = {
  readonly entry: GatheringPlace;
  readonly filedAt: number;
};
