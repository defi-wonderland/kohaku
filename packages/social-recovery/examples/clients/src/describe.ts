import type { Parties, SetupDescription } from '@kohaku-eth/social-recovery';
import { type Address, isAddressEqual, zeroAddress } from 'viem';
import { note } from './trace';

const named = (address: Address): boolean => !isAddressEqual(address, zeroAddress);

/** One method's declared parties in plain words: who holds each role and whether a role is being handed on. */
function partyRoles(method: Address, parties: Parties): string {
  const admin = named(parties.admin) ? `admin ${parties.admin}` : 'no admin';
  const pauser = named(parties.pauseHolder) ? `pause holder ${parties.pauseHolder}` : 'no pause holder';
  const pending = [
    ...(named(parties.pendingAdmin) ? [`the admin role is being handed to ${parties.pendingAdmin}`] : []),
    ...(named(parties.pendingPauseHolder) ? [`the pause role is being handed to ${parties.pendingPauseHolder}`] : []),
  ];
  const handing = pending.length === 0 ? 'no hand-over pending' : pending.join('; ');

  return `method ${method} declares ${admin} and ${pauser}; both roles are transferable, so whoever holds them later `
    + `holds the same powers over this setup (${handing})`;
}

/** The setup's pause choice and its consequence in plain words. */
function pauseLine(description: SetupDescription): string {
  if (description.pause.ignoresPause) {
    return 'this setup ignores a method\'s pause: a pause holder can neither block its attempts nor have them ended through cancelByVeto';
  }

  const veto = description.cancel.cancelByVeto ? 'and anyone can end it through cancelByVeto' : 'though cancelByVeto stays closed';

  return 'this setup honours a method\'s pause: a paused method opens no attempt, and while a method an attempt used is '
    + `paused that attempt cannot execute, ${veto}`;
}

/** Prints every field of the setup's description, the disclosure owed before the setup is committed. */
export function printDescription(description: SetupDescription): void {
  note('rule', description.rule);
  note('wait (committed / client default, s)', description.wait);
  note('failure domains', description.failureDomains);
  note('declared parties per method', description.parties.methods);

  for (const { method, parties } of description.parties.methods) {
    note('  in plain words', parties.answered ? partyRoles(method, parties.value) : `method ${method} did not answer trustedParties()`);
  }

  note('wallet guardians', description.parties.walletGuardians);
  note('method standing', description.methodStanding);
  note('passkey domains', description.passkeyDomains);
  note('candidate keys', description.candidateKeys);
  note('removed key on a handover', description.removedKey);
  note('privacy', description.privacy);
  note('backup', description.backup);
  note('salts a submission reveals', description.reveals);
  note('cancel', description.cancel);
  note('upgrade', description.upgrade);
  note('pause', description.pause);
  note('  in plain words', pauseLine(description));
}
