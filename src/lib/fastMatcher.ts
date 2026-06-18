import type { ExtractedItem, MatchResult, CertRow } from '../types';

const STOP = new Set([
  'для', 'в', 'и', 'с', 'на', 'по', 'к', 'или', 'а', 'от', 'до', 'из', 'не',
  'the', 'for', 'and', 'of', 'in', 'to', 'a', 'an', 'with', 'by',
]);

function tokenize(text: string): string[] {
  return text
    .toUpperCase()
    .replace(/[^\wА-ЯЁ\d\s]/gi, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP.has(w.toLowerCase()));
}

function overlap(query: string, candidate: string): number {
  const qToks = tokenize(query);
  if (qToks.length === 0) return 0;
  const cSet = new Set(tokenize(candidate));
  return qToks.filter(t => cSet.has(t)).length / qToks.length;
}

function bestCert(description: string, certs: CertRow[]): CertRow {
  if (certs.length === 1) return certs[0];
  let top = certs[0];
  let topScore = overlap(description, certs[0].product_name);
  for (let i = 1; i < certs.length; i++) {
    const s = overlap(description, certs[i].product_name);
    if (s > topScore) { topScore = s; top = certs[i]; }
  }
  return top;
}

function isJapan(country: string): boolean {
  const c = country.trim();
  if (c === '392') return true; // ISO 3166-1 numeric code for Japan
  return /japan|япони|^jp$|jpn/i.test(c);
}

function normalizeHs(hs: string): string {
  return hs.replace(/\D/g, '');
}

export function matchFast(
  items: ExtractedItem[],
  certs: CertRow[],
  notRequiredCodes: Set<string>
): MatchResult[] {
  // Build HS-code index once
  const idx = new Map<string, CertRow[]>();
  for (const c of certs) {
    const k = normalizeHs(c.hs_code);
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k)!.push(c);
  }

  return items.map(item => {
    const hs = normalizeHs(item.hs_code);
    const country = item.country ?? '';

    // Rule 1: HS code is in the "не требует сертификации" list
    if (notRequiredCodes.has(hs) || notRequiredCodes.has(hs.slice(0, 8)) || notRequiredCodes.has(hs.slice(0, 6))) {
      return notRequired(item, country);
    }

    // Rule 2: Non-Japan origin → certification required but no cert in DB
    if (!isJapan(country)) {
      return notFound(item, country);
    }

    // Rule 3: Japan origin → must have certificate
    // 3a. Exact HS code match
    const exact = hs ? (idx.get(hs) ?? []) : [];
    if (exact.length > 0) return found(item, country, bestCert(item.description, exact), 'high');

    // 3b. 8-digit prefix match
    if (hs.length >= 8) {
      const p8 = hs.slice(0, 8);
      const pool: CertRow[] = [];
      for (const [code, cs] of idx) if (code.slice(0, 8) === p8) pool.push(...cs);
      if (pool.length > 0) return found(item, country, bestCert(item.description, pool), 'medium');
    }

    // 3c. 6-digit prefix match
    if (hs.length >= 6) {
      const p6 = hs.slice(0, 6);
      const pool: CertRow[] = [];
      for (const [code, cs] of idx) if (code.slice(0, 6) === p6) pool.push(...cs);
      if (pool.length > 0) return found(item, country, bestCert(item.description, pool), 'medium');
    }

    // Not found
    return notFound(item, country);
  });
}

function found(item: ExtractedItem, country: string, cert: CertRow, confidence: 'high' | 'medium'): MatchResult {
  return {
    index: item.index,
    part_number: item.part_number,
    hs_code: item.hs_code,
    description: item.description,
    country,
    status: 'found',
    cert_number: cert.doc_number,
    cert_date: cert.doc_date,
    cert_description: cert.product_name,
    confidence,
  };
}

function notFound(item: ExtractedItem, country: string): MatchResult {
  return {
    index: item.index,
    part_number: item.part_number,
    hs_code: item.hs_code,
    description: item.description,
    country,
    status: 'not_found',
    cert_number: null,
    cert_date: null,
    cert_description: null,
    confidence: 'low',
  };
}

function notRequired(item: ExtractedItem, country: string): MatchResult {
  return {
    index: item.index,
    part_number: item.part_number,
    hs_code: item.hs_code,
    description: item.description,
    country,
    status: 'not_required',
    cert_number: null,
    cert_date: null,
    cert_description: null,
    confidence: 'high',
  };
}
