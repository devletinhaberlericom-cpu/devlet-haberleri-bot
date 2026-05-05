import axios, { AxiosInstance } from 'axios';
import { getConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';

interface WpPostInput {
  title: string;
  content: string;
  excerpt?: string;
  slug?: string;
  status?: 'publish' | 'draft' | 'pending' | 'future';
  date_gmt?: string;            // ISO, gelecekte yayın için
  categories?: number[];
  tags?: number[];
  featured_media?: number;      // upload edilmiş medya ID
  meta?: Record<string, any>;
}

interface WpPostResponse {
  id: number;
  link: string;
  status: string;
  slug: string;
  date: string;
  date_gmt: string;
}

export class WordPressPublisher {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor() {
    const config = getConfig();
    this.baseUrl = config.WORDPRESS_URL.replace(/\/$/, '');

    // Application Password Basic Auth
    const auth = Buffer.from(
      `${config.WORDPRESS_USERNAME}:${config.WORDPRESS_APP_PASSWORD.replace(/\s/g, '')}`
    ).toString('base64');

    this.client = axios.create({
      baseURL: `${this.baseUrl}/wp-json/wp/v2`,
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        'User-Agent': 'DevletHaberleri-Bot/1.0',
      },
      timeout: 30000,
    });
  }

  /**
   * Bağlantıyı doğrular - kullanıcı bilgisi çeker
   */
  async testConnection(): Promise<{ ok: boolean; user?: string; error?: string }> {
    try {
      const resp = await this.client.get('/users/me');
      return { ok: true, user: resp.data.name };
    } catch (err: any) {
      return {
        ok: false,
        error: err.response?.data?.message || err.message,
      };
    }
  }

  /**
   * Kategori adından ID'yi bulur, yoksa oluşturur
   */
  async ensureCategory(name: string): Promise<number> {
    // Önce ara
    const search = await this.client.get('/categories', {
      params: { search: name, per_page: 5 },
    });

    const exact = search.data.find(
      (c: any) => c.name.toLowerCase() === name.toLowerCase()
    );
    if (exact) return exact.id;

    // Yoksa oluştur
    const created = await this.client.post('/categories', { name });
    logger.info('publisher', `Yeni kategori oluşturuldu: ${name} (id: ${created.data.id})`);
    return created.data.id;
  }

  /**
   * Etiket adından ID, yoksa oluştur (toplu)
   */
  async ensureTags(names: string[]): Promise<number[]> {
    const ids: number[] = [];
    for (const name of names) {
      try {
        const search = await this.client.get('/tags', {
          params: { search: name, per_page: 5 },
        });
        const exact = search.data.find(
          (t: any) => t.name.toLowerCase() === name.toLowerCase()
        );
        if (exact) {
          ids.push(exact.id);
        } else {
          const created = await this.client.post('/tags', { name });
          ids.push(created.data.id);
        }
      } catch (err: any) {
        logger.warn('publisher', `Tag oluşturma hatası: ${name}`, {
          error: err.message,
        });
      }
    }
    return ids;
  }

  /**
   * URL'den görsel indirir, WP medya kütüphanesine yükler
   */
  async uploadImageFromUrl(imageUrl: string, filename: string): Promise<number | null> {
    try {
      const imageResp = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
      });
      const buffer = Buffer.from(imageResp.data);
      const contentType = imageResp.headers['content-type'] || 'image/jpeg';

      const upload = await this.client.post('/media', buffer, {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
        maxContentLength: 20 * 1024 * 1024,
      });
      return upload.data.id;
    } catch (err: any) {
      logger.warn('publisher', `Görsel yükleme hatası: ${imageUrl}`, {
        error: err.response?.data?.message || err.message,
      });
      return null;
    }
  }

  /**
   * Buffer'dan medya yükler (AI üretilmiş görseller için)
   */
  async uploadImageFromBuffer(
    buffer: Buffer,
    filename: string,
    mimeType: string = 'image/jpeg'
  ): Promise<number | null> {
    try {
      const upload = await this.client.post('/media', buffer, {
        headers: {
          'Content-Type': mimeType,
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
        maxContentLength: 20 * 1024 * 1024,
      });
      return upload.data.id;
    } catch (err: any) {
      logger.warn('publisher', 'Buffer görsel yükleme hatası', {
        error: err.response?.data?.message || err.message,
      });
      return null;
    }
  }

  /**
   * Yazıyı yayınlar
   */
  async createPost(input: WpPostInput): Promise<WpPostResponse> {
    const resp = await this.client.post('/posts', {
      title: input.title,
      content: input.content,
      excerpt: input.excerpt,
      slug: input.slug,
      status: input.status || 'publish',
      date_gmt: input.date_gmt,
      categories: input.categories,
      tags: input.tags,
      featured_media: input.featured_media,
      meta: input.meta,
    });
    return resp.data as WpPostResponse;
  }

  /**
   * Yardımcı: Slug üret (Türkçe karakterleri çevir)
   */
  static makeSlug(title: string): string {
    const trMap: Record<string, string> = {
      ı: 'i', ğ: 'g', ü: 'u', ş: 's', ö: 'o', ç: 'c',
      İ: 'i', Ğ: 'g', Ü: 'u', Ş: 's', Ö: 'o', Ç: 'c',
    };
    return title
      .split('')
      .map(c => trMap[c] || c)
      .join('')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 80);
  }
}
