import { count, fileReply, requests } from '@kohaku-eth/social-recovery';
import { SAMPLE_WINDOW_BOUNDS } from '../../constants';
import { buildOrchestrator } from '../../orchestrator';
import { SAMPLE } from '../../sample';
import { aadhaarOptions } from '../shared/aadhaar-core';
import { messageOf } from '../shared/dom';
import { parseReply } from '../shared/lines';
import { records } from './gather';
import { holderTrace, ui } from './page';

/** Files the pasted reply into the record of its purpose, counts the record, and verifies the reply's proof for its place. */
export async function file(): Promise<void> {
  const reply = parseReply(ui.replyText.value);
  const record = reply.purpose === 'cancellation' ? records.cancellation : records.approval;

  if (record === undefined) throw new Error('make the requests first');

  const filed = fileReply(record, reply);

  holderTrace(`fileReply(${record.purpose} record, reply)`, filed.outcome === 'filed' ? { outcome: filed.outcome, displaced: filed.displaced } : filed);
  Object.assign(records, { [record.purpose]: filed.gathering });

  const assessment = count(filed.gathering, Math.floor(Date.now() / 1000), SAMPLE_WINDOW_BOUNDS);

  holderTrace(`count(${record.purpose} record, now, bounds)`, assessment);
  ui.status.textContent = `${record.purpose} reply for place ${reply.place}: ${filed.outcome}; filled ${assessment.filled.join(', ') || 'none'}; rule satisfied: ${assessment.ruleSatisfied}`;

  if (filed.outcome !== 'filed') return;

  const request = requests(filed.gathering)[reply.place];

  if (request === undefined) return;

  const aadhaar = reply.method.toLowerCase() === SAMPLE.methods.aadhaar.toLowerCase() ? await aadhaarOptions(ui.aadhaarTest.checked, 'server') : {};
  const orchestrator = buildOrchestrator(records.chainId, aadhaar);

  try {
    const verdict = await orchestrator.verify(request, reply.place, reply.proof);

    holderTrace(`orchestrator.verify(request, ${reply.place}, reply.proof)`, verdict);
    ui.status.textContent += `; verify: ${verdict}`;
  } catch (error) {
    holderTrace('orchestrator.verify refused', messageOf(error));
  }
}
