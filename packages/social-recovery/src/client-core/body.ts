import { credentialHash, encodeSetupBody, setupCommitment } from '../formats';
import { assertArray, assertObject, normalizeAddress } from '../formats/guards';
import type { Address, Configuration, Credential, Hex } from '../interfaces';
import { defaultSalt } from '../salts';
import type { BodyClause, SetupBody } from '../types';

/**
 * The setup body a configuration or a draft commits to: each credential hashed with its supplied salt, or with the
 * default salt of its place, the places numbered across all clauses in order from 0; labels are not covered.
 */
export function configurationBody(configuration: Configuration, account: Address): SetupBody {
  assertObject(configuration, 'configuration');
  assertArray(configuration.clauses, 'configuration.clauses');

  const accountAddress = normalizeAddress(account, 'account');
  let place = -1;

  const clauses = configuration.clauses.map((clause, index): BodyClause => {
    assertObject(clause, `configuration.clauses[${index}]`);
    assertArray(clause.credentials, `configuration.clauses[${index}].credentials`);

    const credentials = clause.credentials.map((credential: Credential, position) => {
      assertObject(credential, `configuration.clauses[${index}].credentials[${position}]`);

      place += 1;

      return credentialHash(credential.method, credential.config, credential.salt ?? defaultSalt(accountAddress, place));
    });

    return { threshold: clause.threshold, credentials };
  });

  return { wait: configuration.wait, ignoresPause: configuration.ignoresPause, clauses };
}

/** The setup commitment a configuration or a draft recomputes to for the account, the action and the setup nonce. */
export function configurationCommitment(configuration: Configuration, account: Address, action: Address, nonce: bigint): Hex {
  return setupCommitment(account, action, nonce, encodeSetupBody(configurationBody(configuration, account)));
}
