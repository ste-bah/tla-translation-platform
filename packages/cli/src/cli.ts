#!/usr/bin/env node
import { Command } from 'commander';
import { registerValidateRegistry } from './commands/validate-registry.js';
import { registerRegistryReport } from './commands/registry-report.js';

const program = new Command();

program
  .name('tla')
  .description('Translation Layer Accelerator CLI')
  .version('0.1.0');

registerValidateRegistry(program);
registerRegistryReport(program);

program.parse();
