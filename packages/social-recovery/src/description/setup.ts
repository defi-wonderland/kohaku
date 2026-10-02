import { FORMATS_SAFE_INTEGER_BITS } from '../constants';
import { assertArray, assertBool, assertBytes, assertObject, assertUintNumber, normalizeAddress } from '../formats/guards';
import {
  REMOVED_KEY_UNNAMED,
  type Address,
  type DescribedClause,
  type FailureDomain,
  type RemovedKey,
  type SetupDescription,
  type SetupDraft,
} from '../interfaces';
import type { CandidateKeyAuthority, MethodDescriptionReads, SetupDescriptionContext } from '../types/description';
import type { PlacedCredential } from '../types/validation';
import { normalizeAddresses } from '../validation/common';
import { placedCredentials } from '../validation/setup-draft';
import { describedParties, distinctMethods, methodStanding, passkeyDomains, pauseOf, readsByMethod } from './setup-methods';

/** Refuses a context whose records are not the shapes they declare. */
function assertDescriptionContext(context: SetupDescriptionContext): void {
  assertObject(context, 'context');
  assertObject(context.descriptor, 'context.descriptor');
  assertObject(context.configuration, 'context.configuration');
  assertObject(context.action, 'context.action');
  assertUintNumber(context.configuration.defaultWait, FORMATS_SAFE_INTEGER_BITS, 'context.configuration.defaultWait');
}

/** The removed key as given: a checksummed address or one of the reasons none could be named. */
function removedKeyOf(value: RemovedKey): RemovedKey {
  if ((REMOVED_KEY_UNNAMED as readonly unknown[]).includes(value)) return value;

  return normalizeAddress(value, 'context.removedKey');
}

/** Per configured candidate key its `isAuthority` answer, refusing a key the context holds no answer for. */
function candidateKeysOf(context: SetupDescriptionContext): SetupDescription['candidateKeys'] {
  assertArray(context.candidateKeys, 'context.candidateKeys');

  const answers = new Map<Address, boolean>();

  context.candidateKeys.forEach((entry: CandidateKeyAuthority, index) => {
    assertObject(entry, `context.candidateKeys[${index}]`);
    assertBool(entry.isAuthority, `context.candidateKeys[${index}].isAuthority`);
    answers.set(normalizeAddress(entry.key, `context.candidateKeys[${index}].key`), entry.isAuthority);
  });

  return normalizeAddresses(context.configuration.candidateKeys, 'context.configuration.candidateKeys').map((key) => {
    const isAuthority = answers.get(key);

    if (isAuthority === undefined) throw new TypeError(`context.candidateKeys holds no answer for ${key}`);

    return { key, isAuthority };
  });
}

/** The clauses with each credential's method name and label, and no salt. */
function ruleOf(
  draft: SetupDraft,
  credentials: readonly PlacedCredential[],
  table: ReadonlyMap<Address, MethodDescriptionReads>,
): DescribedClause[] {
  return draft.clauses.map(({ threshold }, clause) => ({
    threshold,
    credentials: credentials
      .filter((credential) => credential.clause === clause)
      .map(({ place, method, label }) => {
        const { moduleInfo } = table.get(method) as MethodDescriptionReads;

        return {
          place,
          method,
          ...(moduleInfo.answered ? { methodName: moduleInfo.value.name } : {}),
          ...(label === undefined ? {} : { label }),
        };
      }),
  }));
}

/** Per clause each method its credentials name and how many of them name it. */
function failureDomainsOf(draft: SetupDraft, credentials: readonly PlacedCredential[]): FailureDomain[] {
  return draft.clauses.map((_, clause) => {
    const own = credentials.filter((credential) => credential.clause === clause);

    return {
      clause,
      methods: distinctMethods(own).map((method) => ({ method, count: own.filter((credential) => credential.method === method).length })),
    };
  });
}

/** False where the action is one the descriptor ships, whose account cannot be upgraded in place; absent otherwise. */
function upgradeOf(context: SetupDescriptionContext): SetupDescription['upgrade'] {
  const action = normalizeAddress(context.action.address, 'context.action.address');
  const shipped = [
    normalizeAddress(context.descriptor.action, 'context.descriptor.action'),
    ...normalizeAddresses(context.descriptor.auditedActions, 'context.descriptor.auditedActions'),
  ];

  return shipped.includes(action) ? { upgradeableInPlace: false } : {};
}

/**
 * The full configuration a holder reads before committing, with every party it trusts, from the draft and the reads its client made.
 * Throws a TypeError or RangeError on a malformed argument.
 */
export function describeSetup(draft: SetupDraft, context: SetupDescriptionContext): SetupDescription {
  const credentials = placedCredentials(draft);

  assertBytes(draft.privacy.publicMetadata, 'draft.privacy.publicMetadata');
  assertDescriptionContext(context);

  const table = readsByMethod(context.methods, credentials);
  const { descriptor } = context;
  const suppliedSaltPlaces = credentials.filter(({ salt }) => salt !== undefined).map(({ place }) => place);

  return {
    rule: { clauses: ruleOf(draft, credentials, table) },
    wait: { committed: draft.wait, clientDefault: context.configuration.defaultWait },
    failureDomains: failureDomainsOf(draft, credentials),
    parties: describedParties(credentials, table, normalizeAddress(descriptor.methodEcdsa, 'context.descriptor.methodEcdsa')),
    methodStanding: methodStanding(credentials, table, normalizeAddresses(descriptor.shippedMethods, 'context.descriptor.shippedMethods')),
    passkeyDomains: passkeyDomains(credentials, normalizeAddress(descriptor.methodPasskey, 'context.descriptor.methodPasskey')),
    candidateKeys: candidateKeysOf(context),
    removedKey: removedKeyOf(context.removedKey),
    privacy: { publicMetadata: draft.privacy.publicMetadata, backup: draft.privacy.backup },
    backup: { choice: draft.privacy.backup, anySuppliedSalt: suppliedSaltPlaces.length > 0 },
    reveals: { suppliedSaltPlaces },
    cancel: { cancelByVeto: !draft.ignoresPause },
    upgrade: upgradeOf(context),
    pause: pauseOf(credentials, table, draft.ignoresPause),
  };
}
