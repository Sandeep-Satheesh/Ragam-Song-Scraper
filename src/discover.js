// src/discover.js
// Final discover.js — per-query parallel engines, no Google, full-HTML -> Ollama extraction,
// ragam variant generation, redirect-unwrapping, and automatic follow of search-engine stub pages.

const se_scraper = require('se-scraper');
const { fetchHtml } = require('./fetcher');
const utils = require('./utils');
const configs = require('./configs');
const { spawn } = require('child_process');
const { url } = require('inspector');

function vowelLengthVariants(name) {
  const base = utils.stripDiacriticsAndNoise(name).toLowerCase();
  const cleaned = base.replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const chars = cleaned.split('');
  const pos = [];
  for (let i = 0; i < chars.length; i++) if (configs.VOWELS.includes(chars[i])) pos.push(i);
  const variants = new Set();
  const m = pos.length;
  if (m === 0) {
    variants.add(cleaned);
    variants.add(cleaned.replace(/\s+/g, ''));
    variants.add(cleaned.replace(/\s+/g, '-'));
    return Array.from(variants);
  }
  for (let mask = 0; mask < (1 << m); ++mask) {
    const arr = chars.slice();
    for (let j = 0; j < m; ++j) {
      const idx = pos[j];
      if ((mask >> j) & 1) arr[idx] = arr[idx] + arr[idx];
    }
    const v = arr.join('').replace(/\s+/g, ' ').trim();
    variants.add(v);
    variants.add(v.replace(/\s+/g, ''));
    variants.add(v.replace(/\s+/g, '-'));
  }
  return Array.from(variants);
}

function orthographicSwaps(seed) {
  const rules = [
    [/th/g, 't'],
    [/ṭ/g, 't'],
    [/dh/g, 'd'],
    [/ḍ/g, 'd'],
    [/sh/g, 's'],
    [/ś/g, 's'],
    [/ṣ/g, 's'],
    [/gaula/g, 'gowla'],
    [/goula/g, 'gowla'],
    [/ou/g, 'au'],
    [/aa/g, 'a'],
    [/ii/g, 'i'],
    [/ee/g, 'i'],
    [/rr/g, 'r']
  ];
  const out = new Set([seed]);
  for (const [pat, rep] of rules) {
    if (pat.test(seed)) {
      out.add(seed.replace(pat, rep));
      out.add(seed.replace(pat, rep).replace(/\s+/g, ''));
    }
  }
  out.add(seed.replace(/\s+/g, ''));
  out.add(seed.replace(/\s+/g, '-'));
  return Array.from(out);
}

function genVariants(name) {
  return Array.of(name);
  const base = stripDiacriticsAndNoise(name).toLowerCase();
  const variants = new Set();
  for (const v of vowelLengthVariants(base)) variants.add(v);
  const temp = Array.from(variants);
  for (const t of temp) {
    for (const s of orthographicSwaps(t)) variants.add(s);
  }
  for (const v of Array.from(variants)) {
    variants.add(v.replace(/([aeiou])\1/g, '$1'));
    variants.add(v.replace(/[^a-z0-9]/g, ''));
  }
  const out = Array.from(variants).map(x => x.trim()).filter(x => x && x.length >= 2 && x.length <= 60 && /[a-z]/i.test(x));
  return Array.from(new Set(out));
}

// ----------------- helpers for se-scraper walking -----------------
function walkForUrls(obj, set) {
  if (!obj) return;
  if (typeof obj === 'string' && obj.startsWith('http')) { set.add(obj); return; }
  if (Array.isArray(obj)) return obj.forEach(o => walkForUrls(o, set));
  if (typeof obj === 'object') for (const k of Object.keys(obj)) walkForUrls(obj[k], set);
}

async function runScrapeWithOpts(scrape_job, opts) {
  return await se_scraper.scrape(opts, scrape_job);
}

