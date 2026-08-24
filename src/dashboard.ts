/**
 * The dashboard page (SPEC.md feature 8).
 *
 * `src/dashboard.html` is the whole thing: one hand-written file, inline CSS
 * and inline JS, no framework and no build step. This module reads it once and
 * hands it to `src/routes/root.ts`.
 *
 * Self-containment is load-bearing, not stylistic: the dashboard of a
 * no-egress gateway must itself make zero external requests. `GET /` is served
 * without auth, so the page asks the operator for the bearer token and sends
 * it on its own same-origin polls. {@link findExternalReferences} is the
 * machine-checkable form of that promise — the egress test suite runs it over
 * the page and requires an empty result.
 */
import { readFileSync } from 'node:fs';

/** Where the page lives, resolved next to this module. */
const HTML_URL = new URL('./dashboard.html', import.meta.url);

let cached: string | null = null;

/** The dashboard page. Read once, then served from memory. */
export function dashboardHtml(): string {
  if (cached === null) cached = readFileSync(HTML_URL, 'utf8');
  return cached;
}

/**
 * Every way a page could reach off-origin, as one scan. Each rule returns the
 * offending snippet so a failing test names what to remove.
 */
const RULES: Array<{ kind: string; pattern: RegExp }> = [
  // Any absolute URL: a CDN, a font host, an analytics beacon, a websocket.
  { kind: 'absolute url', pattern: /\b(?:https?|wss?|ftp):\/\/[^\s"'`)<>]*/g },
  // Protocol-relative reference in an attribute — `src="//cdn…"`.
  { kind: 'protocol-relative url', pattern: /\b(?:src|href|action|poster|data)\s*=\s*["']\/\/[^"']*/gi },
  // A stylesheet pulled in at parse time.
  { kind: 'css @import', pattern: /@import[^;]*/g },
  // A CSS asset reference that is not an inline data: URI.
  { kind: 'css url()', pattern: /(?<![A-Za-z0-9_-])url\(\s*(?!["']?data:)[^)]*\)/gi },
  // An external script or link target — the page must carry its own code.
  { kind: 'external script', pattern: /<script\b[^>]*\bsrc\s*=\s*["'](?!data:)[^"']*["'][^>]*>/gi },
  { kind: 'external link', pattern: /<link\b[^>]*\bhref\s*=\s*["'](?!data:)[^"']*["'][^>]*>/gi },
  // A frame or image is a request too, unless it is inline.
  { kind: 'external frame', pattern: /<iframe\b[^>]*\bsrc\s*=\s*["'](?!data:)[^"']*["'][^>]*>/gi },
  { kind: 'external image', pattern: /<img\b[^>]*\bsrc\s*=\s*["'](?!data:)[^"']*["'][^>]*>/gi },
];

/**
 * Scan a page for anything that would make the browser talk to another
 * origin. An empty array means the page is self-contained.
 *
 * Each entry reads `<kind>: <snippet>`, trimmed to stay readable in a test
 * failure. Same-origin relative paths (`/healthz`, `/attest`) are not
 * external and never appear here.
 */
export function findExternalReferences(html: string): string[] {
  const found: string[] = [];
  for (const rule of RULES) {
    const matches = html.match(rule.pattern);
    if (!matches) continue;
    for (const match of matches) {
      const snippet = match.replace(/\s+/g, ' ').trim();
      found.push(`${rule.kind}: ${snippet.length > 120 ? `${snippet.slice(0, 117)}...` : snippet}`);
    }
  }
  return found;
}
