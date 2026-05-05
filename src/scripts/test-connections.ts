/**
 * Tüm bağlantıları test eder.
 * Çalıştırma: npm run test:connections
 */
import axios from 'axios';
import { getConfig } from '../config/index.js';
import { getDb } from '../db/client.js';
import { askAi } from '../ai/gemini.js';
import { WordPressPublisher } from '../publishers/wordpress.js';

async function main() {
  console.log('🔍 Bağlantılar test ediliyor...\n');

  // 1. Config
  let config;
  try {
    config = getConfig();
    console.log('✅ Config yüklendi');
    console.log(`   Site: ${config.WORDPRESS_URL}`);
    console.log(`   Brand: ${config.SITE_BRAND_NAME}`);
  } catch (err: any) {
    console.log(`❌ Config: ${err.message}`);
    process.exit(1);
  }

  // 2. Supabase
  try {
    const { count, error } = await getDb()
      .from('sources')
      .select('*', { count: 'exact', head: true });
    if (error) throw error;
    console.log(`✅ Supabase bağlandı (${count} kaynak tanımlı)`);
  } catch (err: any) {
    console.log(`❌ Supabase: ${err.message}`);
  }

  // 3. Gemini
  try {
    const resp = await askAi({
      user: 'Sadece "OK" yaz, başka hiçbir şey yazma.',
      maxTokens: 10,
    });
    console.log(`✅ Gemini bağlandı (yanıt: "${resp.trim()}")`);
  } catch (err: any) {
    console.log(`❌ Gemini: ${err.message}`);
  }

  // 4. Pexels
  try {
    const resp = await axios.get('https://api.pexels.com/v1/search', {
      params: { query: 'test', per_page: 1 },
      headers: { Authorization: config.PEXELS_API_KEY },
      timeout: 10000,
    });
    const remaining = resp.headers['x-ratelimit-remaining'];
    console.log(`✅ Pexels bağlandı (kalan istek: ${remaining || 'bilinmiyor'})`);
  } catch (err: any) {
    console.log(`❌ Pexels: ${err.response?.status || err.message}`);
  }

  // 5. WordPress
  try {
    const wp = new WordPressPublisher();
    const result = await wp.testConnection();
    if (result.ok) {
      console.log(`✅ WordPress bağlandı (kullanıcı: ${result.user})`);
    } else {
      console.log(`❌ WordPress: ${result.error}`);
    }
  } catch (err: any) {
    console.log(`❌ WordPress: ${err.message}`);
  }

  console.log('\n✨ Test tamamlandı.');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
