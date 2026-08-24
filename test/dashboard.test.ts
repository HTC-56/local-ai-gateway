/**
 * Tests for `src/dashboard.ts` — the page loader and the self-containment
 * scanner the egress suite leans on (TASK_PHASE_E.md, "Already built").
 */
import { describe, expect, it } from 'vitest';
import { dashboardHtml, findExternalReferences } from '../src/dashboard.ts';

describe('dashboardHtml', () => {
  it('serves one self-contained HTML document', () => {
    const html = dashboardHtml();
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('</html>');
    expect(html.length).toBeGreaterThan(1_000);
  });

  it('returns the same cached string on every call', () => {
    expect(dashboardHtml()).toBe(dashboardHtml());
  });

  it('carries its own CSS and JS inline, with no build step', () => {
    const html = dashboardHtml();
    expect(html).toContain('<style>');
    expect(html).toContain('<script>');
    expect(html).not.toMatch(/<script[^>]+src=/i);
  });

  it('polls the four gateway endpoints and nothing else', () => {
    const html = dashboardHtml();
    for (const path of ['/healthz', '/attest', '/metrics', '/events']) {
      expect(html).toContain(`api('${path}'`);
    }
  });

  it('is light-mode aware', () => {
    expect(dashboardHtml()).toContain('prefers-color-scheme: light');
  });
});

describe('findExternalReferences', () => {
  it('finds nothing in the shipped page', () => {
    expect(findExternalReferences(dashboardHtml())).toEqual([]);
  });

  it('flags an absolute URL anywhere in the page', () => {
    const found = findExternalReferences('<p>see https://cdn.example.com/x.js</p>');
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('absolute url');
  });

  it('flags a protocol-relative attribute', () => {
    expect(findExternalReferences('<script src="//cdn.example.com/x.js"></script>').join(' ')).toContain(
      'protocol-relative url',
    );
  });

  it('flags a web font, a stylesheet link and a remote image', () => {
    expect(findExternalReferences('@import "fonts.css";').join(' ')).toContain('css @import');
    expect(findExternalReferences('<link rel="stylesheet" href="app.css">').join(' ')).toContain(
      'external link',
    );
    expect(findExternalReferences('<img src="hero.png">').join(' ')).toContain('external image');
  });

  it('accepts data: URIs and same-origin relative paths', () => {
    expect(findExternalReferences('<link rel="icon" href="data:,">')).toEqual([]);
    expect(findExternalReferences("fetch('/healthz'); fetch('/attest');")).toEqual([]);
    expect(findExternalReferences('.a { background: url("data:image/svg+xml,x") }')).toEqual([]);
  });

  it('does not mistake an identifier ending in url( for a CSS asset', () => {
    expect(findExternalReferences('const x = parseUrl(input);')).toEqual([]);
  });
});
