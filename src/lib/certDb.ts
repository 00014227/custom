import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import type { CertRow } from '../types';

const CERTS_DIR = path.join(process.cwd(), 'data', 'certs');

const HS_HEADERS = ['код тн вэд', 'код тн', 'тн вэд', 'hs code', 'код'];
const NAME_HEADERS = ['наименование продукции', 'наименование', 'название', 'product name', 'описание', 'description'];
const DOC_HEADERS = ['номер разрешительного документа', 'номер документа', 'номер разрешительного', 'сертификат', 'doc number', 'номер'];
const DATE_HEADERS = ['дата', 'date', 'срок действия', 'действителен до'];

// Sheet/file names that indicate "не требует сертификации"
const NOT_REQ_KEYWORDS = ['не треб', 'не подлеж', 'освобожд', 'exempt', 'not req', 'без серт', 'не серт'];

function isNotRequiredSheet(name: string) {
  const n = name.toLowerCase();
  return NOT_REQ_KEYWORDS.some(k => n.includes(k));
}

function nh(v: unknown): string { return String(v ?? '').trim().toLowerCase(); }
function matchHdr(h: string, variants: string[]): boolean {
  const n = nh(h);
  return variants.some(v => n.includes(v));
}
function cellStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toLocaleDateString('ru-RU');
  return String(v).trim();
}

function detectCols(headers: string[]) {
  let hs = -1, name = -1, doc = -1, date = -1;
  headers.forEach((h, i) => {
    if (hs === -1 && matchHdr(h, HS_HEADERS)) hs = i;
    if (name === -1 && matchHdr(h, NAME_HEADERS)) name = i;
    if (doc === -1 && matchHdr(h, DOC_HEADERS)) doc = i;
    if (date === -1 && matchHdr(h, DATE_HEADERS)) date = i;
  });
  return { hs, name, doc, date };
}

interface ParsedFile {
  certs: CertRow[];
  notRequiredCodes: Set<string>;
}

function parseCertFile(buffer: Buffer, filename: string): ParsedFile {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const certs: CertRow[] = [];
  const notRequiredCodes = new Set<string>();

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
    if (rows.length < 1) continue;

    // "Не требует сертификации" sheet — just collect HS codes
    if (isNotRequiredSheet(sheetName)) {
      for (const row of rows) {
        for (const cell of row as unknown[]) {
          const s = cellStr(cell);
          if (/^\d{4,}/.test(s)) notRequiredCodes.add(s.replace(/\D/g, '').slice(0, 10));
        }
      }
      continue;
    }

    if (rows.length < 2) continue;

    let headerRow = -1;
    let cols = { hs: -1, name: -1, doc: -1, date: -1 };

    for (let i = 0; i < Math.min(50, rows.length); i++) {
      const hdrs = (rows[i] as unknown[]).map(cellStr);
      const c = detectCols(hdrs);
      if (c.hs !== -1 && c.name !== -1) { headerRow = i; cols = c; break; }
    }
    if (headerRow === -1) continue;

    // Check for cert number in merged cells above the table (e.g. UZ.SMT.01.0079.xxx)
    let sheetDocNum: string | null = null;
    if (cols.doc === -1) {
      for (let i = 0; i < headerRow; i++) {
        for (const cell of rows[i] as unknown[]) {
          const s = cellStr(cell);
          if (/^UZ\./i.test(s) || /^[A-Z]{2}\.\w+\.\d+/.test(s)) { sheetDocNum = s; break; }
        }
        if (sheetDocNum) break;
      }
    }

    for (let i = headerRow + 1; i < rows.length; i++) {
      const row = rows[i] as unknown[];
      const hs = cellStr(row[cols.hs]);
      const name = cellStr(row[cols.name]);
      if (!hs && !name) continue;
      const docNum = cols.doc !== -1 ? cellStr(row[cols.doc]) : sheetDocNum ?? '';
      const docDate = cols.date !== -1 ? cellStr(row[cols.date]) : null;
      certs.push({
        hs_code: hs || '0',
        product_name: name || hs,
        doc_number: docNum,
        doc_date: docDate || null,
        source_file: filename,
      });
    }
  }

  return { certs, notRequiredCodes };
}

interface Cache {
  certs: CertRow[];
  notRequiredCodes: Set<string>;
  loadedAt: number;
  fileCount: number;
}

let _cache: Cache | null = null;

function load(forceReload = false): Cache {
  if (!fs.existsSync(CERTS_DIR)) fs.mkdirSync(CERTS_DIR, { recursive: true });
  const files = fs.readdirSync(CERTS_DIR).filter(f => /\.(xlsx|xls)$/i.test(f));

  if (!forceReload && _cache && _cache.fileCount === files.length) return _cache;

  const allCerts: CertRow[] = [];
  const allNotReq = new Set<string>();

  for (const f of files) {
    try {
      const buf = fs.readFileSync(path.join(CERTS_DIR, f));
      const parsed = parseCertFile(buf, f);
      allCerts.push(...parsed.certs);
      parsed.notRequiredCodes.forEach(c => allNotReq.add(c));
    } catch { /* skip bad files */ }
  }

  _cache = { certs: allCerts, notRequiredCodes: allNotReq, loadedAt: Date.now(), fileCount: files.length };
  return _cache;
}

export function loadCerts(forceReload = false): CertRow[] {
  return load(forceReload).certs;
}

export function loadNotRequiredCodes(forceReload = false): Set<string> {
  return load(forceReload).notRequiredCodes;
}

export function getCertStats() {
  const cache = load();
  const files = fs.existsSync(CERTS_DIR)
    ? fs.readdirSync(CERTS_DIR).filter(f => /\.(xlsx|xls)$/i.test(f)).length
    : 0;
  return {
    count: cache.certs.length,
    notRequiredCount: cache.notRequiredCodes.size,
    files,
    loadedAt: _cache ? new Date(_cache.loadedAt).toISOString() : null,
  };
}
