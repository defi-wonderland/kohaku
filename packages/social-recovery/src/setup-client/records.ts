import { FORMATS_SAFE_INTEGER_BITS } from '../constants';
import { assertArray, assertBool, assertObject, assertUintNumber, normalizeAddress } from '../formats/guards';
import { NAMED_BLOCK_TAGS, type ClientConfiguration, type DeploymentDescriptor } from '../interfaces';

/** The configuration's numbers the setup judgments read, each a non-negative safe integer. */
const CONFIGURATION_NUMBERS = ['defaultWait', 'shortWait', 'maxWait', 'ruleCostBound'] as const;

/** The descriptor with the addresses the client reads checksummed, refusing a malformed one or a number that is not a safe uint. */
export function checkedDescriptor(descriptor: DeploymentDescriptor): DeploymentDescriptor {
  assertObject(descriptor, 'descriptor');
  assertUintNumber(descriptor.chainId, FORMATS_SAFE_INTEGER_BITS, 'descriptor.chainId');
  assertUintNumber(descriptor.deployedAt, FORMATS_SAFE_INTEGER_BITS, 'descriptor.deployedAt');

  return {
    ...descriptor,
    manager: normalizeAddress(descriptor.manager, 'descriptor.manager'),
    action: normalizeAddress(descriptor.action, 'descriptor.action'),
    methodEcdsa: normalizeAddress(descriptor.methodEcdsa, 'descriptor.methodEcdsa'),
  };
}

/**
 * The configuration with its candidate keys checksummed, refusing a read tag that is not a named block tag, a number the
 * judgments read that is not a safe uint, a simulation default that is not a boolean and a candidate key that is not an address.
 */
export function checkedConfiguration(configuration: ClientConfiguration): ClientConfiguration {
  assertObject(configuration, 'configuration');
  assertObject(configuration.blockTags, 'configuration.blockTags');

  if (!NAMED_BLOCK_TAGS.includes(configuration.blockTags.read)) throw new TypeError('configuration.blockTags.read must be a named block tag');

  for (const member of CONFIGURATION_NUMBERS) {
    assertUintNumber(configuration[member], FORMATS_SAFE_INTEGER_BITS, `configuration.${member}`);
  }

  assertBool(configuration.simulate, 'configuration.simulate');
  assertArray(configuration.candidateKeys, 'configuration.candidateKeys');

  const candidateKeys = Array.from(configuration.candidateKeys, (key, index) => normalizeAddress(key, `configuration.candidateKeys[${index}]`));

  return { ...configuration, candidateKeys };
}
