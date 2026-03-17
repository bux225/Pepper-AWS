import fs from 'fs';
import path from 'path';
import type { AppConfig, AccountConfig } from './types';

const CONFIG_PATH = path.join(process.cwd(), 'config.json');

const DEFAULT_CONFIG: AppConfig = {
  accounts: [],
  polling: {
    emailIntervalSeconds: 300,
    teamsIntervalSeconds: 300,
  },
  review: {
    emailRulesText: '',
  },
};

export function loadConfig(): AppConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    saveConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  return { ...DEFAULT_CONFIG, ...JSON.parse(raw) } as AppConfig;
}

export function saveConfig(config: AppConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

export function getEnabledAccounts(provider?: AccountConfig['provider']): AccountConfig[] {
  const config = loadConfig();
  return config.accounts.filter(a => a.enabled && (!provider || a.provider === provider));
}

export function getAccountById(id: string): AccountConfig | undefined {
  const config = loadConfig();
  return config.accounts.find(a => a.id === id);
}
