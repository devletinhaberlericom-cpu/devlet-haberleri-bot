import { getDb } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { processSource, type IScraper } from './base.js';
import { RssScraper } from './rss.js';
import { HtmlScraper } from './html.js';
import type { Source, ScraperResult } from '../types.js';

const SCRAPERS: Record<string, IScraper> = {
  rss: new RssScraper(),
  html: new HtmlScraper(),
};

/**
 * Tüm aktif kaynakları paralel tarar.
 */
export async function runAllScrapers(): Promise<ScraperResult[]> {
  const { data: sources, error } = await getDb()
    .from('sources')
    .select('*')
    .eq('active', true);

  if (error) {
    logger.error('scraper', 'Kaynaklar yüklenemedi', { error: error.message });
    return [];
  }

  if (!sources || sources.length === 0) {
    logger.warn('scraper', 'Aktif kaynak yok');
    return [];
  }

  logger.info('scraper', `${sources.length} kaynak taranacak`);

  // Paralel ama fazla agresif olmasın diye batch'le (3'lü)
  const results: ScraperResult[] = [];
  const batchSize = 3;
  for (let i = 0; i < sources.length; i += batchSize) {
    const batch = sources.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((source) => scrapeSingle(source as Source))
    );
    results.push(...batchResults);
  }

  // Özet
  const totalNew = results.reduce((s, r) => s + r.items_new, 0);
  const totalErrors = results.reduce((s, r) => s + r.errors.length, 0);
  logger.info('scraper', `Tarama bitti: ${totalNew} yeni haber, ${totalErrors} hata`);

  return results;
}

async function scrapeSingle(source: Source): Promise<ScraperResult> {
  const scraper = SCRAPERS[source.scraper_type];
  if (!scraper) {
    logger.error('scraper', `Bilinmeyen scraper tipi: ${source.scraper_type}`);
    return {
      source_id: source.id,
      source_name: source.name,
      items_found: 0,
      items_new: 0,
      items: [],
      errors: [`Unknown scraper type: ${source.scraper_type}`],
      duration_ms: 0,
    };
  }

  return processSource(source, scraper);
}
