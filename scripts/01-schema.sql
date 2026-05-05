-- =====================================================
-- DEVLET HABERLERİ - WP HABER BOTU - DB ŞEMASI
-- =====================================================
-- Supabase SQL Editor'de bu dosyayı çalıştır.

-- =====================================================
-- 1. KAYNAKLAR
-- =====================================================
CREATE TABLE sources (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  base_url TEXT NOT NULL,
  scraper_type TEXT NOT NULL,             -- 'rss' | 'html'
  scraper_config JSONB NOT NULL,
  trust_level INTEGER DEFAULT 10,
  active BOOLEAN DEFAULT TRUE,
  last_scraped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sources_active ON sources(active);

-- =====================================================
-- 2. HAM HABERLER
-- =====================================================
CREATE TABLE raw_articles (
  id SERIAL PRIMARY KEY,
  source_id INTEGER REFERENCES sources(id) ON DELETE CASCADE,
  external_id TEXT,
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  content TEXT,
  published_at TIMESTAMPTZ,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  -- AI değerlendirme
  relevance_score INTEGER,
  category TEXT,
  ai_evaluated_at TIMESTAMPTZ,
  ai_evaluation_notes TEXT,
  -- Durum
  status TEXT DEFAULT 'new',              -- 'new' | 'evaluated' | 'selected' | 'used' | 'skipped'
  selected_at TIMESTAMPTZ,
  used_at TIMESTAMPTZ
);

CREATE INDEX idx_raw_articles_status ON raw_articles(status);
CREATE INDEX idx_raw_articles_score ON raw_articles(relevance_score DESC);
CREATE INDEX idx_raw_articles_published ON raw_articles(published_at DESC);

-- =====================================================
-- 3. ÜRETİLEN İÇERİKLER
-- =====================================================
CREATE TABLE generated_content (
  id SERIAL PRIMARY KEY,
  raw_article_id INTEGER REFERENCES raw_articles(id) ON DELETE CASCADE,
  -- WordPress
  wp_title TEXT NOT NULL,
  wp_slug TEXT,
  wp_content TEXT NOT NULL,
  wp_excerpt TEXT,
  wp_category TEXT,
  wp_tags TEXT[],
  wp_post_id INTEGER,
  wp_post_url TEXT,
  -- (Instagram alanları sonradan eklenebilir, şimdilik boş)
  ig_caption TEXT,
  ig_hashtags TEXT[],
  ig_post_id TEXT,
  -- Onay/durum
  approval_status TEXT DEFAULT 'approved', -- tam otomatik mod default 'approved'
  -- Yayın
  published_at TIMESTAMPTZ,
  publish_error TEXT,
  -- Meta
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_generated_status ON generated_content(approval_status);
CREATE INDEX idx_generated_published ON generated_content(published_at DESC);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_generated_content_updated_at
  BEFORE UPDATE ON generated_content
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 4. SİSTEM LOGLARI
-- =====================================================
CREATE TABLE system_logs (
  id SERIAL PRIMARY KEY,
  level TEXT NOT NULL,
  category TEXT,
  message TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_logs_level ON system_logs(level);
CREATE INDEX idx_logs_created ON system_logs(created_at DESC);

-- =====================================================
-- 5. BAŞLANGIÇ KAYNAKLARI
-- =====================================================
INSERT INTO sources (name, slug, base_url, scraper_type, scraper_config, trust_level) VALUES
  (
    'Aile ve Sosyal Hizmetler Bakanlığı',
    'aile-bakanligi',
    'https://www.aile.gov.tr',
    'html',
    '{"list_url": "https://www.aile.gov.tr/duyurular/", "item_selector": ".duyuru-item, article, .news-item", "title_selector": "h3, h2, .title", "link_selector": "a"}'::jsonb,
    10
  ),
  (
    'SGK Duyurular',
    'sgk',
    'https://www.sgk.gov.tr',
    'html',
    '{"list_url": "https://www.sgk.gov.tr/Duyurular", "item_selector": "article, .duyuru, .news-item", "title_selector": "h2 a, h3 a, .title a", "link_selector": "a"}'::jsonb,
    10
  ),
  (
    'Anadolu Ajansı - Ekonomi',
    'aa-ekonomi',
    'https://www.aa.com.tr',
    'rss',
    '{"feed_url": "https://www.aa.com.tr/tr/rss/default?cat=ekonomi"}'::jsonb,
    8
  ),
  (
    'Anadolu Ajansı - Genel',
    'aa-genel',
    'https://www.aa.com.tr',
    'rss',
    '{"feed_url": "https://www.aa.com.tr/tr/rss/default?cat=guncel"}'::jsonb,
    8
  ),
  (
    'İletişim Başkanlığı',
    'iletisim-baskanligi',
    'https://www.iletisim.gov.tr',
    'html',
    '{"list_url": "https://www.iletisim.gov.tr/turkce/haberler", "item_selector": "article, .news-item, .haber-item", "title_selector": "h2 a, h3 a", "link_selector": "a"}'::jsonb,
    10
  );

-- Doğrulama
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
