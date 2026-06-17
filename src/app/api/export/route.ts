import { NextRequest, NextResponse } from 'next/server';
import { buildResultsExcel } from '@/lib/excelExport';
import type { CheckResponse } from '@/types';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const data = await req.json() as CheckResponse;
  if (!data?.results?.length) {
    return NextResponse.json({ error: 'Нет данных.' }, { status: 400 });
  }
  const buffer = buildResultsExcel(data.results);
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="results.xlsx"',
    },
  });
}
