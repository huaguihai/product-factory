import crypto from 'crypto';

/**
 * Generate a content hash for deduplication
 */
export function contentHash(title: string, source: string): string {
  const normalized = `${title.toLowerCase().trim()}:${source}`;
  return crypto.createHash('md5').update(normalized).digest('hex');
}

/**
 * Sleep for ms milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get today's date as YYYY-MM-DD string
 */
export function today(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Create a URL-safe slug from a string
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 80);
}

/**
 * Days since a given date
 */
export function daysSince(date: Date | string): number {
  const d = typeof date === 'string' ? new Date(date) : date;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}
