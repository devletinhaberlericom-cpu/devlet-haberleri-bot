import { getDb } from '../db/client.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogCategory = 'scraper' | 'ai' | 'content' | 'publisher' | 'bot' | 'cron' | 'system';

const COLORS = {
  debug: '\x1b[90m',  // gri
  info: '\x1b[36m',   // cyan
  warn: '\x1b[33m',   // sarı
  error: '\x1b[31m',  // kırmızı
  reset: '\x1b[0m',
};

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getMinLevel(): number {
  const level = (process.env.LOG_LEVEL || 'info') as LogLevel;
  return LEVEL_PRIORITY[level] ?? 1;
}

async function log(
  level: LogLevel,
  category: LogCategory,
  message: string,
  details?: Record<string, any>
) {
  const minLevel = getMinLevel();
  if (LEVEL_PRIORITY[level] < minLevel) return;

  const ts = new Date().toISOString().substring(11, 19);
  const color = COLORS[level];
  const tag = `[${category}]`.padEnd(12);
  console.log(`${color}${ts} ${level.toUpperCase().padEnd(5)} ${tag}${COLORS.reset} ${message}`);
  if (details) console.log(details);

  // DB'ye sadece warn/error yaz (gürültüyü azalt)
  if (level === 'warn' || level === 'error') {
    try {
      await getDb().from('system_logs').insert({
        level,
        category,
        message,
        details: details || null,
      });
    } catch {
      // DB log hatası kendi başına bir sorun çıkarmasın
    }
  }
}

export const logger = {
  debug: (cat: LogCategory, msg: string, details?: Record<string, any>) =>
    log('debug', cat, msg, details),
  info: (cat: LogCategory, msg: string, details?: Record<string, any>) =>
    log('info', cat, msg, details),
  warn: (cat: LogCategory, msg: string, details?: Record<string, any>) =>
    log('warn', cat, msg, details),
  error: (cat: LogCategory, msg: string, details?: Record<string, any>) =>
    log('error', cat, msg, details),
};
