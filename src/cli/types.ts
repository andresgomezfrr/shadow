import type { Command } from 'commander';
import type { ShadowConfig } from '../config/load-config.js';
import type { ShadowDatabase } from '../storage/database.js';

export type WithDb = <T>(handler: (db: ShadowDatabase, json: boolean) => Promise<T> | T) => Promise<void>;

export type RegisterFn = (program: Command, config: ShadowConfig, withDb: WithDb) => void;
