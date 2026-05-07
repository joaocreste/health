#!/usr/bin/env node
/* Apply every SQL file under db/seeds/ in lexicographic order.
   Each seed file should be idempotent (use ON CONFLICT or equivalent)
   so re-running is safe.

   Usage:  npm run db:seed
   Requires DATABASE_URL in env. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEEDS_DIR = path.resolve(__dirname, '..', 'db', 'seeds');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Set it in .env or your shell.');
  process.exit(1);
}

const files = fs.readdirSync(SEEDS_DIR)
  .filter(f => f.endsWith('.sql'))
  .sort();

if (files.length === 0) {
  console.log('No seed files in db/seeds/.');
  process.exit(0);
}

const sql = neon(process.env.DATABASE_URL);

for (const f of files) {
  const full = path.join(SEEDS_DIR, f);
  const body = fs.readFileSync(full, 'utf8');
  console.log(`▸ applying ${f} (${body.length} bytes)`);
  try {
    await sql.unsafe(body);
    console.log(`  ✓ ${f}`);
  } catch (e) {
    console.error(`  ✗ ${f} — ${e.message}`);
    process.exit(1);
  }
}

console.log(`Done — ${files.length} seed file(s) applied.`);
