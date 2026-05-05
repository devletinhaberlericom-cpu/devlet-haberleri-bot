import { getDb } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { selectBestArticle } from '../ai/evaluator.js';
import { generateWpDraft } from '../ai/content-generator.js';
import { WordPressPublisher } from '../publishers/wordpress.js';
import { fetchSourceImage } from './source-image.js';
import { fetchPexelsImage, buildPexelsAttribution } from './pexels-image.js';

interface PublishResult {
  success: boolean;
  generatedContentId?: number;
  wpPostId?: number;
  wpPostUrl?: string;
  error?: string;
}

/**
 * Tek bir haberi tam pipeline'dan geçirip yayınlar.
 */
export async function publishOne(): Promise<PublishResult> {
  // 1. Haber seç
  const article = await selectBestArticle();
  if (!article) {
    return { success: false, error: 'Uygun haber bulunamadı' };
  }

  const { data: source } = await getDb()
    .from('sources')
    .select('name')
    .eq('id', article.source_id)
    .single();

  const sourceName = source?.name || 'Bilinmeyen kaynak';

  // 2. İçerik üret
  let draft;
  try {
    logger.info('content', `İçerik üretiliyor: ${article.title.substring(0, 60)}`);
    draft = await generateWpDraft(article, sourceName);
  } catch (err: any) {
    logger.error('content', 'AI içerik hatası', { error: err.message });
    await getDb().from('raw_articles').update({ status: 'evaluated' }).eq('id', article.id);
    return { success: false, error: err.message };
  }

  // generated_content kaydı
  const { data: contentRow, error: insertErr } = await getDb()
    .from('generated_content')
    .insert({
      raw_article_id: article.id,
      wp_title: draft.wp_title,
      wp_content: draft.wp_content,
      wp_excerpt: draft.wp_excerpt,
      wp_category: draft.wp_category,
      wp_tags: draft.wp_tags,
      ig_caption: '',
      approval_status: 'approved',
    })
    .select()
    .single();

  if (insertErr || !contentRow) {
    logger.error('content', 'DB insert hatası', { error: insertErr?.message });
    return { success: false, error: insertErr?.message };
  }

  // 3. Görseli al: önce kaynak, sonra Pexels
  let imageBuffer: Buffer | null = null;
  let imageSource: 'source' | 'pexels' | 'none' = 'none';
  let pexelsImage: Awaited<ReturnType<typeof fetchPexelsImage>> = null;
  const imageFilename = `haber-${contentRow.id}.jpg`;

  imageBuffer = await fetchSourceImage(article.url);
  if (imageBuffer) {
    imageSource = 'source';
    logger.info('publisher', 'Kaynak görseli alındı');
  } else {
    logger.info('publisher', `Pexels'ten görsel aranıyor: "${draft.pexels_query}"`);
    pexelsImage = await fetchPexelsImage(draft.pexels_query, 'landscape');
    if (pexelsImage) {
      imageBuffer = pexelsImage.buffer;
      imageSource = 'pexels';
    }
  }

  // 4. WordPress'e yayınla
  const wp = new WordPressPublisher();

  let featuredMediaId: number | undefined;
  if (imageBuffer) {
    const mediaId = await wp.uploadImageFromBuffer(imageBuffer, imageFilename, 'image/jpeg');
    featuredMediaId = mediaId || undefined;
  }

  // İçeriğe Pexels attribution ekle (yasal zorunluluk)
  let finalContent = draft.wp_content;
  if (pexelsImage && imageSource === 'pexels') {
    finalContent += '\n\n' + buildPexelsAttribution(pexelsImage);
  }

  let categoryId: number;
  try {
    categoryId = await wp.ensureCategory(draft.wp_category);
  } catch {
    categoryId = await wp.ensureCategory('Genel');
  }

  const tagIds = await wp.ensureTags(draft.wp_tags);

  let wpPost;
  try {
    wpPost = await wp.createPost({
      title: draft.wp_title,
      content: finalContent,
      excerpt: draft.wp_excerpt,
      slug: WordPressPublisher.makeSlug(draft.wp_title),
      status: 'publish',
      categories: [categoryId],
      tags: tagIds,
      featured_media: featuredMediaId,
    });
  } catch (err: any) {
    const msg = err.response?.data?.message || err.message;
    logger.error('publisher', 'WP yayın hatası', { error: msg });
    await getDb()
      .from('generated_content')
      .update({ publish_error: msg })
      .eq('id', contentRow.id);
    await getDb().from('raw_articles').update({ status: 'evaluated' }).eq('id', article.id);
    return { success: false, error: msg };
  }

  // 5. DB güncelle
  await getDb()
    .from('generated_content')
    .update({
      wp_post_id: wpPost.id,
      wp_post_url: wpPost.link,
      wp_slug: wpPost.slug,
      published_at: new Date().toISOString(),
    })
    .eq('id', contentRow.id);

  await getDb()
    .from('raw_articles')
    .update({ status: 'used', used_at: new Date().toISOString() })
    .eq('id', article.id);

  logger.info('publisher', `✅ Yayınlandı: ${wpPost.link}`, {
    image_source: imageSource,
    category: draft.wp_category,
    tags: draft.wp_tags.length,
  });

  return {
    success: true,
    generatedContentId: contentRow.id,
    wpPostId: wpPost.id,
    wpPostUrl: wpPost.link,
  };
}

/**
 * N tane haberi sırayla yayınlar.
 */
export async function publishMany(count: number): Promise<PublishResult[]> {
  const results: PublishResult[] = [];
  for (let i = 0; i < count; i++) {
    const result = await publishOne();
    results.push(result);
    if (!result.success) {
      logger.warn('publisher', `${i + 1}. yayın başarısız, devam ediliyor`);
    }
    if (i < count - 1) {
      // Aralarda 30-90 saniye rastgele bekle
      const delay = 30000 + Math.floor(Math.random() * 60000);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return results;
}
