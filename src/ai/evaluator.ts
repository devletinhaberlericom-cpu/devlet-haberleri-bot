import { askAiJson } from './gemini.js';
import { getDb } from '../db/client.js';
import { logger } from '../utils/logger.js';
import type { RawArticle, AIEvaluation } from '../types.js';

const EVALUATION_SYSTEM = `Sen Türkiye'deki devlet yardımları ve sosyal politika haberlerini değerlendiren bir editör asistanısın.
Hedef kitle: yardım, destek, burs, SGK, emeklilik haberlerini takip eden vatandaşlar.
Görevin: Verilen haberin yayınlamaya değer olup olmadığını puanlamak.

ÇOK ÖNEMLİ: Aşağıdaki konular VATANDAŞ İÇİN ALAKASIZ — bunlara MUTLAKA 1-2 puan ver ve is_aid_news=false yap:
- Dış politika, diplomasi, başkanlık ziyaretleri
- Savunma sanayi, askeri tatbikat, silah/savaş
- Borsa, döviz kuru, makro ekonomi raporları
- Sektör zirveleri, ekonomi konferansları, ihracat haberleri
- Siyasi mesajlar, parti açıklamaları
- Spor, kültür-sanat, magazin

ALAKALI konular (yüksek puan ver, is_aid_news=true):
- Doğrudan vatandaşa nakdi/ayni yardım, destek, ödeme
- SGK prim, emeklilik şartları, emekli maaşı/zammı
- Asgari ücret, kıdem tazminatı, işçi hakları
- KYK bursu, öğrenci yardımı, eğitim destekleri
- İşsizlik maaşı, EYT, malulen emeklilik
- Sosyal konut, kira yardımı, faturalara destek

Kategoriler: yardim | sgk | asgari_ucret | burs | emekli | diger

Çıktı SADECE geçerli JSON formatında olmalı, başka hiçbir şey yazma.`;

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
  "notes": "Kısa not (max 1 cümle)"
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
 * BASİT ÖN-FİLTRE: AI'ya yollamadan, açıkça alakasız haberleri eler.
 * Gemini'nin günlük 20 limit'ini boşa harcamamak için.
 */
function isObviouslyIrrelevant(title: string): boolean {
  const t = title.toLowerCase();
  const skipKeywords = [
    // dış politika
    'fidan', 'erdoğan', 'cumhurbaşkanı', 'kanada', 'fransa', 'ermenistan',
    'londra', 'müslüman', 'yahudi', 'bakan ', 'avrasya', 'asya kalkınma',
    'doğu-batı', 'ipek yolu', 'kabine', 'kanada başbakanı', 'morrison',
    'ab jet', 'ab ',
    // ekonomi/finans/savunma (vatandaşa direkt değmeyen)
    'tcmb', 'karahan', 'borsa', 'döviz', 'kur ', 'savunma', 'silah',
    'saha 2026', 'savaş', 'jet yakıt', 'ihracat', 'rallisi', 'turizm',
    'golf', 'antalya turizm', 'katılım finans', 'zirvesi', 'fenomen',
    'kobi', 'mevka',
    // diğer
    'ralli', '60 saniye', 'spor', 'magazin'
  ];
  return skipKeywords.some(kw => t.includes(kw));
}

export async function evaluatePendingArticles(limit: number = 15): Promise<number> {
  const { data: articles, error } = await getDb()
    .from('raw_articles')
    .select('*, sources(name)')
    .eq('status', 'new')
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(50); // Önce 50 çek, ön-filtreden geçir, sonra AI'ya yolla

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

  // Skipped'leri toplu güncelle (AI çağırmadan)
  if (skipped.length > 0) {
    await getDb()
      .from('raw_articles')
      .update({
        status: 'skipped',
        relevance_score: 1,
        category: 'diger',
        ai_evaluated_at: new Date().toISOString(),
        ai_evaluation_notes: 'Ön-filtre: alakasız anahtar kelime',
      })
      .in('id', skipped.map(s => s.id));
    logger.info('ai', `${skipped.length} haber ön-filtre ile elendi`);
  }

  // AI'ya yollanacak adayları sınırla (Gemini günlük 20 limit)
  const toEvaluate = candidates.slice(0, limit);
  if (toEvaluate.length === 0) {
    logger.info('ai', 'AI değerlendirmesi gereken haber yok');
    return 0;
  }

  logger.info('ai', `${toEvaluate.length} haber AI ile değerlendiriliyor (${candidates.length} aday)...`);
  let evaluated = 0;

  for (const article of toEvaluate) {
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

      // Gemini limit: 4 saniyede 1 istek (15 RPM)
      await new Promise(r => setTimeout(r, 4000));
    } catch (err: any) {
      // 429 alırsak dur, kaldığımız yerden yarın devam ederiz
      if (err.message?.includes('429') || err.message?.includes('quota')) {
        logger.warn('ai', `Günlük limit doldu, ${evaluated} haber değerlendirildi`);
        break;
      }
      logger.error('ai', `Değerlendirme hatası: ${article.title.substring(0, 60)}`, {
        error: err.message,
      });
    }
  }

  logger.info('ai', `${evaluated} haber AI ile değerlendirildi`);
  return evaluated;
}

export async function selectBestArticle(): Promise<RawArticle | null> {
  // Son 7 gün içinde, evaluated, henüz kullanılmamış (eskiden 48 saatti, açtık)
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await getDb()
    .from('raw_articles')
    .select('*')
    .eq('status', 'evaluated')
    .gte('relevance_score', 5) // Eşiği 6'dan 5'e düşürdük
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
    logger.warn('ai', 'Uygun haber bulunamadı (skor >= 5, son 7 gün)');
    return null;
  }

  await getDb()
    .from('raw_articles')
    .update({ status: 'selected', selected_at: new Date().toISOString() })
    .eq('id', data.id);

  logger.info('ai', `Seçildi: ${data.title} (skor: ${data.relevance_score})`);
  return data as RawArticle;
}
