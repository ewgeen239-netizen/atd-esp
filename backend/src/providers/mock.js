import fs from 'node:fs';
import path from 'node:path';
import { BACKEND_DIR } from '../config.js';
import { gtinVariants, normalizeArticle } from '../lib/ean.js';

/**
 * Demo provider for development and UI testing. All demo EANs use the 200–299
 * "restricted circulation" GS1 prefix, so they never collide with real products,
 * and every item is clearly marked as DEMO in the UI.
 */
export class MockProvider {
  constructor(file = path.join(BACKEND_DIR, 'data', 'mock-products.json')) {
    this.name = 'mock';
    this.items = JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  async lookup(code) {
    const eans = code.type === 'ean' ? gtinVariants(code.value) : [];
    const art = normalizeArticle(code.type === 'ean' ? code.value : code.normalized);
    const hit = this.items.find(
      (p) =>
        (p.ean && eans.includes(p.ean)) ||
        normalizeArticle(p.article_no) === art ||
        (p.oem_numbers || []).some((o) => normalizeArticle(o) === art),
    );
    return hit ? { ...hit, source: 'mock', match: 'exact' } : null;
  }
}
