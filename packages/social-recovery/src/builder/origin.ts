import { BUILDER_DEFAULT_DESCRIPTORS } from '../constants';
import { checkedDescriptor } from '../formats/records';
import type { Address, DeploymentDescriptor } from '../interfaces';
import type { DescriptorOrigin } from '../types/validation';

/** The chain's shipped descriptor, or nothing where no descriptor ships for that chain. */
export const shippedDescriptor = (chainId: number): DeploymentDescriptor | undefined =>
  Object.hasOwn(BUILDER_DEFAULT_DESCRIPTORS, chainId) ? BUILDER_DEFAULT_DESCRIPTORS[chainId] : undefined;

/** Whether two checksummed address lists name the same addresses in the same order. */
const sameList = (left: readonly Address[], right: readonly Address[]): boolean =>
  left.length === right.length && left.every((entry, index) => entry === right[index]);

/**
 * `kit` where the descriptor equals its chain's shipped descriptor in every field, addresses compared checksummed and the
 * audited sets in order; `integrator` otherwise. Throws a `TypeError` or `RangeError` on a malformed descriptor.
 */
export function descriptorOriginOf(descriptor: DeploymentDescriptor): DescriptorOrigin {
  const given = checkedDescriptor(descriptor, 'descriptor');
  const shipped = shippedDescriptor(given.chainId);

  if (shipped === undefined) return 'integrator';

  const kit = checkedDescriptor(shipped, 'shipped descriptor');
  const same =
    given.manager === kit.manager &&
    given.methodEcdsa === kit.methodEcdsa &&
    given.methodPasskey === kit.methodPasskey &&
    given.methodAadhaar === kit.methodAadhaar &&
    given.methodZkpassport === kit.methodZkpassport &&
    given.action === kit.action &&
    given.servedImplementation === kit.servedImplementation &&
    given.deployedAt === kit.deployedAt &&
    given.digestVersion === kit.digestVersion &&
    given.managerVersion === kit.managerVersion &&
    sameList(given.shippedMethods, kit.shippedMethods) &&
    sameList(given.auditedActions, kit.auditedActions);

  return same ? 'kit' : 'integrator';
}
