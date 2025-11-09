// src/discover.js
// Refactored to use ollama-handler for all Ollama interactions.
// Behavior and pipeline remain same as original except ambiguous verification removed.

const se_scraper = require('se-scraper');
const { fetchHtml } = require('./fetcher');
const utils = require('./utils');
const configs = require('./configs');
const { URL } = require('url');
const fs = require('fs');

const { runOllamaModel } = require('./ollama-handler');

class Semaphore { constructor(max) { this.max = max; this.current = 0; this.queue = []; } async acquire() { if (this.current < this.max) { this.current++; return; } await new Promise(res => this.queue.push(res)); this.current++; } release() { this.current = Math.max(0, this.current - 1); if (this.queue.length) { const n = this.queue.shift(); n(); } } }

// ----------------- existing helper functions (unchanged except small exports) -----------------
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
  const base = utils.stripDiacriticsAndNoise(name).toLowerCase();
  const variants = new Set([name, base, base.replace(/\s+/g, ''), base.replace(/\s+/g, '-')]);
  for (const v of vowelLengthVariants(base)) variants.add(v);
  for (const t of Array.from(variants)) for (const s of orthographicSwaps(t)) variants.add(s);
  return Array.from(new Set(Array.from(variants).map(x => x.trim()).filter(x => x)));
}

// ----------------- helpers for se-scraper walking (unchanged) -----------------
function walkForUrls(obj, set) {
  if (!obj) return;
  if (typeof obj === 'string' && obj.startsWith('http')) { set.add(obj); return; }
  if (Array.isArray(obj)) return obj.forEach(o => walkForUrls(o, set));
  if (typeof obj === 'object') for (const k of Object.keys(obj)) walkForUrls(obj[k], set);
}

async function runScrapeWithOpts(scrape_job, opts) {
  return await se_scraper.scrape(opts, scrape_job);
}

// ----------------- Prompt builder (updated to request confidences + explicit reasoning) -----------------
function buildPromptForFullHtml(html, ragamVariants) {  
  const templatePath = 'prompts/html-scraper/system.txt';
  const templateString = fs.readFileSync(templatePath, 'utf8');

  let formattedString = templateString;
  formattedString = formattedString.replaceAll(new RegExp(`\\$\\{ragamVariants\\}`, 'g'), ragamVariants);

  return {
    system: formattedString,
    user: `TASK: Extract all scItems defined above from the HTML below.

### START_INPUT_DATA
${html}
### END_INPUT_DATA`
  }
}

