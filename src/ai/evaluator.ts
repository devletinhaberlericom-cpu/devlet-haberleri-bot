import { askAiJson } from './gemini.js';
import { getDb } from '../db/client.js';
import { logger } from '../utils/logger.js';
import type { RawArticle, AIEvaluation, ArticleCategory } from '../types.js';

const EVALUATION_SYSTEM = `Sen Türkiye'deki devlet yardımları ve sosyal politika haberlerini değerlendiren bir editör asistanısın.
Hedef kitle: yardım, destek, burs, SGK, emeklilik haberlerini takip eden vatandaşlar.

ALAKALI konular (yüksek puan, is_aid_news=true):
- Vatandaşa nakdi/ayni yardım, sosyal destek, ödeme
- SGK prim, emeklilik, EYT, malulen emeklilik
- Asgari ücret, kıdem tazminatı, işsizlik maaşı
- KYK bursu, öğrenci yardımı, eğitim destekleri
- Sosyal konut, kira yardımı, faturalara destek
- Aile destek, çocuk yardımı, engelli destek

ALAKASIZ konular (düşük puan):
- Dış politika, diplomasi, bakanlık ziyaretleri
- Savunma, askeri, savaş
- Borsa/döviz/makro ekonomi
- Spor, kültür, magazin

Çıktı SADECE geçerli JSON formatında olmalı.`;

const evalUserPrompt = (article: { title: string; content?: string; source_name: string }) => `
Aşağıdaki haberi değerlendir:

KAYNAK: ${article.source_name}
BAŞLIK: ${article.title}
${article.content ? `İÇERİK: ${article.content.substring(0, 1500)}` : ''}

JSON formatında yanıtla:
{
  "relevance_score": 1-10 arası sayı,
  "category": "yardim" | "sgk" | "asgari_ucret" | "burs" | "emekli" | "diger",
  "is_aid_news": true/false,
  "is_outdated": true/false,
  "hook_potential": 1-10,
  "notes": "Kısa not"
}`;

export async function evaluateArticle(
  article: { title: string; content?: string },
  sourceName: string
): Promise<AIEvaluation> {
  return askAiJson<AIEvaluation>({
    system: EVALUATION_SYSTEM,
    user: evalUserPrompt({ ...article, source_name: sourceName }),
    maxTokens: 400,
  });
}

/**
 * AI olmadan basit anahtar kelime tabanlı puanlama (yedek sistem)
 */
function keywordScore(title: string, content?: string): { score: number; category: ArticleCategory; isAid: boolean } {
  const text = (title + ' ' + (content || '')).toLowerCase();

  // Yüksek puan kelimeleri (kategoriyle birlikte)
  const highValue: Array<[string, ArticleCategory]> = [
    // Yardım
    ['yardım', 'yardim'], ['destek ödeme', 'yardim'], ['nakdi yardım', 'yardim'],
    ['sosyal yardım', 'yardim'], ['ihtiyaç sahibi', 'yardim'], ['aile destek', 'yardim'],
    ['engelli destek', 'yardim'], ['kira yardımı', 'yardim'], ['fatura desteği', 'yardim'],
    // SGK
    ['sgk', 'sgk'], ['prim', 'sgk'], ['sigorta', 'sgk'], ['eyt', 'sgk'],
    ['malulen', 'sgk'], ['hizmet borçlanma', 'sgk'],
    // Asgari ücret
    ['asgari ücret', 'asgari_ucret'], ['kıdem tazminatı', 'asgari_ucret'],
    ['işsizlik maaşı', 'asgari_ucret'], ['işçi hakları', 'asgari_ucret'],
    // Burs
    ['kyk', 'burs'], ['burs', 'burs'], ['öğrenci kredi', 'burs'],
    ['öğrenci yurt', 'burs'], ['eğitim desteği', 'burs'],
    // Emekli
    ['emekli maaşı', 'emekli'], ['emekli zammı', 'emekli'], ['emekli ikramiye', 'emekli'],
    ['emekli bayram', 'emekli'], ['emeklilik şart', 'emekli'],
  ];

  // Eleyici kelimeler (varsa puan sıfırlanır)
  const blocker = [
    'fidan', 'erdoğan', 'cumhurbaşkanı', 'kanada', 'fransa', 'ermenistan',
    'londra', 'müslüman', 'yahudi bıçak', 'avrasya', 'doğu-batı', 'ipek yolu',
    'kabine', 'kanada başbakanı', 'morrison', 'jet yakıt',
    'tcmb', 'karahan', 'borsa', 'döviz', 'savunma', 'silah',
    'saha 2026', 'rallisi', 'golf', 'fenomen', 'spor', 'magazin',
    'futbol', 'basketbol', 'maç ', ' lig ', 'transfer'
  ];

  for (const kw of blocker) {
    if (text.includes(kw)) {
      return { score: 1, category: 'diger', isAid: false };
    }
  }

  // Eşleşme say
  let score = 0;
  let category: ArticleCategory = 'diger';
  for (const [kw, cat] of highValue) {
    if (text.includes(kw)) {
      score += 3;
      if (category === 'diger') category = cat;
    }
  }

  // Genel "vatandaş" kelimesi varsa puan ekle
  if (text.includes('vatandaş') || text.includes('başvuru')) score += 1;
  if (text.includes('milyon') && text.includes('tl')) score += 1;

  // Cap at 10
  score = Math.min(score, 10);

  return {
    score,
    category,
    isAid: score >= 4,
  };
}

