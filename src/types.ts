// =====================================================
// Veritabanı tipleri (Supabase tablolarıyla eşleşir)
// =====================================================

export type ScraperType = 'rss' | 'html' | 'api';

export interface Source {
  id: number;
  name: string;
  slug: string;
  base_url: string;
  scraper_type: ScraperType;
  scraper_config: Record<string, any>;
  trust_level: number;
  active: boolean;
  last_scraped_at: string | null;
  created_at: string;
}

export type ArticleStatus = 'new' | 'evaluated' | 'selected' | 'used' | 'skipped';
export type ArticleCategory = 'yardim' | 'sgk' | 'asgari_ucret' | 'burs' | 'emekli' | 'diger';

export interface RawArticle {
  id: number;
  source_id: number;
  external_id: string | null;
  url: string;
  title: string;
  content: string | null;
  published_at: string | null;
  scraped_at: string;
  relevance_score: number | null;
  category: ArticleCategory | null;
  ai_evaluated_at: string | null;
  ai_evaluation_notes: string | null;
  status: ArticleStatus;
  selected_at: string | null;
  used_at: string | null;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'edited' | 'expired';

export interface GeneratedContent {
  id: number;
  raw_article_id: number;
  // WordPress
  wp_title: string;
  wp_slug: string | null;
  wp_content: string;
  wp_excerpt: string | null;
  wp_category: string | null;
  wp_tags: string[] | null;
  wp_post_id: number | null;
  wp_post_url: string | null;
  // Instagram
  ig_caption: string;
  ig_hashtags: string[] | null;
  ig_post_image_path: string | null;
  ig_post_image_url: string | null;
  ig_reel_video_path: string | null;
  ig_reel_video_url: string | null;
  ig_post_id: string | null;
  ig_reel_id: string | null;
  // Onay
  approval_status: ApprovalStatus;
  telegram_message_id: number | null;
  approved_at: string | null;
  approved_by: string | null;
  rejection_reason: string | null;
  // Yayın
  published_at: string | null;
  publish_error: string | null;
  // Meta
  created_at: string;
  updated_at: string;
}

// =====================================================
// Scraper input/output tipleri
// =====================================================

export interface ScrapedItem {
  external_id?: string;
  url: string;
  title: string;
  content?: string;
  published_at?: Date;
}

export interface ScraperResult {
  source_id: number;
  source_name: string;
  items_found: number;
  items_new: number;
  items: ScrapedItem[];
  errors: string[];
  duration_ms: number;
}

// =====================================================
// AI değerlendirme
// =====================================================

export interface AIEvaluation {
  relevance_score: number;        // 1-10
  category: ArticleCategory;
  is_aid_news: boolean;
  is_outdated: boolean;
  hook_potential: number;         // 1-10 (paylaşıma değer mi?)
  notes: string;
}

// =====================================================
// İçerik üretimi
// =====================================================

export interface ContentGenerationInput {
  article: RawArticle;
  source_name: string;
}

export interface GeneratedContentDraft {
  // WP
  wp_title: string;
  wp_content: string;
  wp_excerpt: string;
  wp_category: string;
  wp_tags: string[];
  // IG
  ig_caption: string;
  ig_hashtags: string[];
  // Görsel için
  visual_headline: string;       // post görselinde gösterilecek kısa başlık
  visual_subtitle: string;       // alt başlık
  visual_category_label: string; // "YARDIM HABERİ" gibi etiket
  // Reel için 5 slayt metni
  reel_slides: ReelSlide[];
}

export interface ReelSlide {
  index: number;
  headline: string;       // büyük başlık
  body: string;          // alt detay
  emoji?: string;
}
