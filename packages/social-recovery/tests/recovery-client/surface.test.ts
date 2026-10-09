import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as source from '../../src/index';
import { PACKAGE_ROOT } from '../helpers/source';
import { rig } from './doubles';

const loadBuilt = async (): Promise<Record<string, unknown>> =>
  (await import(pathToFileURL(join(PACKAGE_ROOT, 'dist', 'index.js')).href)) as Record<string, unknown>;

/** The members the next task adds; this one ships none of them, not even as stubs. */
const LATER_MEMBERS = [
  'getApproverRequests',
  'addApproverReply',
  'assess',
  'complete',
  'prepareStartAttempt',
  'prepareCancelByProofs',
  'prepareCancelByOwner',
  'prepareCancelByVeto',
  'prepareExecuteHandover',
  'recoveryState',
];

describe('the recovery client surface', () => {
  it('the source entry exports RecoveryClient as a class', () => {
    expect(typeof source.RecoveryClient).toBe('function');
  });

  it('the built entry exports RecoveryClient as a class', async () => {
    expect(typeof (await loadBuilt())['RecoveryClient']).toBe('function');
  });

  it('the built declarations declare the class with the two inits', () => {
    const declarations = readFileSync(join(PACKAGE_ROOT, 'dist', 'index.d.ts'), 'utf8');

    expect(declarations).toMatch(/class RecoveryClient\b/);
    expect(declarations).toMatch(/initRecoveryGathering\(/);
    expect(declarations).toMatch(/initCancelGathering\(/);
  });

  it('carries the two inits and the injected event manager', () => {
    const { client, events } = rig();

    expect(typeof client.initRecoveryGathering).toBe('function');
    expect(typeof client.initCancelGathering).toBe('function');
    expect(client.events).toBe(events);
  });

  it.each(LATER_MEMBERS)('ships no %s member yet', (member) => {
    const { client } = rig();

    expect(member in client).toBe(false);
  });

  it('the constructor reads nothing', () => {
    const { seen } = rig();

    expect(seen).toEqual([]);
  });
});
