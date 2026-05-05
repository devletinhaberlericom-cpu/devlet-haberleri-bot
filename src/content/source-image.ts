import axios from 'axios';
import * as cheerio from 'cheerio';
import { logger } from '../utils/logger.js';

/**
 * Bir haberin URL'sinden görsel çıkarmaya çalışır:
 * 1. og:image meta tag
 * 2. twitter:image meta tag
 * 3. <article> içindeki ilk büyük <img>
 */
export async function fetchSourceImage(articleUrl: string): Promise<Buffer | null> {
  try {
    const html = await axios.get(articleUrl, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DevletHaberleri/1.0)',
      },
      responseType: 'text',
    });
    const $ = cheerio.load(html.data);

    // 1. og:image (en güvenilir)
    let imageUrl =
      $('meta[property="og:image"]').attr('content') ||
      $('meta[property="og:image:url"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content') ||
      $('meta[name="twitter:image:src"]').attr('content');

    // 2. JSON-LD structured data
    if (!imageUrl) {
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const data = JSON.parse($(el).html() || '');
          if (data.image) {
            imageUrl = typeof data.image === 'string' ? data.image : data.image.url || data.image[0];
          }
        } catch { /* ignore */ }
      });
    }

    // 3. Article içindeki ilk büyük img
    if (!imageUrl) {
      const candidates = $('article img, .news-content img, .post-content img, .entry-content img, main img').toArray();
      for (const el of candidates) {
        const src = $(el).attr('src') || $(el).attr('data-src');
        if (!src) continue;
        const w = parseInt($(el).attr('width') || '0');
        const h = parseInt($(el).attr('height') || '0');
        // Çok küçük ikonları atla
        if (w > 0 && w < 200) continue;
        if (h > 0 && h < 150) continue;
        if (src.includes('icon') || src.includes('logo') || src.includes('avatar')) continue;
        imageUrl = src;
        break;
      }
    }

    if (!imageUrl) return null;

    // Relative URL'yi absolute yap
    if (imageUrl.startsWith('//')) {
      imageUrl = 'https:' + imageUrl;
    } else if (imageUrl.startsWith('/')) {
      const base = new URL(articleUrl);
      imageUrl = `${base.protocol}//${base.host}${imageUrl}`;
    }

    // İndir
    const imgResp = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      maxContentLength: 10 * 1024 * 1024, // 10MB max
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    const contentType = String(imgResp.headers['content-type'] || '');
    if (!contentType.startsWith('image/')) {
      logger.warn('content', `Kaynak görsel image değil: ${contentType}`);
      return null;
    }

    return Buffer.from(imgResp.data);
  } catch (err: any) {
    logger.warn('content', `Kaynak görseli çekilemedi: ${articleUrl}`, {
      error: err.message,
    });
    return null;
  }
}
