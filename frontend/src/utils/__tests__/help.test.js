import { describe, test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { HELP_SECTIONS } from '../../help';
import { NAV } from '../roles';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// The user guide is kept with the screens: every page in the top bar has its
// section, and every page's Help link points at one that exists.
const leaves = NAV.flatMap((n) => (n.children ? n.children : [n]));

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : sourceFiles(p);
    return /\.jsx?$/.test(e.name) ? [p] : [];
  });
}

describe('Help & FAQ', () => {
  test('every page in the top bar has a help section', () => {
    const covered = new Set(HELP_SECTIONS.map((s) => s.path).filter(Boolean));
    for (const leaf of leaves) {
      if (leaf.path === '/help') continue;
      expect({ page: leaf.path, covered: covered.has(leaf.path) }).toEqual({ page: leaf.path, covered: true });
    }
  });

  test('each section says who can do it, explains itself, and has steps or answers', () => {
    const ids = HELP_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of HELP_SECTIONS) {
      expect(s.title).toBeTruthy();
      expect(s.who).toBeTruthy();
      expect(s.summary).toBeTruthy();
      expect(s.flows.length + s.faq.length).toBeGreaterThan(0);
      for (const f of s.flows) expect(f.steps.length).toBeGreaterThan(0);
    }
  });

  test("every page's Help link points at a section that exists", () => {
    const ids = new Set(HELP_SECTIONS.map((s) => s.id));
    const used = sourceFiles(path.resolve(HERE, '../..'))
      .flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(/<HelpLink section="([^"]+)"/g)].map((m) => m[1]));
    expect(used.length).toBeGreaterThanOrEqual(8);
    for (const id of used) expect(ids.has(id)).toBe(true);
  });
});
