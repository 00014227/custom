'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { CheckResponse, MatchResult } from '@/types';

type Filter = 'all' | 'found' | 'not_found' | 'not_required';

function ConfidenceDot({ c }: { c: string }) {
  const colors: Record<string, string> = { high: 'bg-green-500', medium: 'bg-yellow-400', low: 'bg-red-400' };
  return <span className={`inline-block w-2 h-2 rounded-full mr-1 ${colors[c] ?? 'bg-gray-300'}`} />;
}

function StatusBadge({ status }: { status: MatchResult['status'] }) {
  if (status === 'found')
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800">✓ Найден</span>;
  if (status === 'not_required')
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">— Не требуется</span>;
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800">✗ Не найден</span>;
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckResponse | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [stats, setStats] = useState<{ count: number; notRequiredCount: number; files: number; loadedAt: string | null } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/stats').then(r => r.json()).then(setStats).catch(() => null);
  }, []);

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    setFile(files[0]); setError(null); setResult(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  async function handleCheck() {
    if (!file) return;
    setLoading(true); setError(null); setResult(null); setFilter('all');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/check', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Ошибка сервера');
      setResult(data as CheckResponse);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  async function handleExport() {
    if (!result) return;
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'results.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  }

  const visible: MatchResult[] = result
    ? result.results.filter(r => filter === 'all' ? true : r.status === filter)
    : [];

  const borderColor = (status: MatchResult['status']) =>
    status === 'found' ? 'border-l-green-400' : status === 'not_required' ? 'border-l-blue-400' : 'border-l-red-400';

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-gray-900 text-white shadow-md">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="bg-red-600 text-white text-xs font-bold px-2 py-1 rounded">TOYOTA</div>
            <h1 className="text-lg font-semibold tracking-wide">Система проверки сертификатов</h1>
          </div>
          {stats && (
            <div className="text-sm text-gray-400 flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${stats.count > 0 ? 'bg-green-400' : 'bg-red-400'}`} />
                Сертификатов: <span className="text-white font-medium">{stats.count.toLocaleString('ru-RU')}</span>
              </span>
              {stats.notRequiredCount > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-400" />
                  Не требует: <span className="text-white font-medium">{stats.notRequiredCount.toLocaleString('ru-RU')}</span>
                </span>
              )}
              <span className="text-gray-500">из {stats.files} файлов</span>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 w-full flex-1">
        {/* Upload card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 mb-6">
          <h2 className="text-base font-semibold text-gray-700 mb-1">Загрузить документ</h2>
          <p className="text-sm text-gray-400 mb-5">
            Поддерживаются любые форматы: Excel (.xlsx), PDF, изображения (JPG, PNG)
          </p>
          <div
            className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors
              ${dragging ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-400 hover:bg-gray-50'}`}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
          >
            <input ref={inputRef} type="file" accept=".xlsx,.xls,.pdf,.jpg,.jpeg,.png,.webp,.csv" className="hidden"
              onChange={e => handleFiles(e.target.files)} />
            {file ? (
              <div className="flex items-center justify-center gap-3">
                <svg className="w-8 h-8 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <div className="text-left">
                  <p className="font-medium text-gray-800">{file.name}</p>
                  <p className="text-sm text-gray-400">{(file.size / 1024).toFixed(1)} KB — нажмите для замены</p>
                </div>
              </div>
            ) : (
              <div>
                <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-gray-500 font-medium">Перетащите файл сюда или нажмите для выбора</p>
                <p className="text-gray-400 text-sm mt-1">xlsx · pdf · jpg · png · csv</p>
              </div>
            )}
          </div>

          {error && (
            <div className="mt-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
          )}

          <button onClick={handleCheck} disabled={!file || loading}
            className="mt-5 w-full py-3 px-6 rounded-xl font-semibold text-white bg-blue-600 hover:bg-blue-700
              disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2">
            {loading ? (
              <><svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>Проверка...</>
            ) : (
              <><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>Проверить сертификаты</>
            )}
          </button>
        </div>

        {/* Results */}
        {result && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            {/* Summary */}
            <div className="px-6 py-4 border-b border-gray-100 flex flex-wrap items-center gap-4">
              <div className="flex gap-6 text-sm">
                <span className="text-gray-500">Всего: <span className="font-bold text-gray-800">{result.total}</span></span>
                <span className="text-green-600">Найдено: <span className="font-bold">{result.found}</span></span>
                <span className="text-red-600">Не найдено: <span className="font-bold">{result.not_found}</span></span>
                <span className="text-blue-600">Не требует: <span className="font-bold">{result.not_required}</span></span>
              </div>
              <div className="flex gap-2 ml-auto flex-wrap">
                {(['all', 'found', 'not_found', 'not_required'] as Filter[]).map(f => (
                  <button key={f} onClick={() => setFilter(f)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors
                      ${filter === f
                        ? f === 'found' ? 'bg-green-100 text-green-800'
                          : f === 'not_found' ? 'bg-red-100 text-red-800'
                          : f === 'not_required' ? 'bg-blue-100 text-blue-800'
                          : 'bg-gray-800 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                    {f === 'all' ? 'Все' : f === 'found' ? 'Найдено' : f === 'not_found' ? 'Не найдено' : 'Не требует'}
                  </button>
                ))}
                <button onClick={handleExport}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>Скачать Excel
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <th className="px-4 py-3 w-10">#</th>
                    <th className="px-4 py-3">Артикул</th>
                    <th className="px-4 py-3">Код ТН ВЭД</th>
                    <th className="px-4 py-3 min-w-[220px]">Наименование</th>
                    <th className="px-4 py-3">Страна</th>
                    <th className="px-4 py-3 w-36">Статус</th>
                    <th className="px-4 py-3">Номер сертификата</th>
                    <th className="px-4 py-3">Дата</th>
                    <th className="px-4 py-3 min-w-[180px]">Наименование в сертификате</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {visible.map(r => (
                    <tr key={r.index} className={`hover:bg-gray-50 transition-colors border-l-2 ${borderColor(r.status)}`}>
                      <td className="px-4 py-3 text-gray-400">{r.index}</td>
                      <td className="px-4 py-3 font-mono text-gray-600 text-xs">{r.part_number || '—'}</td>
                      <td className="px-4 py-3 font-mono text-gray-700">{r.hs_code || '—'}</td>
                      <td className="px-4 py-3 text-gray-800 leading-snug">{r.description}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{r.country || '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {r.status !== 'not_required' && <ConfidenceDot c={r.confidence} />}
                          <StatusBadge status={r.status} />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs font-mono whitespace-nowrap">{r.cert_number ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{r.cert_date ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-600 text-xs leading-snug">{r.cert_description ?? '—'}</td>
                    </tr>
                  ))}
                  {visible.length === 0 && (
                    <tr><td colSpan={9} className="px-4 py-12 text-center text-gray-400">Нет записей</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
