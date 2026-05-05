/**
 * Entry point.
 * GitHub Actions cron her tetiklediğinde tüm işi yapar:
 * scrape -> evaluate -> publish 1-2 haber -> exit
 *
 * Komutlar:
 *   tsx src/index.ts --job        -> tam iş (scrape + evaluate + publish)
 *   tsx src/index.ts --publish    -> sadece 1 yayın (test)
 *   tsx src/index.ts --scrape     -> sadece scrape
 */
import { runAllScrapers } from './scrapers/index.js';
import { evaluatePendingArticles } from './ai/evaluator.js';
import { publishOne, publishMany } from './content/pipeline.js';
import { getConfig } from './config/index.js';
import { logger } from './utils/logger.js';

async function fullJob() {
  const config = getConfig();
  logger.info('system', '🤖 Bot başladı');

  // 1. Scrape
  logger.info('system', '--- 1/3 Scraping ---');
  const scrapeResults = await runAllScrapers();
  const totalNew = scrapeResults.reduce((s, r) => s + r.items_new, 0);
  logger.info('system', `${totalNew} yeni haber`);

  // 2. Evaluate
  logger.info('system', '--- 2/3 AI Değerlendirme ---');
  const evaluated = await evaluatePendingArticles(40);
  logger.info('system', `${evaluated} haber değerlendirildi`);

  // 3. Publish (config.POSTS_PER_RUN kadar)
  logger.info('system', `--- 3/3 Yayın (${config.POSTS_PER_RUN} adet) ---`);
  const results = await publishMany(config.POSTS_PER_RUN);
  const success = results.filter(r => r.success).length;

  logger.info('system', `✅ İş bitti: ${success}/${results.length} yayın başarılı`);
  return { scraped: totalNew, evaluated, published: success, total: results.length };
}

async function main() {
  const args = process.argv.slice(2);

  try {
    if (args.includes('--scrape')) {
      const results = await runAllScrapers();
      console.log(JSON.stringify({ totalNew: results.reduce((s, r) => s + r.items_new, 0) }, null, 2));
      process.exit(0);
    }

    if (args.includes('--publish')) {
      const result = await publishOne();
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    }

    if (args.includes('--job')) {
      const summary = await fullJob();
      console.log(JSON.stringify(summary, null, 2));
      process.exit(0);
    }

    // Varsayılan: --job
    const summary = await fullJob();
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  } catch (err: any) {
    logger.error('system', 'Fatal hata', { error: err.message });
    console.error(err);
    process.exit(1);
  }
}

main();
