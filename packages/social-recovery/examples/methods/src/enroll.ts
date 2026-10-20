import { credentialHash, defaultSalt, walletMethod } from '@kohaku-eth/social-recovery';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { SAMPLE_CHAIN_ID, SAMPLE_ZERO_ADDRESS } from './constants';
import { consoleTrace as trace, isFailure } from './format';
import { buildOrchestrator } from './orchestrator';
import { SAMPLE } from './sample';

// A wallet guardian enrols by address through the orchestrator: no ceremony, no material, no chain.
const orchestrator = buildOrchestrator(SAMPLE_CHAIN_ID);
const module = SAMPLE.methods.wallet;
const guardian = privateKeyToAccount(generatePrivateKey());

trace('the wallet module the sample descriptor names', module);
trace('walletMethod(): deviceBinding', walletMethod().deviceBinding);
trace('guardian (a viem local account, key generated for this run)', guardian.address);

const input = orchestrator.enrollInput(module, { address: guardian.address });

trace('orchestrator.enrollInput(walletModule, { address })', input);

const config = await orchestrator.configFrom(module, input, undefined);

trace('orchestrator.configFrom(walletModule, input, undefined): the config bytes, abi.encode(address)', config);

if (isFailure(config)) throw new Error(`enrolment refused: ${config.cause}`);

trace('walletMethod().codec.decodeConfig(config)', walletMethod().codec.decodeConfig(config));

const credential = { method: module, config };
const salt = defaultSalt(SAMPLE.account, 0);

trace('the credential at place 0 of a setup (method address, config): the credential line', JSON.stringify(credential));
trace('defaultSalt(account, 0)', salt);
trace('credentialHash(method, config, salt): what the setup body commits to', credentialHash(credential.method, config, salt));

// What enrolment refuses: each comes back as a typed failure, never a throw.
const refused = [
  ['the zero address', orchestrator.enrollInput(module, { address: SAMPLE_ZERO_ADDRESS })],
  ['a malformed address', orchestrator.enrollInput(module, { address: '0x1234' })],
  ['a ceremony input', { kind: 'ceremony' } as const],
] as const;

for (const [what, refusedInput] of refused) {
  trace(`orchestrator.configFrom(walletModule, <${what}>, undefined)`, await orchestrator.configFrom(module, refusedInput, undefined));
}
