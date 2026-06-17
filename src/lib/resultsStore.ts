import fs from 'fs';
import path from 'path';
import type { CheckResponse } from '../types';

const STORE_PATH = path.join(process.cwd(), 'data', '.last_results.json');

export function setLastResults(r: CheckResponse) {
  try {
    const dir = path.dirname(STORE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(r), 'utf8');
  } catch { /* ignore write errors */ }
}

export function getLastResults(): CheckResponse | null {
  try {
    if (!fs.existsSync(STORE_PATH)) return null;
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')) as CheckResponse;
  } catch { return null; }
}
