#!/usr/bin/env node
// Import a product catalog from CSV into the local database.
//   npm run import -- ./my-products.csv
// Columns (EN/PL/RU aliases accepted): ean;article_no;brand;name;oem_numbers;price;currency;availability;product_url;notes
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { openDb } from '../src/db/index.js';
import { importProductsCsv } from '../src/services/products.js';

// npm runs scripts from backend/; resolve the path against where the user typed the command.
const file = process.argv[2] && path.resolve(process.env.INIT_CWD || process.cwd(), process.argv[2]);
if (!file) {
  console.error('Usage: npm run import -- <file.csv>');
  process.exit(1);
}

const repo = openDb(config.dbPath);
try {
  const result = importProductsCsv(repo, fs.readFileSync(file, 'utf8'), { maxRows: 1_000_000 });
  console.log(`DB: ${config.dbPath}`);
  console.log(`Inserted: ${result.inserted}, updated: ${result.updated}, errors: ${result.errors.length}`);
  for (const e of result.errors.slice(0, 20)) console.log(`  line ${e.line}: ${e.message}`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  repo.close();
}