function isObviouslyIrrelevant(title: string): boolean {
  const t = title.toLowerCase();
  const skipKeywords = [
    'fidan', 'erdoğan', 'cumhurbaşkanı', 'kanada', 'fransa', 'ermenistan',
    'londra', 'müslüman', 'yahudi bıçak', 'avrasya', 'doğu-batı',
    'ipek yolu', 'kabine', 'morrison', 'tcmb', 'karahan', 'borsa', 'döviz',
    'savunma', 'silah', 'saha 2026', 'rallisi', 'jet yakıt',
    'golf', 'fenomen', 'futbol', 'basketbol', ' maç ', ' lig ', 'transfer'
  ];
  return skipKeywords.some(kw => t.includes(kw));
}

export async function evaluatePendingArticles(limit: number = 15): Promise<number> {
  const { data: articles, error } = await getDb()
    .from('raw_articles')
    .select('*, sources(name)')
    .eq('status', 'new')
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(50);

  if (error || !articles) {
    logger.error('ai', 'Haberler yüklenemedi', { error: error?.message });
    return 0;
  }
  if (articles.length === 0) {
    logger.info('ai', 'Değerlendirilecek yeni haber yok');
    return 0;
  }

  // Ön-filtre: Açıkça alakasız olanları AI'ya yollamadan ele
  const skipped: any[] = [];
  const candidates: any[] = [];
  for (const a of articles as any[]) {
    if (isObviouslyIrrelevant(a.title)) {
      skipped.push(a);
    } else {
      candidates.push(a);
    }
  }

  if (skipped.length > 0) {
    await getDb()
      .from('raw_articles')
      .update({
        status: 'skipped',
        relevance_score: 1,
        category: 'diger',
        ai_evaluated_at: new Date().toISOString(),
        ai_evaluation_notes: 'Ön-filtre: alakasız',
      })
      .in('id', skipped.map(s => s.id));
    logger.info('ai', `${skipped.length} haber ön-filtre ile elendi`);
  }

  const toEvaluate = candidates.slice(0, limit);
  if (toEvaluate.length === 0) {
    logger.info('ai', 'Değerlendirilecek aday haber yok');
    return 0;
  }

  logger.info('ai', `${toEvaluate.length} haber değerlendiriliyor...`);
  let evaluated = 0;
  let aiBroken = false;

  for (const article of toEvaluate) {
    try {
      // AI çalışıyorsa AI kullan, çalışmıyorsa anahtar kelime puanlamasına geç
      let scoreData;
      if (!aiBroken) {
        try {
          const evaluation = await evaluateArticle(
            { title: article.title, content: article.content || undefined },
            article.sources?.name || 'Bilinmeyen'
          );
          scoreData = {
            relevance_score: evaluation.relevance_score,
            category: evaluation.category,
            is_aid_news: evaluation.is_aid_news,
            is_outdated: evaluation.is_outdated,
            notes: evaluation.notes,
          };
          await new Promise(r => setTimeout(r, 4000));
        } catch (err: any) {
          if (err.message?.includes('429') || err.message?.includes('quota')) {
            logger.warn('ai', `AI limiti doldu, anahtar kelime puanlamasına geçildi`);
            aiBroken = true;
            // Bu haber için de keyword score kullan
            const ks = keywordScore(article.title, article.content);
            scoreData = {
              relevance_score: ks.score,
              category: ks.category,
              is_aid_news: ks.isAid,
              is_outdated: false,
              notes: 'Anahtar kelime puanlaması (AI limit dolu)',
            };
          } else {
            throw err;
          }
        }
      } else {
        // AI bozuk, direkt keyword puanlama
        const ks = keywordScore(article.title, article.content);
        scoreData = {
          relevance_score: ks.score,
          category: ks.category,
          is_aid_news: ks.isAid,
          is_outdated: false,
          notes: 'Anahtar kelime puanlaması (AI limit dolu)',
        };
      }

      await getDb()
        .from('raw_articles')
        .update({
          relevance_score: scoreData.relevance_score,
          category: scoreData.category,
          ai_evaluated_at: new Date().toISOString(),
          ai_evaluation_notes: scoreData.notes,
          status: scoreData.is_outdated || !scoreData.is_aid_news ? 'skipped' : 'evaluated',
        })
        .eq('id', article.id);

      evaluated++;
    } catch (err: any) {
      logger.error('ai', `Hata: ${article.title.substring(0, 60)}`, { error: err.message });
    }
  }

  logger.info('ai', `${evaluated} haber değerlendirildi`);
  return evaluated;
}

