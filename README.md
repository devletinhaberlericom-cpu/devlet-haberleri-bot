# Devlet Haberleri Bot

devletinhaberleri.com için **%100 ücretsiz** WordPress otomatik haber bot.

## Özellikler

- 🆓 **Tamamen ücretsiz** stack — kredi kartı gerekmez
- 🤖 Resmi kaynaklardan haber tarar (aile.gov.tr, sgk.gov.tr, AA, vs.)
- 🧠 Google Gemini ile haberleri SEO uyumlu makaleye dönüştürür
- 📷 Pexels'ten profesyonel stock fotoğraflar ekler
- 📤 WordPress'e tam otomatik yayınlar
- ⏰ GitHub Actions cron ile günde 2 kere çalışır (sunucu gerekmez)

## Stack

| Bileşen | Servis | Maliyet |
|---------|--------|---------|
| AI metin | Google Gemini 2.5 Flash/Flash-Lite | Ücretsiz (1500 RPD) |
| Görsel | Pexels API | Ücretsiz (20K istek/ay) |
| Veritabanı | Supabase | Ücretsiz (500MB) |
| Hosting | GitHub Actions | Ücretsiz (public repo) |
| WordPress | Senin siten | (zaten var) |
| **Toplam** | | **$0/ay** |

## Akış

```
GitHub Actions tetikler (09:30 ve 17:30 İstanbul)
   ↓
1. Resmi kaynakları tarar
2. Yeni haberleri Gemini ile puanlar (1-10)
3. En yüksek puanlı haberi seçer
4. AI ile SEO uyumlu makale yazar
5. Görsel: önce kaynaktan, yoksa Pexels'ten
6. WordPress'e tam otomatik yayınlar
```

## Kurulum

### Adım 1: API key'leri al (10-15 dk)

**1.1 Gemini API key**
- https://aistudio.google.com/apikey
- Google hesabıyla giriş
- "Create API key" → key'i kopyala
- **Kart gerekmez ✅**

**1.2 Pexels API key**
- https://www.pexels.com/api/new/
- Hesap aç (e-posta + şifre)
- API key sayfasından key'i kopyala
- **Kart gerekmez ✅**

**1.3 Supabase**
- https://supabase.com → "New project"
- Region: **Frankfurt (eu-central-1)** seç (Türkiye'ye en yakın)
- Project URL + anon key + service_role key'i Settings → API'den al
- **Kart gerekmez ✅**

**1.4 WordPress hazırlığı**
- WP admin → Kullanıcılar → Yeni Ekle → kullanıcı adı `otomasyon`, rol **Editör**
- O kullanıcı için Profil → Application Passwords → "Bot" diye oluştur, kopyala
- Doğrulama: tarayıcıda `https://devletinhaberleri.com/wp-json/wp/v2/posts` JSON dönüyor mu?

### Adım 2: Veritabanını kur

1. Supabase project → SQL Editor
2. `scripts/01-schema.sql` içeriğini yapıştır → Run

### Adım 3: Lokal test

```bash
# 1. Bağımlılıkları kur
npm install

# 2. .env dosyası oluştur
cp .env.example .env
# .env dosyasını editle ve API key'leri yapıştır

# 3. Bağlantı testi
npm run test:connections

# 4. Scraper testi (yayın yapmaz)
npm run test:scrape

# 5. TAM TEST: gerçek WP'ye yayın yapar!
npm run test:full
```

### Adım 4: GitHub'a push + Actions kurulumu

```bash
# Git repo başlat
git init
git add .
git commit -m "Initial commit"

# GitHub'da yeni repo aç (private veya public)
git remote add origin https://github.com/KULLANICIN/devlet-haberleri-bot.git
git push -u origin main
```

GitHub'da repo'ya git → **Settings → Secrets and variables → Actions**:

**New repository secret** olarak ekle (her biri ayrı):
- `GEMINI_API_KEY`
- `PEXELS_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `WORDPRESS_URL`
- `WORDPRESS_USERNAME`
- `WORDPRESS_APP_PASSWORD`

**Variables** sekmesinden (zorunlu değil, default'lar var):
- `SITE_DOMAIN` = `devletinhaberleri.com`
- `SITE_BRAND_NAME` = `Devlet Haberleri`
- `POSTS_PER_RUN` = `1`

### Adım 5: İlk çalıştırma testi

GitHub'da repo → **Actions** sekmesi → "Devlet Haberleri Bot" workflow'u → **Run workflow** → Run.

Çıktıyı izle, başarılıysa otomatik olarak günde 2 kere çalışacak.

## Klasör Yapısı

```
src/
├── ai/
│   ├── gemini.ts            # Gemini API wrapper
│   ├── evaluator.ts         # Haber puanlama
│   └── content-generator.ts # Makale üretimi
├── config/                  # Env validation
├── content/
│   ├── pipeline.ts          # Ana orchestrator
│   ├── pexels-image.ts      # Stock fotoğraf
│   └── source-image.ts      # Kaynaktan görsel
├── db/                      # Supabase client
├── publishers/wordpress.ts  # WP REST API
├── scrapers/                # RSS + HTML scraper'lar
├── scripts/                 # Test scriptleri
├── utils/logger.ts
├── index.ts                 # Entry point
└── types.ts

.github/workflows/bot.yml    # GitHub Actions cron
scripts/01-schema.sql        # Supabase DB şeması
```

## Komutlar

| Komut | Ne yapar |
|-------|----------|
| `npm run test:connections` | Tüm API'leri test eder |
| `npm run test:scrape` | Sadece scraper (yayın yok) |
| `npm run test:full` | Tam test (1 yayın yapar!) |
| `npm run publish:once` | Sadece 1 yayın |
| `npm run run:job` | Tam iş (scrape+evaluate+publish) |
| `npm run dev` | Tam iş (geliştirme modu) |

## Güvenlik

- AI **uydurma yapmaz** — sistem prompt'u kaynak dışı bilgiyi yasaklar
- Her makalenin sonunda **kaynak linki** + **Pexels attribution** otomatik
- Skor < 6 olan haberler yayına çıkmaz
- AdSense uyumlu: clickbait kelimeler yasak, abartılı dil yasak
- Pexels attribution yasal zorunluluk olduğu için her yazıya otomatik eklenir

## Limitleri

- **Gemini Flash:** 250 istek/gün (yayın için yeter)
- **Gemini Flash-Lite:** 1500 istek/gün (değerlendirme için yeter)
- **Pexels:** 200 istek/saat, 20K/ay (fazlasıyla yeter)
- **Supabase Free:** 500MB DB, 5GB transfer/ay (yeter)
- **GitHub Actions:** Public repo'da sınırsız, private repo 2000 dk/ay (bot ~30 dk/ay kullanır)

## Sorun Giderme

**WP "401 Unauthorized":**
- Application Password doğru mu? Boşluklar dahil kopyalandı mı?
- Kullanıcı rolü Editor (veya üstü) mü?

**Gemini "429 Too Many Requests":**
- Limit aşıldı, ertesi güne kadar bekle (Pacific time'da resetlenir)
- Veya `content-generator.ts`'de modeli `flash-lite`'a düşür

**"Uygun haber bulunamadı":**
- Kaynak siteleri yeni içerik üretmemiş olabilir
- DB'de `raw_articles` tablosunda skor 6+ olan kayıt yok demektir

## Sonraki Adımlar

- [ ] Web yönetim paneli (geçmiş yayınlar, manual ekleme)
- [ ] Google Analytics entegrasyonu
- [ ] Daha fazla kaynak ekleme (KYK, Çalışma Bakanlığı)
- [ ] İleride: Instagram modülü
