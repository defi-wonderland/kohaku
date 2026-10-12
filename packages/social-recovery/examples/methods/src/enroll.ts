import { credentialHash, defaultSalt, walletMethod } from '@kohaku-eth/social-recovery';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { SAMPLE_ZERO_ADDRESS } from './constants';
import { consoleTrace as trace, isFailure } from './format';
import { SAMPLE } from './setup';

// A wallet guardian enrols by address: no ceremony, no material, no chain.
const method = walletMethod();
const guardian = privateKeyToAccount(generatePrivateKey());

trace('walletMethod(): deviceBinding', method.deviceBinding);
trace('guardian (a viem local account, key generated for this run)', guardian.address);

const input = method.enrollInput({ address: guardian.address });

trace('method.enrollInput({ address })', input);

const config = await method.configFrom(input, undefined);

trace('method.configFrom(input, undefined): the config bytes, abi.encode(address)', config);

if (isFailure(config)) throw new Error(`enrolment refused: ${config.cause}`);

trace('method.codec.decodeConfig(config)', method.codec.decodeConfig(config));

const credential = { method: SAMPLE.method, config };
const salt = defaultSalt(SAMPLE.account, 0);

trace('the credential at place 0 of a setup (method address, config)', credential);
trace('defaultSalt(account, 0)', salt);
trace('credentialHash(method, config, salt): what the setup body commits to', credentialHash(credential.method, config, salt));

// What enrolment refuses: each comes back as a typed failure, never a throw.
const refused = [
  ['the zero address', method.enrollInput({ address: SAMPLE_ZERO_ADDRESS })],
  ['a malformed address', method.enrollInput({ address: '0x1234' })],
  ['a ceremony input', { kind: 'ceremony' } as const],
] as const;

for (const [what, refusedInput] of refused) {
  trace(`method.configFrom(<${what}>, undefined)`, await method.configFrom(refusedInput, undefined));
}