// ----------------- stub detection/extraction helpers (unchanged) -----------------
function looksLikeRedirectStubHtml(html) {
  if (!html || typeof html !== 'string') return false;
  const head = html.slice(0, 16000).toLowerCase();
  if (/onload\s*=\s*["']\s*l\s*\(|settimeout\(\s*f\s*,\s*\d+\s*\)/i.test(head)) return true;
  if (/click here if the page does not redirect automatically|you are being redirected|if the page does not redirect/i.test(head)) return true;
  if (/window\.location\.href\.match\(|px=([^&]*)/i.test(head)) return true;
  if (/bing\.com\/ck\/a/i.test(head)) return true;
  if (/<meta[^>]*http-equiv=["']refresh["']/i.test(head)) return true;
  return false;
}

function tryBase64DecodeCandidate(s) {
  try {
    let t = decodeURIComponent(s);
    if (/^https?:\/\//i.test(t)) return t;
    let b = s.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
    while (b.length % 4) b += '=';
    try {
      const dec = Buffer.from(b, 'base64').toString('utf8');
      if (/^https?:\/\//i.test(dec)) return dec;
    } catch (e) { /* ignore */ }
    try {
      const dec2 = Buffer.from(b, 'base64').toString('utf8');
      const dec3 = decodeURIComponent(dec2);
      if (/^https?:\/\//i.test(dec3)) return dec3;
    } catch (e) { /* ignore */ }
    if (/^https?:\/\//i.test(t)) return t;
  } catch (e) { /* ignore */ }
  return null;
}

function extractStubTarget(html) {
  if (!html || typeof html !== 'string') return null;
  const meta = html.match(/<meta[^>]*http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"'>]+)["']/i);
  if (meta) {
    try { return decodeURIComponent(meta[1].trim()); } catch (e) { return meta[1].trim(); }
  }
  const clickAnchor = html.match(/<a[^>]*href=["']([^"']+)["'][^>]*>\s*(?:click here|click here to continue|click here if the page|continue|here)\b/i);
  if (clickAnchor) {
    let u = clickAnchor[1];
    if (!/[?&](?:u|url|RU)=/i.test(u)) {
      try { return decodeURIComponent(u); } catch (e) { return u; }
    }
  }
  const paramMatch = html.match(/[?&](?:u|url|RU)=([^&"'>\s]+)/i);
  if (paramMatch) {
    const raw = paramMatch[1];
    try {
      const decoded = decodeURIComponent(raw);
      if (/^https?:\/\//i.test(decoded)) return decoded;
    } catch (e) { /* ignore */ }
    const b64 = tryBase64DecodeCandidate(raw);
    if (b64) return b64;
    const cleaned = raw.replace(/^a\d+/i, '').replace(/^[^A-Za-z0-9\-_]+/, '');
    const b64b = tryBase64DecodeCandidate(cleaned);
    if (b64b) return b64b;
    try { return decodeURIComponent(raw); } catch (e) { return raw; }
  }
  const hrefMatch = html.match(/<a[^>]*href=["'](https?:\/\/[^"']{20,})["'][^>]*>/i);
  if (hrefMatch) return hrefMatch[1];
  return null;
}

// ----------------- Confidence heuristics -----------------
function isAmbiguousItem(item) {
  if (!item) return true;
  if (typeof item.confidence === 'number') return item.confidence < 0.80;
  if (!item.ragam_identified && !item.composer && !item.source) return true;
  return false;
}

// ----------------- Main entry: discoverURLs (per-query parallel engines) -----------------
async function discoverURLs(ragam, numPages = 2) {

  const variants = genVariants(ragam);
  const queries = [];
  for (const v of variants) {
    queries.push(`${v} raga wikipedia`);
    queries.push(`${v} raga songs playlist youtube`);
    queries.push(`${v} raga songs playlist youtube`);
    queries.push(`${v} ragam compositions`);
    queries.push(`${v} raga film songs`);
    queries.push(`${v} raga song kriti`);
    queries.push(`carnatic film songs in ${v} raga`);
    if (queries.length > 60) break;
  }

  const combined = new Set();

  for (const q of queries) {
    console.info('query:', q);
    const enginePromises = Object.entries(configs.ENGINE_CONFIGS).map(([engine, cfg]) => (async () => {
      try {
        const scrape_job = { search_engine: engine, keywords: [q], num_pages: numPages };
        console.info(`  -> ${engine} `);
        const raw = await runScrapeWithOpts(scrape_job, cfg);
        const uset = new Set();

        walkForUrls(raw, uset);
        for (const rawUrl of uset) {
          const u = utils.cleanRedirectUrl(rawUrl);
          if (!u || /accounts\.google\.com|consent\.google\.com|consent\.youtube\.com/i.test(u)) continue;
          try {
            let _ = new URL(u);
            //if url does not include any paths, ignore
            if (!_.pathname || _.pathname === '/') continue;
            combined.add(_.href);
          } catch (e) { /* ignore invalid URLs */ }
        }
        console.info(`  < - ${engine} done for query`);
      } catch (e) {
        console.warn(`  x ${engine} failed for query: `, e && e.message ? e.message : e);
      }
    })());
    await Promise.allSettled(enginePromises);
  }

  return { variants: variants, results: Array.from(combined)};
}

async function parseURLs(combined, variants) {
  const pageConcurrency = 1;
  const pageSem = new Semaphore(pageConcurrency);

  const PRIMARY_CONF_THRESHOLD = 0.80;

  const seenTitles = new Set();
  const seenAmbiguous = new Set();

  const acceptedAll = [];
  const ambiguousAll = [];

  await Promise.allSettled(combined.map(async (originalUrl) => {
    await pageSem.acquire();
    try {
      console.info('fetching', originalUrl);
      let resp = await fetchHtml(originalUrl)
        .catch(e => {
          console.warn('fetch fail', e && e.message ? e.message : e);
          return null;
        });
      
      const isBinary = /(\.pdf|\.docx?|\.pptx?|\.xls[xm]?|\.zip|\.rar)$/i.test(originalUrl) ||
                (resp && resp.headers && /application\/(pdf|msword|vnd|octet)/i.test(resp.headers['Content-Type']||''));
      if (isBinary) {
        console.info('  binary document, skipping:', originalUrl);
        pageSem.release();
        return [];
      }
      if (!resp || !resp.html) {
        pageSem.release();
        return [];
      }

      let { html, finalUrl } = resp;
      let final = finalUrl || originalUrl;

      if (looksLikeRedirectStubHtml(html)) {
        const target = extractStubTarget(html);
        if (target) {
          try {
            console.info('  following stub ->', target);
            const resolved = await fetchHtml(target).catch(e => { console.warn('follow failed', e && e.message ? e.message : e); return null; });
            if (resolved && resolved.html) {
              html = resolved.html;
              final = resolved.finalUrl || target;
            } else {
              console.warn('  could not resolve stub target, skipping:', target);
              pageSem.release();
              return [];
            }
            const isBinary2 = /(\.pdf|\.docx?|\.pptx?|\.xls[xm]?|\.zip|\.rar)$/i.test(final) ||
                 (resolved.headers && /application\/(pdf|msword|vnd|octet)/i.test(resolved.headers['Content-Type']||''));
            if (isBinary2) {
              console.info('  binary document, skipping:', final);
              pageSem.release();
              return [];
            }
          } catch (e) {
            console.warn('  error following stub:', e && e.message ? e.message : e);
            pageSem.release();
            return [];
          }
        } else {
          console.warn('  stub page with no extractable target, skipping:', originalUrl);
          pageSem.release();
          return [];
        }
      }

      if (typeof html !== 'string' || html.length < 200) {
        pageSem.release();
        return [];
      }

      console.info('-> prompting for URL ' + final);
      const prompt = buildPromptForFullHtml(utils.cleanVisibleBody(html), variants);
      
      let primaryOut;
      try {
        primaryOut = await runOllamaModel(prompt);
      } catch (e) {
        console.warn('primary ollama call failed:', e && e.message ? e.message : e);
        pageSem.release();
        return [];
      }

      const primaryParsed = utils.extractJsonFromOutput(primaryOut && primaryOut.content ? primaryOut.content : primaryOut) ;
      if (!primaryParsed || !Array.isArray(primaryParsed)) {
        pageSem.release();
        return [];
      }

      for (const item of primaryParsed) {
        if (!item || !item.title) {
          console.warn('Invalid item in primary response:', item);
          continue;
        }
        const normTitle = String(item.title).trim().toLowerCase();
        const conf = (typeof item.confidence === 'number') ? item.confidence : null;

        if (conf !== null && conf >= PRIMARY_CONF_THRESHOLD) {
          if (!seenTitles.has(normTitle)) {
            seenTitles.add(normTitle);
            acceptedAll.push({
              title: String(item.title).trim(),
              composer: item.composer || null,
              confidence: conf,
              notes: item.notes || null,
              song_links: item.song_links || null,
              source_url: final
            });
          }
        } else {
          // treat as ambiguous (including null confidence that fails isAmbiguousItem)
          if (!seenTitles.has(normTitle) && !seenAmbiguous.has(normTitle)) {
            seenAmbiguous.add(normTitle);
            ambiguousAll.push({
              title: String(item.title).trim(),
              composer: item.composer || null,
              confidence: (typeof item.confidence === 'number' ? item.confidence : null),
              notes: item.notes || null,
              song_links: item.song_links || null,
              source_url: final
            });
          }
        }
      }

    } catch (e) {
      console.warn('processing fail for', originalUrl, e && e.message ? e.message : e);
    } finally {
      await utils.politeSleep();
      pageSem.release();
    }
    return [];
  }));

  // Return collected accepted and ambiguous arrays
  return { accepted: acceptedAll, ambiguous: ambiguousAll };
}

module.exports = { discoverURLs, parseURLs };