// ----------------- Ollama & parsing helpers -----------------
function runOllamaModel(model, prompt, timeoutMs = 600000) {
  return new Promise((resolve, reject) => {
    const ollamaPath = process.env.OLLAMA_PATH || 'ollama';
    const proc = spawn(ollamaPath, ['run', model], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('OLLAMA timeout')); }, timeoutMs);
    proc.stdout.on('data', d => out += d.toString());
    proc.stderr.on('data', d => err += d.toString());
    proc.on('error', e => { clearTimeout(timer); reject(e); });
    proc.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 && !out) return reject(new Error('ollama exited ' + code + ' ' + err));
      resolve(out.trim());
    });
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

function extractJsonFromOutput(text) {
  if (!text) return null;
  const startArr = text.indexOf('[');
  const startObj = text.indexOf('{');
  const s = (startArr === -1 || (startObj !== -1 && startObj < startArr)) ? startObj : startArr;
  if (s === -1) return null;
  const candidate = text.slice(s);
  try { return JSON.parse(candidate); }
  catch {
    const last = Math.max(candidate.lastIndexOf(']'), candidate.lastIndexOf('}'));
    if (last !== -1) {
      try { return JSON.parse(candidate.slice(0, last + 1)); } catch { }
    }
    return null;
  }
}

function buildPromptForFullHtml(html, ragamVariants) {
  return `You must output only in ENGLISH. Output must be valid JSON — no text or explanations outside the JSON array.

TASK:
From the following CLEANED WEBPAGE TEXT, extract all SONGS or COMPOSITIONS that are explicitly or implicitly linked to the RAGAM (musical scale) given in RAGAM_LIST.

INPUT:
1. RAGAM_LIST = [${ragamVariants.join(',')}]   // spelling variants; first element is canonical
2. TEXT_CONTENT = ${html}

INSTRUCTIONS:
- The text is already cleaned; do NOT interpret HTML or tags.
- Search case-insensitively for any variant in RAGAM_LIST as whole words.
- When a ragam mention is found, extract every song or composition clearly connected to it, including nearby mentions in the same paragraph or adjacent sentences.
- Preserve all spellings, punctuation, and Unicode exactly as they appear.
- Use the first element of RAGAM_LIST as "ragam_canonical".
- Use the exact variant present in the text as "ragam_identified".
- Do NOT fabricate or infer any missing fields.
- If a field is missing, assign null.
- Treat duplicates (same "title" + same "ragam_canonical") as one entry; keep the first in text order.
- "context_snippet" = up to 200 characters of original text around the song mention.
- "song_links" = any URLs in the same paragraph or line as the song name.
- Return a single top-level JSON array only. No additional text or formatting.

OUTPUT SCHEMA:
[
  {
    "title": "string (mandatory)",
    "ragam_canonical": "string (first element of RAGAM_LIST)",
    "ragam_identified": "string (variant found in text)",
    "composer": "string or null",
    "lyricist": "string or null",
    "source": "string or null",
    "performer": "string or null",
    "context_snippet": "string or null (≤200 chars)",
    "song_links": ["array of YouTube URLs for a rendition of the song, or empty array"]
  }
]

Return ONLY the JSON array — no commentary, no explanation.`.trim();

}

// ----------------- stub detection/extraction helpers -----------------
// --- improved stub detection & extraction helpers ---

