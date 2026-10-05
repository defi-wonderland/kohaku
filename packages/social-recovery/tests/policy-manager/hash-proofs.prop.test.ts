import fc from 'fast-check';
import { decodeFunctionData, getAddress, parseAbi } from 'viem';
import { describe, expect, it } from 'vitest';
import type { Address, ProofPlace } from '../../src/index';
import { TIMEOUT, address, anyBytes, bytesN, place } from '../formats/arbitraries';
import { always } from './double';
import { attemptRequestOf, cancelRequestOf, partFor, vectorRow } from './fixtures';
import { runAsync } from './runs';

/** The two hash views, parsed by viem from hand-written declarations. */
const HASH_ABI = parseAbi([
  'struct PaymentOrder { address token; uint256 amount; address payee; }',
  'struct ProofPlace { uint256 place; address method; bytes config; bytes32 salt; bytes proof; }',
  'struct AttemptRequest { address account; address action; uint64 attemptId; uint64 setupNonce; bytes setupBody; bytes payload; PaymentOrder order; uint48 validUntil; ProofPlace[] proofs; }',
  'struct CancelRequest { address account; address action; uint64 attemptId; uint64 setupNonce; bytes setupBody; uint48 validUntil; ProofPlace[] proofs; }',
  'function hashApproval(AttemptRequest request, uint256 place) view returns (bytes32)',
  'function hashCancel(CancelRequest request, uint256 place) view returns (bytes32)',
]);

const VECTOR_ACCOUNT: Address = '0x1111111111111111111111111111111111111111';
const VECTOR_ACTION: Address = '0x2222222222222222222222222222222222222222';

const proof: fc.Arbitrary<ProofPlace> = fc.record({
  place: fc.oneof(fc.nat(4), place),
  method: address.map((raw) => raw as Address),
  config: anyBytes,
  salt: bytesN(32),
  proof: anyBytes,
});

/** The proofs as the decoder hands them back: places as bigint, methods checksummed. */
const decodedForm = (proofs: readonly ProofPlace[]) =>
  proofs.map((given) => ({ ...given, place: BigInt(given.place), method: getAddress(given.method) }));

describe('the hash reads over arbitrary proof orders', () => {
  it('decode back to the proofs in the order given, repeats and disorder included', async () => {
    await runAsync(
      fc.asyncProperty(fc.array(proof, { maxLength: 5 }), fc.nat(64), async (proofs, at) => {
        const approvalProvider = always({ returns: `0x${'00'.repeat(32)}` });
        const cancelProvider = always({ returns: `0x${'00'.repeat(32)}` });
        const attempt = { ...attemptRequestOf(vectorRow('attempt-request.json', 'sorted-proofs')), proofs };
        const cancel = { ...cancelRequestOf(vectorRow('cancel-request.json', 'one-proof')), proofs };

        await partFor(approvalProvider, VECTOR_ACCOUNT, VECTOR_ACTION).hashApproval(attempt, at);
        await partFor(cancelProvider, VECTOR_ACCOUNT, VECTOR_ACTION).hashCancel(cancel, at);

        const approval = decodeFunctionData({ abi: HASH_ABI, data: approvalProvider.calls[0]?.data ?? '0x' });
        const cancellation = decodeFunctionData({ abi: HASH_ABI, data: cancelProvider.calls[0]?.data ?? '0x' });

        expect(approval.functionName).toBe('hashApproval');
        expect(cancellation.functionName).toBe('hashCancel');
        expect((approval.args[0] as { proofs: unknown }).proofs).toEqual(decodedForm(proofs));
        expect((cancellation.args[0] as { proofs: unknown }).proofs).toEqual(decodedForm(proofs));
        expect(approval.args[1]).toBe(BigInt(at));
      }),
    );
  }, TIMEOUT);
});
