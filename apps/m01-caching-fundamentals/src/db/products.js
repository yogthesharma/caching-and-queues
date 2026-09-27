import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';

// Stand-in for Postgres: a JSON file with an artificial delay, so a miss is visibly slow.
// A file (not memory) so every process — API instances, demo, reset script — sees the same data.
// Module 3 replaces it with a real Postgres table.
const LATENCY_MS = 150;
const DATA_DIR = new URL('../../.data/', import.meta.url);
const DATA_FILE = new URL('products.json', DATA_DIR);

const SEED = {
  1: { id: 1, name: 'Mechanical keyboard', priceCents: 7999, updatedAt: '2026-01-01T00:00:00.000Z' },
  2: { id: 2, name: 'Wireless mouse', priceCents: 2999, updatedAt: '2026-01-01T00:00:00.000Z' },
  3: { id: 3, name: '27" monitor', priceCents: 24999, updatedAt: '2026-01-01T00:00:00.000Z' },
  4: { id: 4, name: 'USB-C hub', priceCents: 3499, updatedAt: '2026-01-01T00:00:00.000Z' },
  5: { id: 5, name: 'Desk lamp', priceCents: 1999, updatedAt: '2026-01-01T00:00:00.000Z' },
};

let queryCount = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadRows() {
  try {
    return JSON.parse(await readFile(DATA_FILE, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      return structuredClone(SEED);
    }
    throw err;
  }
}

async function saveRows(rows) {
  await mkdir(DATA_DIR, { recursive: true });
  // Write then rename, so a concurrent reader never sees a half-written file.
  const tmp = new URL(`products.${process.pid}.tmp`, DATA_DIR);
  await writeFile(tmp, JSON.stringify(rows, null, 2));
  await rename(tmp, DATA_FILE);
}

export async function findProductById(id) {
  queryCount += 1;
  await sleep(LATENCY_MS);
  const rows = await loadRows();
  return rows[id] ?? null;
}

export async function updateProduct(id, changes) {
  queryCount += 1;
  await sleep(LATENCY_MS);
  const rows = await loadRows();
  if (!rows[id]) {
    return null;
  }
  rows[id] = { ...rows[id], ...changes, updatedAt: new Date().toISOString() };
  await saveRows(rows);
  return rows[id];
}

export async function resetProducts() {
  await rm(DATA_FILE, { force: true });
}

export function getQueryCount() {
  return queryCount;
}
