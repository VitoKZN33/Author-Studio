#!/usr/bin/env node
// Проверка SQL-миграций на разрушающие операции. Миграция с такими операциями
// допускается только с явной пометкой «-- destructive-approved: <причина>»
// после ревью и при наличии резервной копии (docs/UPDATING.md).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] ?? 'apps/server/drizzle';
const DESTRUCTIVE = [
  /\bDROP\s+(TABLE|COLUMN|SCHEMA|TYPE|INDEX)\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b/i,
  /\bRENAME\s+(COLUMN|TO)\b/i,
];

let failed = false;
for (const file of readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()) {
  const sql = readFileSync(path.join(dir, file), 'utf8');
  const hits = DESTRUCTIVE.filter((re) => re.test(sql));
  if (hits.length && !/--\s*destructive-approved:/i.test(sql)) {
    failed = true;
    console.error(`✗ ${file}: разрушающая операция без пометки destructive-approved`);
  }
}
if (failed) process.exit(1);
console.log('✓ Миграции не содержат неодобренных разрушающих операций');
