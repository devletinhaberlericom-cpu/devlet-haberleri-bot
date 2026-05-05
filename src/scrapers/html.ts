import axios from 'axios';
import * as cheerio from 'cheerio';
import type { IScraper } from './base.js';
import type { Source, ScrapedItem } from '../types.js';
import { normalizeUrl, parseTurkishDate } from './base.js';

interface HtmlConfig {
  list_url: string;
  item_selector: string;
  title_selector: string;
  link_selector?: string;     // a tag, item_selector içinde
  date_selector?: string;
  content_selector?: string;  // detay sayfasından çekmek için
  max_items?: number;
  fetch_content?: boolean;    // her item'ın detay sayfasına da git mi?
}

export class HtmlScraper implements IScraper {
  async scrape(source: Source): Promise<ScrapedItem[]> {
    const config = source.scraper_config as HtmlConfig;
    if (!config.list_url || !config.item_selector || !config.title_selector) {
      throw new Error(`${source.name}: scraper_config eksik (list_url, item_selector, title_selector zorunlu)`);
    }

    const html = await this.fetch(config.list_url);
    const $ = cheerio.load(html);

    const items: ScrapedItem[] = [];
    const maxItems = config.max_items || 15;

    $(config.item_selector).each((_, el) => {
      if (items.length >= maxItems) return false;

      const $el = $(el);
      const title = $el.find(config.title_selector).first().text().trim();
      if (!title) return undefined;

      // Link bulma: ya ayrı bir selector, ya title içindeki <a>, ya da item'in kendisi <a>
      let href: string | undefined;
      if (config.link_selector) {
        href = $el.find(config.link_selector).first().attr('href');
      } else {
        href = $el.find('a').first().attr('href') || $el.attr('href');
      }
      if (!href) return undefined;

      const dateStr = config.date_selector ? $el.find(config.date_selector).first().text().trim() : undefined;

      items.push({
        url: normalizeUrl(href, source.base_url),
        title,
        published_at: parseTurkishDate(dateStr),
      });
      return undefined;
    });

    // İsteğe bağlı: detay sayfalarından içerik çek
    if (config.fetch_content && config.content_selector) {
      for (const item of items) {
        try {
          const detailHtml = await this.fetch(item.url);
          const $$ = cheerio.load(detailHtml);
          item.content = $$(config.content_selector).text().trim().substring(0, 10000);
        } catch {
          // tek bir detay sayfası hata verirse devam et
        }
      }
    }

    return items;
  }

  private async fetch(url: string): Promise<string> {
    const resp = await axios.get(url, {
      timeout: 20000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DevletHaberleri/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.5',
      },
      responseType: 'text',
      // Bazı .gov.tr siteleri sertifika sorunu çıkarabiliyor — production'da dikkat
    });
    return resp.data;
  }
}
