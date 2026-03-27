#!/usr/bin/env node
import { Command } from 'commander';
import { registerValidateRegistry } from './commands/validate-registry.js';
import { registerRegistryReport } from './commands/registry-report.js';
import { registerTranslate } from './commands/translate.js';
import { registerValidate } from './commands/validate.js';
import { registerAssess } from './commands/assess.js';
import { registerMigrateState } from './commands/migrate-state.js';

const program = new Command();

program
  .name('tla')
  .description('Translation Layer Accelerator CLI')
  .version('0.1.0');

registerValidateRegistry(program);
registerRegistryReport(program);
registerTranslate(program);
registerValidate(program);
registerAssess(program);
registerMigrateState(program);

program.parse();
