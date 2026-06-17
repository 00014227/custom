import { NextRequest, NextResponse } from 'next/server';
import { parseUploadedFile } from '@/lib/fileParser';
import { extractItemsFromRaw, matchItemsWithCerts } from '@/lib/openaiClient';
import { matchFast } from '@/lib/fastMatcher';
import { loadCerts, loadNotRequiredCodes } from '@/lib/certDb';
import { setLastResults } from '@/lib/resultsStore';
import type { CheckResponse } from '@/types';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'Файл не загружен' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const certs = loadCerts();
    const notRequiredCodes = loadNotRequiredCodes();

    if (certs.length === 0) {
      return NextResponse.json(
        { error: 'База сертификатов пуста. Добавьте Excel-файлы в папку data/certs/ и перезапустите сервер.' },
        { status: 400 }
      );
    }

    const parsed = await parseUploadedFile(buffer, file.name, file.type);

    let items;
    if (parsed.type === 'structured') {
      items = parsed.items;
    } else {
      if (!parsed.text && !parsed.base64) {
        return NextResponse.json({ error: 'Не удалось прочитать содержимое файла' }, { status: 400 });
      }
      items = await extractItemsFromRaw(parsed);
      if (!items || items.length === 0) {
        return NextResponse.json({ error: 'Не удалось извлечь товары из файла' }, { status: 400 });
      }
      // For small raw files with no HS codes fall back to AI matching
      const hasHsCodes = items.some(i => /\d{4}/.test(i.hs_code));
      if (!hasHsCodes && items.length <= 50) {
        const aiResults = await matchItemsWithCerts(items, certs);
        const found = aiResults.filter(r => r.status === 'found').length;
        const response: CheckResponse = {
          total: aiResults.length, found,
          not_found: aiResults.filter(r => r.status === 'not_found').length,
          not_required: aiResults.filter(r => r.status === 'not_required').length,
          results: aiResults,
        };
        setLastResults(response);
        return NextResponse.json(response);
      }
    }

    const results = matchFast(items, certs, notRequiredCodes);
    const found = results.filter(r => r.status === 'found').length;
    const response: CheckResponse = {
      total: results.length,
      found,
      not_found: results.filter(r => r.status === 'not_found').length,
      not_required: results.filter(r => r.status === 'not_required').length,
      results,
    };

    setLastResults(response);
    return NextResponse.json(response);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[/api/check]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
