import type { ProviderRevert } from './records';

/** Tells a reverted call from any other failure of the provider. */
export const isProviderRevert = (thrown: unknown): thrown is ProviderRevert =>
  typeof thrown === 'object' &&
  thrown !== null &&
  'data' in thrown &&
  typeof thrown.data === 'string' &&
  /^0x([0-9a-fA-F]{2})*$/.test(thrown.data);
