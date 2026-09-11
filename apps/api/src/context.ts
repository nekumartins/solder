import type { ChainAdapter } from './chain/index.js';
import type { Config } from './config.js';
import type { Store } from './db.js';
import type { Realtime } from './realtime.js';

export interface AppContext {
  store: Store;
  chain: ChainAdapter;
  config: Config;
  realtime: Realtime;
}