/**
 * En iyi haberi seçer. Eğer skor >= 5 yoksa, skor >= 3'ü dener (garanti yayın için).
 */
export async function selectBestArticle(): Promise<RawArticle | null> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Önce yüksek skor (>=5) dene
  let { data, error } = await getDb()
    .from('raw_articles')
    .select('*')
    .eq('status', 'evaluated')
    .gte('relevance_score', 5)
    .or(`published_at.gte.${cutoff},published_at.is.null`)
    .order('relevance_score', { ascending: false })
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  // Yoksa orta skor (>=3) dene - garanti yayın için
  if (!data && !error) {
    logger.warn('ai', 'Skor >= 5 yok, skor >= 3 deneniyor (garanti yayın)');
    const result = await getDb()
      .from('raw_articles')
      .select('*')
      .eq('status', 'evaluated')
      .gte('relevance_score', 3)
      .or(`published_at.gte.${cutoff},published_at.is.null`)
      .order('relevance_score', { ascending: false })
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    data = result.data;
    error = result.error;
  }

  // Yine yoksa, evaluated olan herhangi biri (en son çare)
  if (!data && !error) {
    logger.warn('ai', 'Skor >= 3 yok, herhangi bir evaluated haber deneniyor');
    const result = await getDb()
      .from('raw_articles')
      .select('*')
      .eq('status', 'evaluated')
      .order('relevance_score', { ascending: false })
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    data = result.data;
    error = result.error;
  }

  if (error) {
    logger.error('ai', 'Haber seçilemedi', { error: error.message });
    return null;
  }
  if (!data) {
    logger.warn('ai', 'Hiç uygun haber bulunamadı');
    return null;
  }

  await getDb()
    .from('raw_articles')
    .update({ status: 'selected', selected_at: new Date().toISOString() })
    .eq('id', data.id);

  logger.info('ai', `Seçildi: ${data.title} (skor: ${data.relevance_score})`);
  return data as RawArticle;
}
