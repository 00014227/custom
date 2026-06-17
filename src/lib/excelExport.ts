import * as XLSX from 'xlsx';
import type { MatchResult } from '../types';

export function buildResultsExcel(results: MatchResult[]): Buffer {
  const header = [
    '№', 'Артикул', 'Код ТН ВЭД', 'Наименование', 'Страна', 'Статус',
    'Номер сертификата', 'Дата сертификата', 'Наименование в сертификате', 'Уверенность',
  ];

  const rows = results.map(r => [
    r.index,
    r.part_number,
    r.hs_code,
    r.description,
    r.country ?? '',
    r.status === 'found' ? 'Найден' : r.status === 'not_required' ? 'Не требует' : 'Не найден',
    r.cert_number ?? '',
    r.cert_date ?? '',
    r.cert_description ?? '',
    r.confidence === 'high' ? 'Высокая' : r.confidence === 'medium' ? 'Средняя' : 'Низкая',
  ]);

  const found = results.filter(r => r.status === 'found').length;
  const notRequired = results.filter(r => r.status === 'not_required').length;
  const notFound = results.filter(r => r.status === 'not_found').length;
  const wb = XLSX.utils.book_new();

  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws['!cols'] = [
    { wch: 5 }, { wch: 15 }, { wch: 14 }, { wch: 55 }, { wch: 14 },
    { wch: 13 }, { wch: 32 }, { wch: 18 }, { wch: 55 }, { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Результаты');

  const sumWs = XLSX.utils.aoa_to_sheet([
    ['Всего товаров', results.length],
    ['Найдено сертификатов', found],
    ['Не найдено', notFound],
    ['Не требует сертификации', notRequired],
  ]);
  XLSX.utils.book_append_sheet(wb, sumWs, 'Сводка');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
