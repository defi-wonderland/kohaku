import {
  creationPrivileges,
  FORMATS_ADDRESS_BYTES,
  FORMATS_CREATION_DEPLOY_HEAD,
  FORMATS_CREATION_DEPLOY_TAIL,
  FORMATS_CREATION_PUSH0_OPCODE,
  FORMATS_CREATION_RUNTIME_HEAD,
  FORMATS_CREATION_RUNTIME_TAIL,
  FORMATS_CREATION_SSTORE_OPCODE,
  FORMATS_CREATION_WORD_BYTES,
  POLICY_MANAGER_TRUE_WORD,
} from '@kohaku-eth/social-recovery';
import {
  type Abi,
  type Address,
  bytesToHex,
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  type Hex,
  hexToBigInt,
  keccak256,
  parseAbiItem,
  parseAbiParameters,
  size,
  toHex,
  trim,
} from 'viem';

/** The preimage of a privilege's storage slot: the privileged address, then the slot of the account's privileges mapping. */
export const PRIVILEGE_SLOT_PREIMAGE_ABI = parseAbiParameters('address, uint256');

/** The storage slot of the account's privileges mapping. */
export const PRIVILEGES_MAPPING_SLOT = 0n;

/** The byte count of a salt. */
const SALT_BYTES = 32;

/** A `0x`-prefixed 32-byte salt. */
const SALT_PATTERN = /^0x[0-9a-fA-F]{64}$/;

const opcode = (byte: number): Hex => toHex(byte, { size: 1 });

/** The slot the account's creation code writes for `signer`: `keccak256(abi.encode(signer, 0))`. */
export const privilegeSlot = (signer: Address): Hex =>
  keccak256(encodeAbiParameters(PRIVILEGE_SLOT_PREIMAGE_ABI, [signer, PRIVILEGES_MAPPING_SLOT]));

/**
 * The account's proxy creation code granting `signer` its privilege: one entry storing the true word's low byte at the
 * signer's slot, the deploy code with the runtime's offset, then the minimal proxy runtime over `implementation`.
 */
export function creationCode(signer: Address, implementation: Address): Hex {
  const value = trim(POLICY_MANAGER_TRUE_WORD);
  const entry = concat([
    opcode(FORMATS_CREATION_PUSH0_OPCODE + size(value)),
    value,
    opcode(FORMATS_CREATION_PUSH0_OPCODE + FORMATS_CREATION_WORD_BYTES),
    privilegeSlot(signer),
    opcode(FORMATS_CREATION_SSTORE_OPCODE),
  ]);
  const runtime = concat([
    FORMATS_CREATION_RUNTIME_HEAD,
    opcode(FORMATS_CREATION_PUSH0_OPCODE + FORMATS_ADDRESS_BYTES),
    implementation,
    FORMATS_CREATION_RUNTIME_TAIL,
  ]);
  const offset = size(entry) + size(FORMATS_CREATION_DEPLOY_HEAD) + 1 + size(FORMATS_CREATION_DEPLOY_TAIL);

  return concat([entry, FORMATS_CREATION_DEPLOY_HEAD, opcode(offset), FORMATS_CREATION_DEPLOY_TAIL, runtime]).toLowerCase() as Hex;
}

/** The creation code, the account its `CREATE2` gives and the slot it writes, checked by the SDK's own parser. */
export type CheckedCreation = { readonly code: Hex; readonly account: Address; readonly slot: Hex };

/**
 * Builds the creation code for `signer` and checks it with `creationPrivileges` before anything is sent: exactly one
 * entry, at the signer's slot, storing the true word. Any other parse throws.
 */
export function checkedCreation(factory: Address, signer: Address, implementation: Address, salt: Hex): CheckedCreation {
  if (!SALT_PATTERN.test(salt)) throw new Error('the salt must be 32 bytes, 0x-prefixed');

  const code = creationCode(signer, implementation);
  const slot = privilegeSlot(signer);
  const { account, entries } = creationPrivileges(factory, code, salt);
  const [entry] = entries;

  if (entries.length !== 1 || entry === undefined) throw new Error(`the creation code writes ${entries.length} entries, not one`);

  if (entry.slot.toLowerCase() !== slot.toLowerCase()) throw new Error(`the creation code writes slot ${entry.slot}, not the signer's ${slot}`);

  if (entry.value.toLowerCase() !== POLICY_MANAGER_TRUE_WORD.toLowerCase()) throw new Error(`the creation code stores ${entry.value}, not true`);

  return { code, account, slot };
}

/** A fresh random salt from the browser's cryptographic generator. */
export const randomSalt = (): Hex => bytesToHex(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));

/** The factory call deploying `code` under `salt`, encoded with the form's human-readable deploy function. */
export const deployCalldata = (deployFunction: string, code: Hex, salt: Hex): Hex =>
  encodeFunctionData({ abi: [parseAbiItem(deployFunction)] as Abi, args: [code, hexToBigInt(salt)] });
