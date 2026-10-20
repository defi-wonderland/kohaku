import type { Params } from '@kohaku-eth/social-recovery';
import { zkPassportMethod } from '@kohaku-eth/social-recovery/recovery-methods';
import { note } from '../trace';
import { field, valueOf } from './page';

/** The zkPassport session the form names: the domain (this page's host when blank), the scope and the texts the app shows. */
export function zkPassportParams(): Params {
  const domain = valueOf('zk-domain') === '' ? location.hostname : valueOf('zk-domain');
  const scope = valueOf('zk-scope');
  const name = valueOf('zk-name');
  const purpose = valueOf('zk-purpose');

  if (scope === '') throw new Error('type the zkPassport scope');

  return { domain, scope, ...(name === '' ? {} : { name }), ...(purpose === '' ? {} : { purpose }) };
}

/** Fills the domain and the scope from the request's config, the session its proofs must be scoped to. */
export function prefillZkPassport(config: `0x${string}`): void {
  try {
    const decoded = zkPassportMethod().codec.decodeConfig(config);

    field('zk-domain').value = String(decoded['domain']);
    field('zk-scope').value = String(decoded['scope']);
  } catch {
    note('the request\'s config does not decode as a zkPassport config');
  }
}
