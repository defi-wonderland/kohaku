import * as Base64 from 'ox/Base64';
import * as Bytes from 'ox/Bytes';
import * as Hex from 'ox/Hex';
import * as P256 from 'ox/P256';
import * as Signature from 'ox/Signature';
import * as WebAuthnP256 from 'ox/WebAuthnP256';
import { testOnly } from '../shared/test-storage';

/** The authenticator-data flags a creation sets: user present, user verified, attested credential data. */
const CREATION_FLAGS = 0x45;

/** The flags an assertion sets: user present and user verified. */
const ASSERTION_FLAGS = 0x05;

/** The length of the credential id the software authenticator makes, in bytes. */
const CREDENTIAL_ID_LENGTH = 16;

/** The software authenticator's TEST-ONLY P-256 key and credential id, made once in this browser and kept in `localStorage`. */
const softwareKey = (): { privateKey: Hex.Hex; credentialId: Uint8Array } => ({
  privateKey: testOnly('passkey key', () => P256.randomPrivateKey()) as Hex.Hex,
  credentialId: Hex.toBytes(testOnly('passkey credential id', () => Hex.random(CREDENTIAL_ID_LENGTH)) as Hex.Hex),
});

/** The origin the client data names: the page's own, or a stand-in where no page is loaded. */
const origin = (): string => globalThis.location?.origin ?? 'http://localhost';

/** A fresh `ArrayBuffer` holding exactly these bytes, as a browser hands them over. */
const bufferOf = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.length);

  new Uint8Array(buffer).set(bytes);

  return buffer;
};

/** The challenge bytes a WebAuthn options object carries, as hex. */
const challengeOf = (options: unknown): Hex.Hex => {
  const challenge = (options as { publicKey?: { challenge?: unknown } }).publicKey?.challenge;

  if (!(challenge instanceof Uint8Array) && !(challenge instanceof ArrayBuffer)) throw new Error('the options carry no challenge');

  return Hex.fromBytes(new Uint8Array(challenge));
};

/** The credential fields a browser's `PublicKeyCredential` carries, around the response. */
const credentialRecord = (credentialId: Uint8Array, response: Readonly<Record<string, unknown>>) => ({
  'id': Base64.fromBytes(credentialId, { url: true, pad: false }),
  rawId: bufferOf(credentialId),
  type: 'public-key',
  authenticatorAttachment: 'platform',
  response,
});

/**
 * What `navigator.credentials.create` returns for an ES256 passkey under the relying-party id, attestation `none`:
 * authenticator data over sha256(rpId) with the attested credential and its COSE key, inside a CBOR attestation object.
 */
export function softwareCreation(options: unknown, relyingPartyId: string) {
  const { privateKey, credentialId } = softwareKey();
  const publicKey = P256.getPublicKey({ privateKey });
  const authData = WebAuthnP256.getAuthenticatorData({ rpId: relyingPartyId, flag: CREATION_FLAGS, credential: { 'id': credentialId, publicKey } });
  const attestationObject = WebAuthnP256.getAttestationObject({ authData });
  const clientDataJSON = WebAuthnP256.getClientDataJSON({ challenge: challengeOf(options), origin: origin(), type: 'webauthn.create' });

  return credentialRecord(credentialId, {
    clientDataJSON: bufferOf(Bytes.fromString(clientDataJSON)),
    attestationObject: bufferOf(Hex.toBytes(attestationObject)),
  });
}

/**
 * What `navigator.credentials.get` returns: the key's signature over authenticatorData || sha256(clientDataJSON), DER-encoded,
 * the client data opening with the `webauthn.get` type and the options' challenge.
 */
export function softwareAssertion(options: unknown, relyingPartyId: string) {
  const { privateKey, credentialId } = softwareKey();
  const { payload, metadata } = WebAuthnP256.getSignPayload({
    challenge: challengeOf(options),
    rpId: relyingPartyId,
    origin: origin(),
    flag: ASSERTION_FLAGS,
    signCount: 1,
  });
  const signature = P256.sign({ payload, privateKey, hash: true });

  return credentialRecord(credentialId, {
    authenticatorData: bufferOf(Hex.toBytes(metadata.authenticatorData)),
    clientDataJSON: bufferOf(Bytes.fromString(metadata.clientDataJSON)),
    signature: bufferOf(Signature.toDerBytes(signature)),
    userHandle: null,
  });
}
