import OpenAI from 'openai';
import type { ExtractedItem, MatchResult, CertRow } from '../types';
import type { RawFile } from './fileParser';

function safeJson(raw: string | null | undefined): unknown {
  const s = (raw ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(s);
}

let _client: OpenAI | null = null;
function client() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      'OPENAI_API_KEY не настроен. Создайте файл .env.local в корне проекта с содержимым:\nOPENAI_API_KEY=sk-...'
    );
  }
  if (!_client) _client = new OpenAI({ apiKey: key });
  return _client;
}

const EXTRACT_SYSTEM = `You are a customs document parser.
Extract all product line items from the provided packing list document.
Return ONLY a JSON object in this exact format — no markdown, no extra text:
{
  "items": [
    {
      "index": 1,
      "part_number": "04152-31090",
      "hs_code": "8421230009",
      "description": "ELEMENT KIT, OIL / МАСЛЯНЫЙ ФИЛЬТР ДЛЯ ДВИГАТЕЛЯ",
      "qty": "2",
      "country": "Thailand"
    }
  ]
}
Rules:
- index starts at 1 and increments for each line item
- part_number: the part/article number if present, else empty string
- hs_code: the HS/TN VED code if present, else empty string
- description: the product description (keep both English and Russian if both present)
- qty: quantity as string, else empty string
- country: country of origin if present, else empty string
- Skip header rows, totals, subtotals, and blank rows
- Include ALL product line items`;

const MATCH_SYSTEM = `You are a customs certificate verification expert for Toyota vehicle spare parts imported to Uzbekistan.

Your task: for each item in the packing list, determine whether a valid certificate exists in the database.

MATCHING RULES:
1. PRIMARY — HS code match: compare the item's HS code with certificate HS codes (first 8 digits must match)
2. SECONDARY — Description match: the product descriptions must be semantically compatible (same product category)
3. A certificate COVERS an item if BOTH the HS code and description are compatible
4. If HS code matches but description is clearly a different product type → "not_found"
5. If HS code matches and description is compatible (even if wording differs) → "found"

Return ONLY a JSON object — no markdown, no extra text:
{
  "results": [
    {"index":1,"status":"found","cert_number":"UZ.SMT.01.0079.94113297","cert_date":"01.01.2025","cert_description":"ФИЛЬТР В СБОРЕ МАСЛЯНЫЙ","confidence":"high"}
  ]
}
confidence: "high"=certain, "medium"=probable, "low"=uncertain
If not_found: cert_number/cert_date/cert_description = null
Keep cert_description under 60 chars.`;

export async function extractItemsFromRaw(raw: RawFile): Promise<ExtractedItem[]> {
  const ai = client();

  let content: OpenAI.Chat.ChatCompletionContentPart[];

  if (raw.base64) {
    const imgMime = raw.mimeType.startsWith('image/') ? raw.mimeType : 'image/jpeg';
    content = [
      {
        type: 'image_url',
        image_url: { url: `data:${imgMime};base64,${raw.base64}`, detail: 'high' },
      },
      {
        type: 'text',
        text: 'Extract all product line items from this packing list document.',
      },
    ];
  } else {
    content = [
      {
        type: 'text',
        text: `Extract all product line items from this packing list document:\n\n${raw.text ?? ''}`,
      },
    ];
  }

  const response = await ai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: EXTRACT_SYSTEM },
      { role: 'user', content },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
    max_tokens: 3000,
  });

  const parsed = safeJson(response.choices[0].message.content) as {
    items?: ExtractedItem[];
  };
  return parsed.items ?? [];
}

const BATCH_SIZE = 5;
const MAX_CANDIDATES = 5;
const MAX_NAME_LEN = 80;

function trim(s: string) {
  return s.length > MAX_NAME_LEN ? s.slice(0, MAX_NAME_LEN) : s;
}

async function matchBatch(
  ai: OpenAI,
  batch: ExtractedItem[],
  candidatesMap: Map<number, CertRow[]>
): Promise<Omit<MatchResult, 'hs_code' | 'description' | 'part_number'>[]> {
  const itemsJson = batch.map(it => ({
    index: it.index,
    hs_code: it.hs_code,
    description: trim(it.description),
    candidates: (candidatesMap.get(it.index) ?? []).map(c => ({
      hs_code: c.hs_code,
      name: trim(c.product_name),
      doc: c.doc_number,
      date: c.doc_date ?? '',
    })),
  }));

  const userMsg = `ITEMS:\n${JSON.stringify(itemsJson)}\n\nMatch each item to its candidates. Empty candidates → not_found.`;

  const response = await ai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: MATCH_SYSTEM },
      { role: 'user', content: userMsg },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
    max_tokens: 4000,
  });

  const parsed = safeJson(response.choices[0].message.content) as {
    results?: Omit<MatchResult, 'hs_code' | 'description' | 'part_number'>[];
  };
  return parsed.results ?? [];
}

export async function matchItemsWithCerts(
  items: ExtractedItem[],
  allCerts: CertRow[]
): Promise<MatchResult[]> {
  const ai = client();

  // Pre-filter candidates by HS prefix, deduplicated per unique HS code
  const candidatesMap: Map<number, CertRow[]> = new Map();
  for (const item of items) {
    const c = item.hs_code.trim();
    const candidates = c && /\d{4}/.test(c)
      ? allCerts.filter(r =>
          r.hs_code === c || r.hs_code.slice(0, 8) === c.slice(0, 8)
        )
      : [];
    candidatesMap.set(item.index, candidates.slice(0, MAX_CANDIDATES));
  }

  // Process in batches to stay under TPM limit
  const allAiResults: Omit<MatchResult, 'hs_code' | 'description' | 'part_number'>[] = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const batchResults = await matchBatch(ai, batch, candidatesMap);
    allAiResults.push(...batchResults);
  }

  // Merge AI results with original item data
  return items.map(item => {
    const ai = allAiResults.find(r => r.index === item.index);
    return {
      index: item.index,
      part_number: item.part_number,
      hs_code: item.hs_code,
      description: item.description,
      country: item.country ?? '',
      status: ai?.status ?? 'not_found',
      cert_number: ai?.cert_number ?? null,
      cert_date: ai?.cert_date ?? null,
      cert_description: ai?.cert_description ?? null,
      confidence: ai?.confidence ?? 'low',
    };
  });
}
