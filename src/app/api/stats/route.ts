import { NextResponse } from 'next/server';
import { getCertStats } from '@/lib/certDb';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json(getCertStats());
}
