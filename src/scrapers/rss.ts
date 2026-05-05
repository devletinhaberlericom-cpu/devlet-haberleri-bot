import Parser from 'rss-parser';
import type { IScraper } from './base.js';
import type { Source, ScrapedItem } from '../types.js';
import { normalizeUrl, parseTurkishDate } from './base.js';

interface RssConfig {
  feed_url: string;
  max_items?: number;
}

export class RssScraper implements IScraper {
  private parser = new Parser({
    timeout: 15000,
    headers: { 'User-Agent': 'DevletHaberleri/1.0 (Otomasyon)' },
  });

  async scrape(source: Source): Promise<ScrapedItem[]> {
    const config = source.scraper_config as RssConfig;
    if (!config.feed_url) throw new Error(`${source.name}: feed_url eksik`);

    const feed = await this.parser.parseURL(config.feed_url);
    const maxItems = config.max_items || 20;

    const items: ScrapedItem[] = [];
    for (const entry of feed.items.slice(0, maxItems)) {
      if (!entry.link || !entry.title) continue;

      items.push({
        external_id: entry.guid || entry.link,
        url: normalizeUrl(entry.link, source.base_url),
        title: entry.title.trim(),
        content: entry.contentSnippet || entry.content || undefined,
        published_at: parseTurkishDate(entry.pubDate || entry.isoDate),
      });
    }
    return items;
  }
}
