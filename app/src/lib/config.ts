import type { AppConfig, AccountConfig } from './types';

// Edge-safe default config
export const DEFAULT_CONFIG: AppConfig = {
  accounts: [],
  polling: {
    emailIntervalSeconds: 300,
    teamsIntervalSeconds: 300,
  },
  review: {
    emailRulesText: '',
  },
};

// These stubs throw if called in Edge. Use config.node.ts for Node.js/server code.
export function loadConfig(): AppConfig {
  throw new Error('loadConfig is not available in the Edge Runtime. Use config.node.ts in server-only code.');
}

export function saveConfig(_config: AppConfig): void {
  throw new Error('saveConfig is not available in the Edge Runtime. Use config.node.ts in server-only code.');
}

export function getEnabledAccounts(_provider?: AccountConfig['provider']): AccountConfig[] {
  throw new Error('getEnabledAccounts is not available in the Edge Runtime. Use config.node.ts in server-only code.');
}

export function getAccountById(_id: string): AccountConfig | undefined {
  throw new Error('getAccountById is not available in the Edge Runtime. Use config.node.ts in server-only code.');
}
