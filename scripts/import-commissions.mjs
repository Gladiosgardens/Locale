#!/usr/bin/env node
// Sends a network's commission export (CSV) to the import-commissions function.
//
//   SUPABASE_URL=https://REF.supabase.co IMPORT_SECRET=... \
//   node scripts/import-commissions.mjs --network sovrn --file report.csv \
//     --id "Transaction ID" --sub "Custom ID" --commission "Commission" \
//     --sale "Order Value" --currency "Currency" --status "Status" --date "Date"
//
// --id, --commission, --status and --date are required; the others are optional.
// Column names must match the CSV header exactly. Re-running is safe.
import { readFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const need = ['network', 'file', 'id', 'commission', 'status', 'date'];
const missing = need.filter((k) => !args[k]);
if (missing.length || !process.env.SUPABASE_URL || !process.env.IMPORT_SECRET) {
  console.error(`Missing: ${[...missing.map((m) => `--${m}`), ...(process.env.SUPABASE_URL ? [] : ['SUPABASE_URL']), ...(process.env.IMPORT_SECRET ? [] : ['IMPORT_SECRET'])].join(', ')}`);
  process.exit(1);
}

// RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

const [header, ...lines] = parseCsv(readFileSync(args.file, 'utf8').replace(/^﻿/, ''));
const col = (name) => {
  if (!name) return -1;
  const i = header.indexOf(name);
  if (i < 0) { console.error(`Column "${name}" not found. Columns: ${header.join(', ')}`); process.exit(1); }
  return i;
};
const c = { id: col(args.id), sub: col(args.sub), commission: col(args.commission), sale: col(args.sale), currency: col(args.currency), status: col(args.status), date: col(args.date) };
const get = (line, i) => (i >= 0 ? line[i] : undefined);
const rows = lines.map((l) => ({
  external_id: get(l, c.id), sub_id: get(l, c.sub), commission: get(l, c.commission), sale: get(l, c.sale),
  currency: get(l, c.currency), status: get(l, c.status), occurred_at: get(l, c.date),
}));

let totals = { credited: 0, locale: 0, unchanged: 0, skipped: [] };
for (let i = 0; i < rows.length; i += 1000) {
  const res = await fetch(`${process.env.SUPABASE_URL}/functions/v1/import-commissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-import-secret': process.env.IMPORT_SECRET },
    body: JSON.stringify({ network: args.network, rows: rows.slice(i, i + 1000) }),
  });
  const out = await res.json();
  if (!res.ok) { console.error('Import failed:', out); process.exit(1); }
  totals = { credited: totals.credited + out.credited, locale: totals.locale + out.locale, unchanged: totals.unchanged + out.unchanged, skipped: [...totals.skipped, ...out.skipped] };
}
console.log(`Credited to creators: ${totals.credited}. Locale only: ${totals.locale}. Unchanged: ${totals.unchanged}. Skipped: ${totals.skipped.length}`);
for (const s of totals.skipped.slice(0, 20)) console.log(`  skipped: ${s}`);
