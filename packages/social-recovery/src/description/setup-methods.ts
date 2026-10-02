import { decodeAbiParameters, encodeAbiParameters } from 'viem';
import { DESCRIPTION_PASSKEY_CONFIG_ABI } from '../constants';
import { assertArray, assertBool, assertObject, normalizeAddress } from '../formats/guards';
import type { Address, DescribedParties, Hex, MethodStanding, SetupDescription } from '../interfaces';
import { decodeSigner } from '../method-ecdsa/codec';
import type { MethodDescriptionReads } from '../types/description';
import type { PlacedCredential } from '../types/validation';
import { methodTable } from '../validation/common';

/** The method reads by checksummed module address, refusing a malformed or repeated entry and a named method left unread. */
export function readsByMethod(
  methods: readonly MethodDescriptionReads[],
  credentials: readonly PlacedCredential[],
): Map<Address, MethodDescriptionReads> {
  assertArray(methods, 'context.methods');

  const table = methodTable(
    methods.map((reads, index): [Address, MethodDescriptionReads] => {
      const name = `context.methods[${index}]`;

      assertObject(reads, name);
      assertObject(reads.moduleInfo, `${name}.moduleInfo`);
      assertObject(reads.trustedParties, `${name}.trustedParties`);
      assertObject(reads.paused, `${name}.paused`);
      assertObject(reads.pauseHolder, `${name}.pauseHolder`);
      assertBool(reads.implemented, `${name}.implemented`);

      return [normalizeAddress(reads.module, `${name}.module`), reads];
    }),
    'context.methods',
  );

  for (const { method } of credentials) {
    if (!table.has(method)) throw new TypeError(`context.methods holds no reads for ${method}`);
  }

  return table;
}

/** Each method the credentials name, once, in the order of its first place. */
export const distinctMethods = (credentials: readonly PlacedCredential[]): Address[] => [
  ...new Set(credentials.map(({ method }) => method)),
];

const tryOr = <Value>(read: () => Value): Value | undefined => {
  try {
    return read();
  } catch {
    return undefined;
  }
};

/** Per method its declared parties, per wallet guardian the address its config holds. */
export function describedParties(
  credentials: readonly PlacedCredential[],
  table: ReadonlyMap<Address, MethodDescriptionReads>,
  walletMethod: Address,
): DescribedParties {
  const walletGuardians = credentials.flatMap(({ place, method, config }) => {
    const address = method === walletMethod ? tryOr(() => decodeSigner(config)) : undefined;

    return address === undefined ? [] : [{ place, address }];
  });

  return {
    methods: distinctMethods(credentials).map((method) => ({
      method,
      parties: (table.get(method) as MethodDescriptionReads).trustedParties,
    })),
    walletGuardians,
  };
}

/** Per method whether it is shipped, declares parties, passes the probe, its tier and its stop. */
export function methodStanding(
  credentials: readonly PlacedCredential[],
  table: ReadonlyMap<Address, MethodDescriptionReads>,
  shippedMethods: readonly Address[],
): MethodStanding[] {
  return distinctMethods(credentials).map((method) => {
    const reads = table.get(method) as MethodDescriptionReads;
    const { moduleInfo } = reads;

    return {
      method,
      shipped: shippedMethods.includes(method),
      declaresParties: reads.trustedParties.answered,
      probePassed: moduleInfo.answered ? { answered: true, value: moduleInfo.value.supportsInterface } : { answered: false },
      ...(reads.tier === undefined ? {} : { tier: reads.tier }),
      paused: reads.paused,
    };
  });
}

/** Per passkey credential the relying-party id hash its config holds; a config outside the layout names none. */
export function passkeyDomains(credentials: readonly PlacedCredential[], passkeyMethod: Address): SetupDescription['passkeyDomains'] {
  return credentials.flatMap(({ place, method, config }) => {
    if (method !== passkeyMethod) return [];

    const fields = tryOr(() => decodeAbiParameters(DESCRIPTION_PASSKEY_CONFIG_ABI, config));

    if (fields === undefined || encodeAbiParameters(DESCRIPTION_PASSKEY_CONFIG_ABI, fields) !== config) return [];

    return [{ place, relyingPartyIdHash: fields[2].toLowerCase() as Hex }];
  });
}

/** Per method its stop and pause holder, beside this setup's own choice. */
export function pauseOf(
  credentials: readonly PlacedCredential[],
  table: ReadonlyMap<Address, MethodDescriptionReads>,
  ignoresPause: boolean,
): SetupDescription['pause'] {
  return {
    ignoresPause,
    methods: distinctMethods(credentials).map((method) => {
      const reads = table.get(method) as MethodDescriptionReads;

      return { method, paused: reads.paused, pauseHolder: reads.pauseHolder };
    }),
  };
}
