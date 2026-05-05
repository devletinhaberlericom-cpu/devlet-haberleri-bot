import { askAiJson } from './gemini.js';
import { getDb } from '../db/client.js';
import { logger } from '../utils/logger.js';
import type { RawArticle, AIEvaluation } from '../types.js';

const EVALUATION_SYSTEM = `Sen Türkiye'deki devlet yardımları ve sosyal politika haberlerini değerlendiren bir editör asistanısın.
Hedef kitle: yardım, destek, burs, SGK, emeklilik haberlerini takip eden vatandaşlar.
Görevin: Verilen haberin yayınlamaya değer olup olmadığını puanlamak.

Kategoriler:
- yardim: Sosyal yardım, nakdi destek
- sgk: SGK, emeklilik, prim, sigorta
- asgari_ucret: Asgari ücret, maaş, zam
- burs: Eğitim bursları, KYK, öğrenci destekleri
- emekli: Emekli maaşı, ikramiye, zam
- diger: Yukarıdakilere uymayan ama ilgili olabilecek

Çıktı SADECE geçerli JSON formatında olmalı, başka hiçbir şey yazma.`;

const evalUserPrompt = (article: { title: string; content?: string; source_name: string }) => `
Aşağıdaki haberi değerlendir:

KAYNAK: ${article.source_name}
BAŞLIK: ${article.title}
${article.content ? `İÇERİK: ${article.content.substring(0, 2000)}` : ''}

Şu JSON formatında yanıtla:
{
  "relevance_score": 1-10 arası sayı (10 = vatandaşı doğrudan etkileyen yardım/destek haberi),
  "category": "yardim" | "sgk" | "asgari_ucret" | "burs" | "emekli" | "diger",
  "is_aid_news": true/false (vatandaşa yönelik yardım/destek haberi mi?),
  "is_outdated": true/false (eski/güncelliğini yitirmiş mi?),
  "hook_potential": 1-10 (ilgi çekme potansiyeli),
  "notes": "Kısa not (max 1 cümle)"
}`;

export async function evaluateArticle(
  article: { title: string; content?: string },
  sourceName: string
): Promise<AIEvaluation> {
  return askAiJson<AIEvaluation>({
    system: EVALUATION_SYSTEM,
    user: evalUserPrompt({ ...article, source_name: sourceName }),
    maxTokens: 500,
  });
}

export async function evaluatePendingArticles(limit: number = 30): Promise<number> {
  const { data: articles, error } = await getDb()
    .from('raw_articles')
    .select('*, sources(name)')
    .eq('status', 'new')
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error || !articles) {
    logger.error('ai', 'Haberler yüklenemedi', { error: error?.message });
    return 0;
  }
  if (articles.length === 0) {
    logger.info('ai', 'Değerlendirilecek yeni haber yok');
    return 0;
  }

  logger.info('ai', `${articles.length} haber değerlendiriliyor...`);
  let evaluated = 0;

  for (const article of articles as any[]) {
    try {
      const evaluation = await evaluateArticle(
        { title: article.title, content: article.content || undefined },
        article.sources?.name || 'Bilinmeyen kaynak'
      );

      await getDb()
        .from('raw_articles')
        .update({
          relevance_score: evaluation.relevance_score,
          category: evaluation.category,
          ai_evaluated_at: new Date().toISOString(),
          ai_evaluation_notes: evaluation.notes,
          status: evaluation.is_outdated || !evaluation.is_aid_news ? 'skipped' : 'evaluated',
        })
        .eq('id', article.id);

      evaluated++;

      // Gemini Flash-Lite: 15 RPM = 4 saniyede bir istek
      // Güvenli olması için 5 saniye bekle
      await new Promise(r => setTimeout(r, 5000));
    } catch (err: any) {
      logger.error('ai', `Değerlendirme hatası: ${article.title.substring(0, 60)}`, {
        error: err.message,
      });
    }
  }

  logger.info('ai', `${evaluated} haber değerlendirildi`);
  return evaluated;
}

export async function selectBestArticle(): Promise<RawArticle | null> {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const { data, error } = await getDb()
    .from('raw_articles')
    .select('*')
    .eq('status', 'evaluated')
    .gte('relevance_score', 6)
    .or(`published_at.gte.${cutoff},published_at.is.null`)
    .order('relevance_score', { ascending: false })
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.error('ai', 'Haber seçilemedi', { error: error.message });
    return null;
  }
  if (!data) {
    logger.warn('ai', 'Uygun haber bulunamadı (skor >= 6, son 48 saat)');
    return null;
  }

  await getDb()
    .from('raw_articles')
    .update({ status: 'selected', selected_at: new Date().toISOString() })
    .eq('id', data.id);

  logger.info('ai', `Seçildi: ${data.title} (skor: ${data.relevance_score})`);
  return data as RawArticle;
}
