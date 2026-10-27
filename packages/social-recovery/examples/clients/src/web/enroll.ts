import {
  type Address,
  type Credential,
  type EnrollInput,
  type Hex,
  type IMethodsOrchestrator,
  type Material,
  METHOD_ECDSA_ADDRESS_PARAM,
  METHOD_PASSKEY_CREDENTIAL_MATERIAL,
  type Params,
} from '@kohaku-eth/social-recovery';
import { note, step } from '../trace';
import { aadhaarMaterial, aadhaarParams } from './aadhaar';
import { approverOrchestrator, type MethodKind, moduleOf } from './approver-deployment';
import { passkeyCreation, zkPassportAnswer, zkPassportVerified } from './devices';
import { ensureLive } from './lifetime';
import { credentialOut, line, statusLine, valueOf } from './page';
import { connected, ensureSession } from './wallet';
import { zkPassportParams } from './zkpassport';

/** The last credential the approver page enrolled, for its Copy button. */
export const enrolled: { credential?: Credential } = {};

/** One method's enrollment: the parameters, the real material over the enrollment input, and who gave it. */
type Ceremony = {
  readonly params: () => Params;
  readonly material: (input: EnrollInput) => Promise<Material>;
  readonly by: () => string;
};

const CEREMONIES: Readonly<Record<MethodKind, Ceremony>> = {
  wallet: {
    params: () => ({ [METHOD_ECDSA_ADDRESS_PARAM]: connected().account }),
    material: async () => undefined,
    by: () => `the connected account ${connected().account}`,
  },
  passkey: {
    params: () => {
      const userName = valueOf('enroll-user');

      if (userName === '') throw new Error('type a user name for the new passkey');

      return { relyingPartyId: location.hostname, userName };
    },
    material: async (input) => ({ [METHOD_PASSKEY_CREDENTIAL_MATERIAL]: await passkeyCreation(input) }),
    by: () => `a new passkey for ${location.hostname}`,
  },
  zkpassport: {
    params: zkPassportParams,
    material: async (input) => {
      const answer = await zkPassportAnswer(input, document.querySelector<HTMLAnchorElement>('#zk-link') ?? document.createElement('a'));

      return { result: await zkPassportVerified(answer, String(input['domain']), String(input['scope'])) };
    },
    by: () => 'the zkPassport app',
  },
  aadhaar: {
    params: aadhaarParams,
    material: async () => aadhaarMaterial(),
    by: () => 'the Aadhaar prover in this browser',
  },
};

/** The enrollment method the form names. */
function chosenKind(): MethodKind {
  const kind = valueOf('enroll-method');

  if (kind !== 'wallet' && kind !== 'passkey' && kind !== 'zkpassport' && kind !== 'aadhaar') throw new Error('choose a method to enroll');

  return kind;
}

/** enrollInput → real material → configFrom for one module, the session or the action checked after each device step. */
async function enrolledConfig(orchestrator: IMethodsOrchestrator, method: Address, ceremony: Ceremony, settle: () => void): Promise<Hex> {
  const input = orchestrator.enrollInput(method, ceremony.params());

  note('enrollInput', { kind: input.kind });

  const material = await ceremony.material(input);

  settle();

  const config = await orchestrator.configFrom(method, input, material);

  settle();

  if (typeof config !== 'string') throw new Error(`configFrom refused the material: ${config.cause}`);

  return config;
}

/**
 * Enrolls the person on this page as a guardian with real material for the chosen method and shows the credential
 * line, the SDK's `Credential` record as JSON, to paste into the holder page's setup form.
 */
export async function enrollGuardian(): Promise<void> {
  const kind = chosenKind();
  const { descriptor, orchestrator } = approverOrchestrator();
  const method = moduleOf(descriptor, kind);
  const ceremony = CEREMONIES[kind];
  const session = kind === 'wallet' ? connected().session : undefined;
  const settle = (): void => (session === undefined ? ensureLive() : ensureSession(session));

  enrolled.credential = undefined;
  credentialOut.textContent = '';
  step(`enrollInput → material → configFrom (${kind}, module ${method})`);

  const config = await enrolledConfig(orchestrator, method, ceremony, settle);
  const credential: Credential = { method, config };
  const by = ceremony.by();

  note('credential', credential);
  enrolled.credential = credential;
  credentialOut.textContent = `enrolled by ${by}\n${line(credential)}`;
  statusLine.textContent = 'Credential line built; copy it into the holder page\'s setup form.';
}
