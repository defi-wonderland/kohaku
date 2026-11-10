import { METHOD_ZKPASSPORT_CONFIG_FIELDS, METHOD_ZKPASSPORT_MAX_VALIDITY, METHOD_ZKPASSPORT_MIN_VALIDITY } from '../constants';
import type { ZkPassportConfig } from '../types';

const [IDENTIFIER_FIELD, , , VALIDITY_FIELD] = METHOD_ZKPASSPORT_CONFIG_FIELDS;

/**
 * The config fields, in layout order, that never verify: a zero identifier, and a validity period outside
 * `METHOD_ZKPASSPORT_MIN_VALIDITY` to `METHOD_ZKPASSPORT_MAX_VALIDITY`. The domain and scope are not judged.
 */
export function zkPassportConfigOutOfBounds(config: ZkPassportConfig): string[] {
  const period = config.validityPeriodInSeconds;
  const refused: readonly (readonly [string, boolean])[] = [
    [IDENTIFIER_FIELD, BigInt(config.uniqueIdentifier) === 0n],
    [VALIDITY_FIELD, period < METHOD_ZKPASSPORT_MIN_VALIDITY || period > METHOD_ZKPASSPORT_MAX_VALIDITY],
  ];

  return refused.filter(([, out]) => out).map(([field]) => field);
}
