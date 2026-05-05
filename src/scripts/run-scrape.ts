/**
 * Sadece scraper'ı test eder.
 * Çalıştırma: npm run scrape
 */
import { runAllScrapers } from '../scrapers/index.js';
import { logger } from '../utils/logger.js';

async function main() {
  const startTime = Date.now();
  logger.info('system', '=== SCRAPER TEST BAŞLADI ===');

  const results = await runAllScrapers();

  console.log('\n=== ÖZET ===');
  for (const r of results) {
    const status = r.errors.length > 0 ? '❌' : r.items_new > 0 ? '✅' : '○';
    console.log(
      `${status} ${r.source_name.padEnd(50)} ` +
      `bulundu: ${r.items_found.toString().padStart(3)}, ` +
      `yeni: ${r.items_new.toString().padStart(3)}, ` +
      `süre: ${r.duration_ms}ms`
    );
    if (r.errors.length > 0) {
      r.errors.forEach(e => console.log(`     ⚠️  ${e}`));
    }
  }
  console.log(`\nToplam süre: ${Date.now() - startTime}ms`);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal hata:', err);
  process.exit(1);
});
