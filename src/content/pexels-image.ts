import axios from 'axios';
import { getConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  photographer_url: string;
  src: {
    original: string;
    large2x: string;
    large: string;
    medium: string;
  };
  alt: string;
}

interface PexelsSearchResponse {
  photos: PexelsPhoto[];
  total_results: number;
}

interface FetchedPexelsImage {
  buffer: Buffer;
  photographer: string;
  photographer_url: string;
  pexels_url: string;
}

/**
 * Pexels'ten haber için uygun fotoğraf bulur ve indirir.
 *
 * Limit: 200 istek/saat, 20.000/ay (bizim için fazlasıyla yeterli)
 * Attribution gerekli: photographer + Pexels link her görselin altına eklenmeli
 */
export async function fetchPexelsImage(
  query: string,
  orientation: 'landscape' | 'portrait' | 'square' = 'landscape'
): Promise<FetchedPexelsImage | null> {
  const config = getConfig();

  try {
    const search = await axios.get<PexelsSearchResponse>(
      'https://api.pexels.com/v1/search',
      {
        params: {
          query,
          orientation,
          per_page: 10,
          size: 'medium',
        },
        headers: { Authorization: config.PEXELS_API_KEY },
        timeout: 15000,
      }
    );

    if (!search.data.photos || search.data.photos.length === 0) {
      logger.warn('content', `Pexels'te "${query}" için sonuç yok`);
      return null;
    }

    // İlk 5 sonuçtan rastgele birini seç (daha çeşitli görseller için)
    const candidates = search.data.photos.slice(0, 5);
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];

    // İndir (large boyut WP için yeterli, 1920x boyutunda)
    const imgResp = await axios.get(chosen.src.large, {
      responseType: 'arraybuffer',
      timeout: 30000,
      maxContentLength: 10 * 1024 * 1024,
    });

    return {
      buffer: Buffer.from(imgResp.data),
      photographer: chosen.photographer,
      photographer_url: chosen.photographer_url,
      pexels_url: chosen.url,
    };
  } catch (err: any) {
    logger.warn('content', `Pexels arama hatası: "${query}"`, {
      error: err.response?.data?.error || err.message,
    });
    return null;
  }
}

/**
 * Attribution HTML'i oluşturur - her makalenin sonuna eklenir
 */
export function buildPexelsAttribution(image: FetchedPexelsImage): string {
  return `<p><small>Görsel: <a href="${image.photographer_url}" target="_blank" rel="noopener nofollow">${image.photographer}</a> tarafından <a href="${image.pexels_url}" target="_blank" rel="noopener nofollow">Pexels</a> üzerinde paylaşılmıştır.</small></p>`;
}
