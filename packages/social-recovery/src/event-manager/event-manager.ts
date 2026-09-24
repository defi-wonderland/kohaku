import { isAddress } from 'viem';
import type {
  AccountFilterOptions,
  Address,
  BlockRange,
  ClientConfiguration,
  DeploymentDescriptor,
  FilterSpec,
  Hex,
  IEventManager,
  IProvider,
  IRecoveryMethod,
  KitNotification,
  RawLog,
} from '../interfaces';
import type { MethodRegistry } from '../types';
import { checkChunkWidth, chunkRange } from './chunks';
import { decodeManagerLog } from './decode-manager';
import { decodeAccountLog, decodeMethodLog } from './decode-method';
import { accountFilterSpec, methodFilterSpec, privilegeFilterSpec } from './filters';
import { methodAddresses, sameAddress } from './ownership';

const checkAddress = (role: string, value: Address): Address => {
  if (!isAddress(value, { strict: false })) throw new TypeError(`The ${role} address ${value} is not an address.`);

  return value;
};

/** The log with its topics lower-cased, the spelling viem's decoder matches event signatures in. */
const withLowerTopics = (log: RawLog): RawLog => ({
  ...log,
  topics: log.topics.map((topic) => topic.toLowerCase() as Hex),
});

/** Orders notifications by block, then by log index; a tie keeps its arrival order. */
const byPosition = (left: KitNotification, right: KitNotification): number =>
  left.at.blockNumber - right.at.blockNumber || left.at.logIndex - right.at.logIndex;

/**
 * The `IEventManager` bound to one account and one action, reading logs through the provider.
 * It stores no logs and subscribes to nothing.
 */
export class EventManager implements IEventManager {
  private readonly provider: IProvider;
  private readonly descriptor: DeploymentDescriptor;
  private readonly account: Address;
  private readonly action: Address;
  private readonly methods: MethodRegistry;
  private readonly chunkWidth: number;

  constructor(
    provider: IProvider,
    descriptor: DeploymentDescriptor,
    account: Address,
    action: Address,
    methods: ReadonlyMap<Address, IRecoveryMethod>,
    configuration: Pick<ClientConfiguration, 'logChunkSize'>,
  ) {
    this.provider = provider;
    this.descriptor = descriptor;
    this.account = checkAddress('account', account);
    this.action = checkAddress('action', action);
    this.methods = methods;
    this.chunkWidth = checkChunkWidth(configuration.logChunkSize);
    checkAddress('manager', descriptor.manager);
  }

  accountFilter(options?: AccountFilterOptions): FilterSpec {
    return accountFilterSpec(this.descriptor.manager, this.account, this.action, options);
  }

  methodFilter(): FilterSpec {
    return methodFilterSpec(methodAddresses(this.descriptor, this.methods));
  }

  privilegeFilter(): FilterSpec {
    return privilegeFilterSpec(this.account);
  }

  /**
   * The owned notifications in the range, read one chunk at a time and sorted by log position.
   * A chunk the provider rejects rejects the whole read.
   */
  async fetch(filter: FilterSpec, range: BlockRange): Promise<readonly KitNotification[]> {
    const notifications: KitNotification[] = [];

    for (const chunk of chunkRange(range, this.chunkWidth)) {
      const logs = await this.provider.logs(filter, chunk);

      for (const log of logs) {
        const notification = this.decodeLog(log);

        if (notification !== undefined) notifications.push(notification);
      }
    }

    return notifications.sort(byPosition);
  }

  /** The log's notification when an owned address emitted an owned event, nothing otherwise. */
  decodeLog(raw: RawLog): KitNotification | undefined {
    const log = withLowerTopics(raw);
    const decoders: ((owned: RawLog) => KitNotification | undefined)[] = [];

    if (sameAddress(log.address, this.descriptor.manager)) decoders.push(decodeManagerLog);

    if (sameAddress(log.address, this.account)) decoders.push(decodeAccountLog);

    if (methodAddresses(this.descriptor, this.methods).some((method) => sameAddress(log.address, method))) {
      decoders.push(decodeMethodLog);
    }

    for (const decode of decoders) {
      const notification = decode(log);

      if (notification !== undefined) return notification;
    }

    return undefined;
  }
}
