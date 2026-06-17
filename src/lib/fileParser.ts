import * as XLSX from 'xlsx';
import type { ExtractedItem } from '../types';

const HS_HEADERS = ['hs code', 'hs_code', 'hscode', 'код тн вэд', 'код тн', 'тн вэд', 'код'];
const NAME_HEADERS = ['description', 'наименование', 'название', 'product', 'описание', 'товар'];
const PART_HEADERS = ['part', 'part-number', 'part number', 'part_number', 'артикул', 'номер детали'];
const QTY_HEADERS = ['qty', 'quantity', 'кол', 'количество', 'qti'];
const COUNTRY_HEADERS = ['country', 'страна', 'origin', 'country of origin', 'country of origine'];

function cellStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toLocaleDateString('ru-RU');
  return String(v).trim();
}

function matchHdr(h: string, variants: string[]): boolean {
  const n = h.trim().toLowerCase();
  return variants.some(v => n.includes(v));
}

export interface ParsedFile {
  type: 'structured';
  items: ExtractedItem[];
}

export interface RawFile {
  type: 'raw';
  text?: string;
  base64?: string;
  mimeType: string;
  filename: string;
}

export type ParseResult = ParsedFile | RawFile;

export async function parseUploadedFile(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<ParseResult> {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';

  // Excel — parse directly, no AI needed for extraction
  if (ext === 'xlsx' || ext === 'xls' || mimeType.includes('spreadsheet') || mimeType.includes('excel')) {
    try {
      const items = parseExcelPackingList(buffer, filename);
      if (items.length > 0) return { type: 'structured', items };
      // Header detection failed — convert all sheets to CSV text for AI fallback
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const csvText = wb.SheetNames.map(name =>
        `=== ${name} ===\n` + XLSX.utils.sheet_to_csv(wb.Sheets[name])
      ).join('\n\n');
      return { type: 'raw', text: csvText, mimeType: 'text/plain', filename };
    } catch {
      return { type: 'raw', text: '', mimeType: 'text/plain', filename };
    }
  }

  // CSV
  if (ext === 'csv' || mimeType.includes('csv')) {
    const text = buffer.toString('utf-8');
    return { type: 'raw', text, mimeType: 'text/plain', filename };
  }

  // PDF
  if (ext === 'pdf' || mimeType.includes('pdf')) {
    try {
      const pdfParse = (await import('pdf-parse')).default;
      const data = await pdfParse(buffer);
      return { type: 'raw', text: data.text, mimeType: 'text/plain', filename };
    } catch {
      // If pdf-parse fails, send as base64 image via vision
      return {
        type: 'raw',
        base64: buffer.toString('base64'),
        mimeType: 'application/pdf',
        filename,
      };
    }
  }

  // Images — send to OpenAI Vision
  if (/^image\//.test(mimeType) || ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
    return {
      type: 'raw',
      base64: buffer.toString('base64'),
      mimeType: mimeType || `image/${ext}`,
      filename,
    };
  }

  // Fallback: treat as text
  return { type: 'raw', text: buffer.toString('utf-8'), mimeType: 'text/plain', filename };
}

function parseExcelPackingList(buffer: Buffer, _filename: string): ExtractedItem[] {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const items: ExtractedItem[] = [];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
    if (rows.length < 2) continue;

    // Find header row
    let headerRow = -1;
    let cols = { hs: -1, name: -1, part: -1, qty: -1, country: -1 };

    for (let i = 0; i < Math.min(50, rows.length); i++) {
      const hdrs = (rows[i] as unknown[]).map(cellStr);
      const c = {
        hs: hdrs.findIndex(h => matchHdr(h, HS_HEADERS)),
        name: hdrs.findIndex(h => matchHdr(h, NAME_HEADERS)),
        part: hdrs.findIndex(h => matchHdr(h, PART_HEADERS)),
        qty: hdrs.findIndex(h => matchHdr(h, QTY_HEADERS)),
        country: hdrs.findIndex(h => matchHdr(h, COUNTRY_HEADERS)),
      };
      // Require BOTH HS code and description columns, plus at least one more
      const extra = [c.part, c.qty, c.country].filter(v => v !== -1).length;
      if (c.hs !== -1 && c.name !== -1 && extra >= 1) {
        headerRow = i;
        cols = c;
        break;
      }
    }
    if (headerRow === -1) continue;

    let idx = 0;
    for (let i = headerRow + 1; i < rows.length; i++) {
      const row = rows[i] as unknown[];
      const hs = cols.hs !== -1 ? cellStr(row[cols.hs]) : '';
      const name = cols.name !== -1 ? cellStr(row[cols.name]) : '';
      if (!hs && !name) continue;
      // Skip rows that look like headers or totals
      if (/^(итого|total|subtotal|итог)/i.test(name)) continue;

      items.push({
        index: ++idx,
        part_number: cols.part !== -1 ? cellStr(row[cols.part]) : '',
        hs_code: hs,
        description: name,
        qty: cols.qty !== -1 ? cellStr(row[cols.qty]) : '',
        country: cols.country !== -1 ? cellStr(row[cols.country]) : '',
      });
    }

    if (items.length > 0) break; // Use first sheet with data
  }

  return items;
}
