import { askAiJson } from './gemini.js';
import { getConfig } from '../config/index.js';
import type { RawArticle } from '../types.js';

export interface WpDraft {
  wp_title: string;
  wp_content: string;
  wp_excerpt: string;
  wp_category: string;
  wp_tags: string[];
  pexels_query: string;     // Pexels'te aranacak İngilizce anahtar kelimeler
}

const SYSTEM_PROMPT = (brandName: string, domain: string) => `
Sen ${brandName} (${domain}) için içerik üreten profesyonel bir editörsün.

KESİN KURALLAR (IHLAL ETME):
1. ASLA olmayan bilgi UYDURMA. Sadece verilen kaynak haberden bilgi kullan.
2. Tarih, miktar, başvuru şartı, prim, maaş gibi spesifik sayıları kaynaktan al; tahmin etme.
3. Bir bilgi kaynakta yoksa, yazma. "Detaylar için kaynağa bakın" diye yönlendir.
4. Sansasyonel/clickbait başlık ATMA. "Müjde", "İşte", "Açıklandı" gibi kelimelerden kaçın.
5. AdSense uyumlu olmak için: yanıltıcı, abartılı, korkutucu dil KULLANMA.
6. Türkçe imla ve dilbilgisine titiz ol.
7. Spesifik tarihleri "yakında" diye belirsizleştirme - kaynakta tarih varsa aynen yaz.

Çıktı SADECE geçerli JSON formatında olmalı.
`.trim();

const userPrompt = (article: RawArticle, sourceName: string) => `
Aşağıdaki haberden WordPress için içerik üret:

KAYNAK ADI: ${sourceName}
KAYNAK URL: ${article.url}
ORİJİNAL BAŞLIK: ${article.title}
KATEGORİ: ${article.category}
${article.content ? `\nİÇERİK:\n${article.content.substring(0, 4000)}` : ''}

Aşağıdaki JSON formatında yanıt ver:

{
  "wp_title": "SEO uyumlu başlık (60-75 karakter, ana anahtar kelime başta, abartı yok)",
  "wp_content": "HTML formatında 450-700 kelime makale. Yapı:\\n<p>Giriş paragrafı - haberin özü 2-3 cümlede</p>\\n<h2>Detaylar</h2>\\n<p>Asıl bilgiler...</p>\\n<h2>Kimler Faydalanabilir / Şartlar</h2>\\n<p>Varsa şartlar (yoksa bu başlığı atla)</p>\\n<h2>Başvuru / Süreç</h2>\\n<p>Varsa nasıl başvurulur (yoksa bu başlığı atla)</p>\\n<p><strong>Kaynak:</strong> Bu haber <a href='${article.url}' target='_blank' rel='noopener'>${sourceName}</a> resmi açıklaması temel alınarak hazırlanmıştır. Kesin ve güncel bilgi için lütfen kaynağa başvurun.</p>",
  "wp_excerpt": "120-160 karakter meta description, anahtar kelime içersin",
  "wp_category": "Yardımlar" veya "SGK" veya "Asgari Ücret" veya "Burslar" veya "Emekli" veya "Genel",
  "wp_tags": ["3-7 etiket, küçük harf"],
  "pexels_query": "Bu haber için Pexels'te aranacak 2-4 İngilizce kelime (örn: 'turkish lira money', 'family help', 'office documents', 'students library')"
}

Pexels query örnekleri:
- yardım haberi → "family help money", "social aid"
- SGK haberi → "office documents", "social security"
- asgari ücret → "turkish lira money", "salary calculation"
- burs → "students library", "university scholarship"
- emekli → "elderly people happy", "retirement"

UYARILAR:
- HTML içinde <strong>, <em>, <ul>, <li> kullanabilirsin; <iframe>, <script>, <style> YASAK.
- pexels_query KESİNLİKLE İngilizce olmalı (Pexels Türkçe aramayı zayıf destekliyor).
- pexels_query çok spesifik olmasın (insan ismi, marka adı yok), genel kavramlar kullan.
`;

export async function generateWpDraft(
  article: RawArticle,
  sourceName: string
): Promise<WpDraft> {
  const config = getConfig();
  return askAiJson<WpDraft>({
    system: SYSTEM_PROMPT(config.SITE_BRAND_NAME, config.SITE_DOMAIN),
    user: userPrompt(article, sourceName),
    model: 'gemini-2.5-flash', // Daha kaliteli model burada (250 RPD limit, günde 2-3 yayın yapacağız)
    maxTokens: 3500,
  });
}
