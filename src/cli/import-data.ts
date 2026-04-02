#!/usr/bin/env node

import { existsSync } from 'fs';
import { join } from 'path';
import { DatabaseService } from '../db/database';
import { importOperatingData } from '../services/data-import';

type ImportArgs = {
  peoplePath?: string;
  tasksPath?: string;
  followUpsPath?: string;
  dryRun: boolean;
};

function parseArgs(args: string[]): ImportArgs {
  const getValue = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index !== -1 && args[index + 1] ? args[index + 1] : undefined;
  };

  return {
    peoplePath: getValue('--people'),
    tasksPath: getValue('--tasks'),
    followUpsPath: getValue('--follow-ups'),
    dryRun: args.includes('--dry-run'),
  };
}

function printHelp(): void {
  console.log(`
Founder Daily Brief Data Import

Usage:
  npm run import-data -- [options]

Options:
  --people PATH       Import people CSV
  --tasks PATH        Import tasks CSV
  --follow-ups PATH   Import follow-ups CSV
  --dry-run           Show create/update counts without writing to the database
  --help, -h          Show this help message

Examples:
  npm run import-data -- --tasks ./imports/tasks.csv
  npm run import-data -- --people ./imports/people.csv --follow-ups ./imports/follow-ups.csv
  npm run import-data -- --people ./imports/people.csv --tasks ./imports/tasks.csv --follow-ups ./imports/follow-ups.csv --dry-run

Templates:
  cp templates/import-data/people.csv ./imports/people.csv
  cp templates/import-data/tasks.csv ./imports/tasks.csv
  cp templates/import-data/follow-ups.csv ./imports/follow-ups.csv
`);
}

function assertPathExists(path: string | undefined, label: string): void {
  if (path && !existsSync(path)) {
    throw new Error(`${label} file not found: ${path}`);
  }
}

async function runImport(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const options = parseArgs(args);
  if (!options.peoplePath && !options.tasksPath && !options.followUpsPath) {
    printHelp();
    throw new Error('Provide at least one of --people, --tasks, or --follow-ups.');
  }

  assertPathExists(options.peoplePath, 'People');
  assertPathExists(options.tasksPath, 'Tasks');
  assertPathExists(options.followUpsPath, 'Follow-ups');

  const db = new DatabaseService();

  try {
    const summary = importOperatingData({
      db,
      peoplePath: options.peoplePath,
      tasksPath: options.tasksPath,
      followUpsPath: options.followUpsPath,
      dryRun: options.dryRun,
    });

    console.log('\n📥 FOUNDER DAILY BRIEF DATA IMPORT\n');
    console.log(`Mode: ${options.dryRun ? 'DRY RUN' : 'LIVE IMPORT'}`);
    console.log(`Database: ${join(process.cwd(), dbPathLabel())}`);
    console.log('');
    printCounts('People', summary.people);
    printCounts('Tasks', summary.tasks);
    printCounts('Follow-ups', summary.followUps);
    console.log('');

    if (options.dryRun) {
      console.log('Dry run complete. No database rows were changed.\n');
    } else {
      console.log('Import complete. Your real operating data is now available to the brief generator.\n');
    }
  } finally {
    db.close();
  }
}

function dbPathLabel(): string {
  return process.env.DATABASE_PATH || './data/founder_brief.db';
}

function printCounts(label: string, counts: { created: number; updated: number; skipped: number }): void {
  console.log(`${label}:`);
  console.log(`  Created: ${counts.created}`);
  console.log(`  Updated: ${counts.updated}`);
  console.log(`  Skipped: ${counts.skipped}`);
}

if (require.main === module) {
  runImport().catch(error => {
    console.error('\n❌ Import failed:');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

export { runImport };