function looksLikeRedirectStubHtml(html) {
  if (!html || typeof html !== 'string') return false;
  const head = html.slice(0, 16000).toLowerCase();

  // common telltale signs: onload handler with timeout, short body with "click here", ck/a wrapper, px param handling
  if (/onload\s*=\s*["']\s*l\s*\(|settimeout\(\s*f\s*,\s*\d+\s*\)/i.test(head)) return true;
  if (/click here if the page does not redirect automatically|you are being redirected|if the page does not redirect/i.test(head)) return true;
  if (/window\.location\.href\.match\(|px=([^&]*)/i.test(head)) return true;
  if (/bing\.com\/ck\/a/i.test(head)) return true;
  if (/<meta[^>]*http-equiv=["']refresh["']/i.test(head)) return true;

  return false;
}

function tryBase64DecodeCandidate(s) {
  try {
    // Try URL-decode first
    let t = decodeURIComponent(s);
    // if t already looks like http, accept
    if (/^https?:\/\//i.test(t)) return t;

    // Normalize URL-safe base64
    let b = s.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
    // pad
    while (b.length % 4) b += '=';
    try {
      const dec = Buffer.from(b, 'base64').toString('utf8');
      if (/^https?:\/\//i.test(dec)) return dec;
    } catch (e) { /* ignore */ }

    // try decodeURIComponent of the base64-decoded string
    try {
      const dec2 = Buffer.from(b, 'base64').toString('utf8');
      const dec3 = decodeURIComponent(dec2);
      if (/^https?:\/\//i.test(dec3)) return dec3;
    } catch (e) { /* ignore */ }

    // fallback: return t if looks like http
    if (/^https?:\/\//i.test(t)) return t;
  } catch (e) { /* ignore */ }
  return null;
}

function extractStubTarget(html) {
  if (!html || typeof html !== 'string') return null;

  // 1) meta-refresh with URL
  const meta = html.match(/<meta[^>]*http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"'>]+)["']/i);
  if (meta) {
    try { return decodeURIComponent(meta[1].trim()); } catch (e) { return meta[1].trim(); }
  }

  // 2) common anchor "click here" href
  const clickAnchor = html.match(/<a[^>]*href=["']([^"']+)["'][^>]*>\s*(?:click here|click here to continue|click here if the page|continue|here)\b/i);
  if (clickAnchor) {
    let u = clickAnchor[1];
    // if this is a wrapper with u= param, fall through to param extraction below
    // otherwise return direct href
    if (!/[?&](?:u|url|RU)=/i.test(u)) {
      try { return decodeURIComponent(u); } catch (e) { return u; }
    }
  }

  // 3) find wrapper param u= or url= or RU= in the whole HTML (handles Bing/Yahoo wrappers)
  const paramMatch = html.match(/[?&](?:u|url|RU)=([^&"'>\s]+)/i);
  if (paramMatch) {
    const raw = paramMatch[1];
    // url-decode then try base64 decode if needed
    try {
      const decoded = decodeURIComponent(raw);
      if (/^https?:\/\//i.test(decoded)) return decoded;
    } catch (e) { /* ignore */ }

    const b64 = tryBase64DecodeCandidate(raw);
    if (b64) return b64;

    // sometimes the param is itself percent-encoded base64 or has prefixes — try cleaning
    const cleaned = raw.replace(/^a\d+/i, '').replace(/^[^A-Za-z0-9\-_]+/, '');
    const b64b = tryBase64DecodeCandidate(cleaned);
    if (b64b) return b64b;

    // fallback: return raw percent-decoded even if not fully decoded
    try { return decodeURIComponent(raw); } catch (e) { return raw; }
  }

  // 4) fallback: pick the first external http(s) anchor that is not the current domain and long enough
  const hrefMatch = html.match(/<a[^>]*href=["'](https?:\/\/[^"']{20,})["'][^>]*>/i);
  if (hrefMatch) return hrefMatch[1];

  return null;
}


// ----------------- Main entry: discoverAndExtract (per-query parallel engines) -----------------
async function discoverAndExtract(ragam, numPages = 2, model = 'gemma3:4b', opts = {}) {
  const pageConcurrency = opts.pageConcurrency || 2;
  class Semaphore { constructor(max) { this.max = max; this.current = 0; this.queue = []; } async acquire() { if (this.current < this.max) { this.current++; return; } await new Promise(res => this.queue.push(res)); this.current++; } release() { this.current = Math.max(0, this.current - 1); if (this.queue.length) { const n = this.queue.shift(); n(); } } }
  const pageSem = new Semaphore(pageConcurrency);

  // 1) build queries (variants-first)
  const variants = genVariants(ragam);
  const queries = [];
  for (const v of variants) {
    queries.push(`${ v } raga songs`);
    queries.push(`${ v } raga film songs`);
    queries.push(`${ v } raga song kriti`);
    queries.push(`carnatic film songs in ${ v } raga`);
    if (queries.length > 60) break;
  }

  const combined = new Map(); // norm -> originalUrl

  // For each query: fire to ALL engines in parallel, wait for completion, then continue
  for (const q of queries) {
    console.info('query:', q);
    const enginePromises = Object.entries(configs.ENGINE_CONFIGS).map(([engine, cfg]) => (async () => {
      try {
        const scrape_job = { search_engine: engine, keywords: [q], num_pages: numPages };
        console.info(`  -> ${ engine } `);
        const raw = await runScrapeWithOpts(scrape_job, cfg);
        const uset = new Set();
        walkForUrls(raw, uset);
        for (const rawUrl of uset) {
          const u = utils.cleanRedirectUrl(rawUrl);
          if (!u || /accounts\.google\.com|consent\.google\.com|consent\.youtube\.com/i.test(u)) continue;
          try {
            const nu = new URL(u);
            const norm = nu.origin + nu.pathname.replace(/\/+$/, '');
            if (!combined.has(norm)) combined.set(norm, u);
          } catch (e) { /* ignore invalid URLs */ }
        }
        console.info(`  < - ${ engine } done for query`);
      } catch (e) {
        console.warn(`  x ${ engine } failed for query: `, e && e.message ? e.message : e);
      }
    })());
    // wait for all engines for this query before moving to next query
    await Promise.allSettled(enginePromises);
  }

  // 2) fetch pages and extract (bounded concurrency)
  const results = [];
  const seenTitles = new Set();

  const pageTasks = Array.from(combined.entries()).map(([norm, originalUrl]) => (async () => {
    await pageSem.acquire();
    try {
      console.info('fetching', originalUrl);
      let resp = await fetchHtml(originalUrl)
                      .catch(e => {
                        console.warn('fetch fail', e && e.message ? e.message : e);
                        return null;
                      });

      if (!resp || !resp.html) return;

      let { html, finalUrl } = resp;
      let final = finalUrl || originalUrl;
      
      if (/youtube\.com|youtu\.be/i.test(url)) return;  // skip YouTube completely

      // If the page looks like a search-engine stub, try to extract real target and re-fetch
      if (looksLikeRedirectStubHtml(html)) {
        const target = extractStubTarget(html);
        if (/youtube\.com|youtu\.be/i.test(target)) return;  // skip YouTube completely
        if (target) {
          try {
            console.info('  following stub ->', target);
            const resolved = await fetchHtml(target).catch(e => { console.warn('follow failed', e && e.message ? e.message : e); return null; });
            
            if (resolved && resolved.html) {
              html = resolved.html;
              final = resolved.finalUrl || target;
            } else {
              console.warn('  could not resolve stub target, skipping:', target);
              return;
            }
          } catch (e) {
            console.warn('  error following stub:', e && e.message ? e.message : e);
            return;
          }
        } else {
          console.warn('  stub page with no extractable target, skipping:', originalUrl);
          return;
        }
      }

      // skip tiny pages
      if (typeof html !== 'string' || html.length < 200) return;

      // build prompt and call Ollama
      const prompt = buildPromptForFullHtml(utils.cleanVisibleBody(html), variants);
      let out;
      try {
        out = await runOllamaModel(model, prompt);
      } catch (e) {
        console.warn('ollama call failed:', e && e.message ? e.message : e);
        return;
      }

      const parsed = extractJsonFromOutput(out);
      if (!parsed || !Array.isArray(parsed)) return;

      for (const item of parsed) {
        if (!item || !item.title) continue;
        const normTitle = item.title.trim().toLowerCase();
        if (seenTitles.has(normTitle)) continue;
        seenTitles.add(normTitle);
        results.push({
          title: String(item.title).trim(),
          composer: item.composer || null,
          confidence: (typeof item.confidence === 'number' ? item.confidence : null),
          notes: item.notes || null,
          youtube_link: item.youtube_link || null,
          source_url: final
        });
      }

    } catch (e) {
      console.warn('processing fail for', originalUrl, e && e.message ? e.message : e);
    } finally {
      pageSem.release();
    }
  })());

  await Promise.allSettled(pageTasks);

  return results;
}

module.exports = { discoverAndExtract };
