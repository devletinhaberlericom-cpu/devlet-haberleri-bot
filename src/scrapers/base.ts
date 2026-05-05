import type { Source, ScrapedItem, ScraperResult } from '../types.js';
import { logger } from '../utils/logger.js';
import { getDb } from '../db/client.js';

/**
 * Tüm scraper'lar bu interface'i implement eder.
 */
export interface IScraper {
  scrape(source: Source): Promise<ScrapedItem[]>;
}

/**
 * Bir kaynağı işler:
 * 1. Scraper'ı çalıştırır
 * 2. Daha önce kaydedilmiş URL'leri filtreler (duplicate önleme)
 * 3. Yeni olanları DB'ye yazar
 */
export async function processSource(
  source: Source,
  scraper: IScraper
): Promise<ScraperResult> {
  const startedAt = Date.now();
  const result: ScraperResult = {
    source_id: source.id,
    source_name: source.name,
    items_found: 0,
    items_new: 0,
    items: [],
    errors: [],
    duration_ms: 0,
  };

  try {
    logger.info('scraper', `Taranıyor: ${source.name}`);
    const items = await scraper.scrape(source);
    result.items_found = items.length;

    if (items.length === 0) {
      logger.warn('scraper', `${source.name}: hiç sonuç yok`);
      result.duration_ms = Date.now() - startedAt;
      return result;
    }

    // Duplicate kontrolü: aynı URL varsa atla
    const urls = items.map(i => i.url);
    const { data: existing } = await getDb()
      .from('raw_articles')
      .select('url')
      .in('url', urls);

    const existingUrls = new Set((existing || []).map(e => e.url));
    const newItems = items.filter(i => !existingUrls.has(i.url));

    if (newItems.length === 0) {
      logger.info('scraper', `${source.name}: ${items.length} bulundu, hepsi mevcut`);
      result.duration_ms = Date.now() - startedAt;
      return result;
    }

    // Yenileri DB'ye yaz
    const rows = newItems.map(item => ({
      source_id: source.id,
      external_id: item.external_id || null,
      url: item.url,
      title: item.title.substring(0, 500), // güvenlik
      content: item.content?.substring(0, 50000) || null,
      published_at: item.published_at?.toISOString() || null,
      status: 'new',
    }));

    const { error } = await getDb().from('raw_articles').insert(rows);
    if (error) {
      result.errors.push(`DB insert hatası: ${error.message}`);
      logger.error('scraper', `${source.name} DB insert hatası`, { error: error.message });
    } else {
      result.items_new = newItems.length;
      result.items = newItems;
      logger.info(
        'scraper',
        `${source.name}: ${items.length} bulundu, ${newItems.length} yeni`
      );
    }

    // last_scraped_at güncelle
    await getDb()
      .from('sources')
      .update({ last_scraped_at: new Date().toISOString() })
      .eq('id', source.id);
  } catch (err: any) {
    const msg = err.message || String(err);
    result.errors.push(msg);
    logger.error('scraper', `${source.name} hata: ${msg}`);
  }

  result.duration_ms = Date.now() - startedAt;
  return result;
}

/**
 * Türkçe tarih parse'i ("12 Ocak 2025", "12.01.2025" vs.)
 */
const TR_MONTHS: Record<string, number> = {
  ocak: 0, şubat: 1, mart: 2, nisan: 3, mayıs: 4, haziran: 5,
  temmuz: 6, ağustos: 7, eylül: 8, ekim: 9, kasım: 10, aralık: 11,
};

export function parseTurkishDate(input: string | undefined | null): Date | undefined {
  if (!input) return undefined;
  const s = input.trim().toLowerCase();

  // ISO formatı (en güvenilir)
  const isoMatch = s.match(/^\d{4}-\d{2}-\d{2}/);
  if (isoMatch) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
  }

  // "12.01.2025" veya "12/01/2025"
  const numericMatch = s.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (numericMatch) {
    const [, day, month, year] = numericMatch;
    const d = new Date(Number(year), Number(month) - 1, Number(day));
    if (!isNaN(d.getTime())) return d;
  }

  // "12 Ocak 2025"
  const trMatch = s.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (trMatch) {
    const [, day, monthName, year] = trMatch;
    const monthIdx = TR_MONTHS[monthName.toLowerCase()];
    if (monthIdx !== undefined) {
      const d = new Date(Number(year), monthIdx, Number(day));
      if (!isNaN(d.getTime())) return d;
    }
  }

  // Son çare: native parse
  const fallback = new Date(input);
  if (!isNaN(fallback.getTime())) return fallback;

  return undefined;
}

/**
 * URL'leri normalize et (utm parametreleri, fragment vs. temizle)
 */
export function normalizeUrl(url: string, baseUrl?: string): string {
  try {
    const u = new URL(url, baseUrl);
    // Tracking parametrelerini sil
    const blacklist = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid'];
    blacklist.forEach(p => u.searchParams.delete(p));
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}
