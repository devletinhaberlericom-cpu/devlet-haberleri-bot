/**
 * Tam pipeline testi: scrape -> evaluate -> 1 yayın
 * DİKKAT: Gerçek WordPress sitene yayın yapar!
 */
import { runAllScrapers } from '../scrapers/index.js';
import { evaluatePendingArticles } from '../ai/evaluator.js';
import { publishOne } from '../content/pipeline.js';
import { logger } from '../utils/logger.js';

async function main() {
  console.log('⚠️  Bu test gerçek WordPress sitene yayın yapacak!');
  console.log('   İptal etmek için 5 saniye içinde Ctrl+C\n');
  await new Promise(r => setTimeout(r, 5000));

  logger.info('system', '=== TAM PIPELINE TESTİ ===');

  logger.info('system', '--- 1/3 Scraping ---');
  const scrapeResults = await runAllScrapers();
  const totalNew = scrapeResults.reduce((s, r) => s + r.items_new, 0);
  console.log(`   ${totalNew} yeni haber kaydedildi`);

  logger.info('system', '--- 2/3 AI Değerlendirme ---');
  const evaluated = await evaluatePendingArticles(20);
  console.log(`   ${evaluated} haber değerlendirildi`);

  logger.info('system', '--- 3/3 Yayın ---');
  const result = await publishOne();
  if (result.success) {
    console.log(`   ✅ Yayınlandı!`);
    console.log(`   📝 Yazı ID: ${result.wpPostId}`);
    console.log(`   🔗 URL: ${result.wpPostUrl}`);
  } else {
    console.log(`   ❌ Hata: ${result.error}`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
