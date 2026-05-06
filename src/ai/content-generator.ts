import { askAiJson } from './gemini.js';
import { getConfig } from '../config/index.js';
import type { RawArticle } from '../types.js';

export interface WpDraft {
  wp_title: string;
  wp_content: string;
  wp_excerpt: string;
  wp_category: string;
  wp_tags: string[];
  pexels_query: string;
}

const SYSTEM_PROMPT = (brandName: string, domain: string) => `
Sen ${brandName} (${domain}) için içerik üreten profesyonel bir editörsün.

KESİN KURALLAR:
1. ASLA olmayan bilgi UYDURMA. Sadece verilen kaynaktan bilgi kullan.
2. Tarih, miktar, başvuru şartı gibi spesifik sayıları kaynaktan al.
3. Bir bilgi kaynakta yoksa, yazma. "Detaylar için kaynağa bakın" diye yönlendir.
4. Sansasyonel/clickbait başlık atma. "Müjde", "İşte", "Açıklandı" kelimelerinden kaçın.
5. AdSense uyumlu: yanıltıcı, abartılı dil kullanma.
6. Türkçe imla ve dilbilgisine titiz ol.

Çıktı SADECE geçerli JSON formatında olmalı.
`.trim();

const userPrompt = (article: RawArticle, sourceName: string) => `
Aşağıdaki haberden WordPress için içerik üret:

KAYNAK: ${sourceName}
URL: ${article.url}
BAŞLIK: ${article.title}
KATEGORİ: ${article.category}
${article.content ? `\nİÇERİK:\n${article.content.substring(0, 4000)}` : ''}

JSON formatında yanıt ver:
{
  "wp_title": "SEO uyumlu başlık (60-75 karakter)",
  "wp_content": "HTML formatında 450-700 kelime makale. Şu yapıda:\\n<p>Giriş paragrafı</p>\\n<h2>Detaylar</h2>\\n<p>Asıl bilgiler...</p>\\n<h2>Kimler Faydalanabilir / Şartlar</h2>\\n<p>Varsa şartlar (yoksa atla)</p>\\n<h2>Başvuru / Süreç</h2>\\n<p>Varsa başvuru (yoksa atla)</p>\\n<p><strong>Kaynak:</strong> Bu haber <a href='${article.url}' target='_blank' rel='noopener'>${sourceName}</a> resmi açıklaması temel alınarak hazırlanmıştır. Kesin bilgi için kaynağa başvurun.</p>",
  "wp_excerpt": "120-160 karakter meta description",
  "wp_category": "Yardımlar" | "SGK" | "Asgari Ücret" | "Burslar" | "Emekli" | "Genel",
  "wp_tags": ["3-7 etiket, küçük harf"],
  "pexels_query": "2-4 İngilizce kelime (örn: 'turkish lira', 'office documents', 'students library')"
}
`;

/**
 * AI olmadan basit şablon ile içerik üretir (yedek sistem)
 */
function generateFallbackDraft(article: RawArticle, sourceName: string): WpDraft {
  const categoryMap: Record<string, { wpCat: string; pexels: string; tags: string[] }> = {
    yardim: { wpCat: 'Yardımlar', pexels: 'turkish family help', tags: ['yardım', 'sosyal destek', 'devlet desteği'] },
    sgk: { wpCat: 'SGK', pexels: 'office documents', tags: ['sgk', 'sosyal güvenlik', 'sigorta'] },
    asgari_ucret: { wpCat: 'Asgari Ücret', pexels: 'turkish lira money', tags: ['asgari ücret', 'maaş', 'işçi'] },
    burs: { wpCat: 'Burslar', pexels: 'students library', tags: ['burs', 'öğrenci', 'eğitim'] },
    emekli: { wpCat: 'Emekli', pexels: 'elderly people', tags: ['emekli', 'emeklilik', 'maaş'] },
    diger: { wpCat: 'Genel', pexels: 'turkish government building', tags: ['haber', 'duyuru'] },
  };

  const cat = categoryMap[article.category || 'diger'] || categoryMap.diger;

  // Temiz başlık (orijinali kullan ama temizle)
  const title = article.title.trim().substring(0, 75);

  // İçerikten alınmış metni kullan, yoksa basit şablon
  const sourceContent = (article.content || '').trim().substring(0, 2000);

  let wpContent = '';
  if (sourceContent.length > 100) {
    // Kaynaktan içerik var, paragraflar halinde sun
    const paragraphs = sourceContent
      .split(/\n\n|\n/)
      .map(p => p.trim())
      .filter(p => p.length > 30)
      .slice(0, 5);

    wpContent = `<p><strong>${article.title}</strong></p>\n`;
    for (const p of paragraphs) {
      wpContent += `<p>${escapeHtml(p)}</p>\n`;
    }
  } else {
    // İçerik yok, sadece başlığı temel al
    wpContent = `<p>Bu haber, <strong>${escapeHtml(article.title)}</strong> konusunu ele almaktadır.</p>\n`;
    wpContent += `<p>Konuyla ilgili detaylı bilgilere kaynak haberden ulaşabilirsiniz. Başvuru şartları, tarihler ve detaylar için aşağıdaki kaynak linkini takip etmenizi öneririz.</p>\n`;
  }

  // Kaynak bilgisi her zaman eklenir
  wpContent += `\n<p><strong>Kaynak:</strong> Bu haber <a href="${article.url}" target="_blank" rel="noopener">${sourceName}</a> resmi açıklaması temel alınarak hazırlanmıştır. Kesin ve güncel bilgi için lütfen kaynağa başvurun.</p>`;

  // Excerpt
  const excerpt = article.title.substring(0, 155);

  return {
    wp_title: title,
    wp_content: wpContent,
    wp_excerpt: excerpt,
    wp_category: cat.wpCat,
    wp_tags: cat.tags,
    pexels_query: cat.pexels,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export async function generateWpDraft(
  article: RawArticle,
  sourceName: string
): Promise<WpDraft> {
  const config = getConfig();

  // AI ile dene
  try {
    return await askAiJson<WpDraft>({
      system: SYSTEM_PROMPT(config.SITE_BRAND_NAME, config.SITE_DOMAIN),
      user: userPrompt(article, sourceName),
      model: 'gemini-2.5-flash-lite',
      maxTokens: 3500,
    });
  } catch (err: any) {
    // AI limit doluysa şablon ile üret (garanti yayın)
    if (err.message?.includes('429') || err.message?.includes('quota')) {
      console.log('⚠️ AI limit dolu, yedek şablon ile içerik üretiliyor');
      return generateFallbackDraft(article, sourceName);
    }
    // Başka bir hata varsa fırlat
    throw err;
  }
}
