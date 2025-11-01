// src/discover.js
// Refactored to use ollama-handler for all Ollama interactions.
// Behavior and pipeline remain same as original.

const se_scraper = require('se-scraper');
const { fetchHtml } = require('./fetcher');
const utils = require('./utils');
const configs = require('./configs');
const { URL } = require('url');

const { runOllamaModel, extractJsonFromOutput } = require('./ollama-handler');

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
  return `
  You are an expert in Carnatic music and structured text extraction.
  TASK: From the section titled 'INPUT_DATA' below, extract ALL available details on ALL the songs or compositions (hereinafter known as scItems) set in any of these Carnatic or Hindustani ragas: ${ragamVariants.join(',')}.

  GENERAL RULES FOR PARSING INPUT_DATA:
  - The scItem may appear in paragraphs, bullet lists, table rows, or under headings that imply the raga, even if not repeated.
  - Preserve spellings exactly as found.
  - Do NOT invent composers/performers/links. If missing, use null.
  - Try to extract maximum scItems as possible, even if uncertain. Set the value of the 'confidence' field accordingly for those scItems.
  - If confidence is low or you are unsure or time is not sufficient, just list the scItem titles, composer/album if available, and confidence. NO scItem SHOULD BE MISSED AT ANY COST. Use the 'notes' field to explain ambiguity briefly if needed.

  ADDITIONAL RULES FOR YOUTUBE PLAYLISTS:
  - If the input HTML resembles a YouTube playlist page, extract all the title and YouTube video URL for each listed video.
  - If uploader/channel name is available on the page, place it in performer; otherwise leave performer null.
  - Do not follow external redirects or fetch external pages. Only use the provided HTML text.

  OUTPUT FORMAT:
  -  Return EXACTLY one JSON array. Each element must be an object with these fields:
    {
      "title":"string (mandatory)",
      "ragam_canonical":"${ragamVariants[0]}",
      "ragam_identified":"string (variant exactly as in text) or null",
      "composer":"string or null",
      "lyricist":"string or null",
      "source":"string or null (page title or URL if present)",
      "performer":"string or null",
      "context_snippet":"string or null (<=200 chars)",
      "song_links":["array of YouTube watch URLs, may be empty"],
      "confidence":number between 0.0 and 1.0,
      "notes":"short string or null (explain ambiguity briefly)"
    }

  CONFIDENCE GUIDANCE:
  - 0.9-1.0 when scItem is explicitly described as "set in <raga>" or appears under a clear section heading.
  - 0.7-0.9 when there is strong contextual evidence (composer + work type + matching playlist/video title).
  - 0.4-0.7 when inference is needed (list item under a heading, or ambiguous formatting).
  - <0.4 when guessing.

  RULES:
  - Always include numeric 'confidence'.
  - If unsure about a title mapping, include it with low confidence and a short 'notes' reason.
  - Preserve Unicode and punctuation.
  - Return NOTHING else besides the JSON array.

  INPUT_DATA:
  ${html}`.trim();
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
            combined.add(u);
          } catch (e) { /* ignore invalid URLs */ }
        }
        console.info(`  < - ${engine} done for query`);
      } catch (e) {
        console.warn(`  x ${engine} failed for query: `, e && e.message ? e.message : e);
      }
    })());
    await Promise.allSettled(enginePromises);
  }

  return { variants: variants, results: combined};
}

async function parseURLs(combined, variants) {
  const pageConcurrency = 2;
  const pageSem = new Semaphore(pageConcurrency);

  const PRIMARY_CONF_THRESHOLD = 0.80;
  const VERIFIER_CONF_THRESHOLD = 0.65;
  const MAX_ITEMS_PER_VERIFY = 12;

  const seenTitles = new Set();

  const pageTasks = Array.from(combined).map((originalUrl) => (async () => {
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

      if (typeof html !== 'string' || html.length < 200) return;
      console.info('-> prompting for URL ' + final);
      prompt = buildPromptForFullHtml(utils.cleanVisibleBody(html), variants);
      
      let primaryOut;
      try {
        primaryOut = await runOllamaModel(configs.MODELS.primary, prompt);
      } catch (e) {
        console.warn('primary ollama call failed:', e && e.message ? e.message : e);
        return;
      }

      const primaryParsed = extractJsonFromOutput(primaryOut);
      if (!primaryParsed || !Array.isArray(primaryParsed)) return;

      const accepted = [];
      const ambiguous = [];
      for (const item of primaryParsed) {
        if (!item || !item.title) continue;
        const normTitle = String(item.title).trim().toLowerCase();
        if (seenTitles.has(normTitle)) continue;
        const conf = (typeof item.confidence === 'number') ? item.confidence : null;
        if (conf !== null && conf >= PRIMARY_CONF_THRESHOLD) {
          accepted.push(item);
          seenTitles.add(normTitle);
        } else {
          if (conf === null) {
            if (!isAmbiguousItem(item)) {
              item.confidence = 0.75;
              accepted.push(item);
              seenTitles.add(normTitle);
            } else {
              ambiguous.push(item);
            }
          } else {
            ambiguous.push(item);
          }
        }
      }

      for (const it of accepted) {
        results.push({
          title: String(it.title).trim(),
          composer: it.composer || null,
          confidence: (typeof it.confidence === 'number' ? it.confidence : null),
          notes: it.notes || null,
          youtube_link: (Array.isArray(it.song_links) && it.song_links.length) ? it.song_links[0] : null,
          source_url: final
        });
      }

      if (ambiguous.length > 0) {
        const chunks = [];
        for (let i = 0; i < ambiguous.length; i += MAX_ITEMS_PER_VERIFY) chunks.push(ambiguous.slice(i, i + MAX_ITEMS_PER_VERIFY));

        for (const chunk of chunks) {
          const recheckPrompt = (() => {
            const intro = `You are an expert verifier. The following candidate song/composition entries were extracted from a webpage and marked ambiguous. For each entry, re-evaluate whether it is set in one of: ${variants.join(', ')}. Provide the same JSON structure and supply an updated numeric confidence (0..1). If you can raise confidence, update fields; do NOT fabricate missing facts. Return ONLY a JSON array.`;
            const candidates = chunk.map((c, idx) => {
              return `ENTRY ${idx + 1}:\ntitle: ${c.title}\nidentified_ragam: ${c.ragam_identified || 'null'}\ncomposer: ${c.composer || 'null'}\ncontext_snippet: ${c.context_snippet || 'null'}\n`;
            }).join('\n\n');
            const body = utils.cleanVisibleBody(html).slice(0, 12000);
            return `${intro}\n\n${candidates}\n\nPAGE_TEXT:\n${body}`;
          })();

          let verifierOut = null;
          try {
            verifierOut = await runOllamaModel(configs.MODELS.verifier, recheckPrompt);
          } catch (e) {
            console.warn('verifier call failed:', e && e.message ? e.message : e);
          }

          let verifierParsed = extractJsonFromOutput(verifierOut) || [];

          const toEscalate = [];
          for (let i = 0; i < chunk.length; i++) {
            const orig = chunk[i];
            const vp = verifierParsed[i] || null;
            let finalItem = null;
            if (vp && vp.title && typeof vp.confidence === 'number' && vp.confidence >= VERIFIER_CONF_THRESHOLD) {
              finalItem = vp;
            } else {
              toEscalate.push(orig);
            }
            if (finalItem) {
              const normTitle = String(finalItem.title).trim().toLowerCase();
              if (!seenTitles.has(normTitle)) {
                seenTitles.add(normTitle);
                results.push({
                  title: String(finalItem.title).trim(),
                  composer: finalItem.composer || null,
                  confidence: (typeof finalItem.confidence === 'number' ? finalItem.confidence : null),
                  notes: finalItem.notes || null,
                  youtube_link: (Array.isArray(finalItem.song_links) && finalItem.song_links.length) ? finalItem.song_links[0] : null,
                  source_url: final
                });
              }
            }
          }

          if (toEscalate.length > 0) {
            const escPrompt = (() => {
              const intro = `You are a high-recall music-domain extractor. Re-evaluate these candidate song/composition entries with the full page context. Output the same JSON objects with confidence numbers. Only return a JSON array.`;
              const candidates = toEscalate.map((c, idx) => `ENTRY ${idx + 1}:\ntitle: ${c.title}\ncontext_snippet: ${c.context_snippet || 'null'}\ncomposer: ${c.composer || 'null'}`).join('\n\n');
              const body = utils.cleanVisibleBody(html).slice(0, 20000);
              return `${intro}\n\n${candidates}\n\nPAGE_TEXT:\n${body}`;
            })();

            let fallbackParsed = null;
            try {
              const out1 = await runOllamaModel(configs.MODELS.fallback1, escPrompt, 900000);
              fallbackParsed = extractJsonFromOutput(out1) || [];
            } catch (e) {
              console.warn('fallback1 call failed:', e && e.message ? e.message : e);
            }

            if ((!fallbackParsed || fallbackParsed.length === 0 || fallbackParsed.every(x => !x || typeof x.confidence !== 'number' || x.confidence < VERIFIER_CONF_THRESHOLD))) {
              try {
                const out2 = await runOllamaModel(configs.MODELS.fallback2, escPrompt, 900000);
                const p2 = extractJsonFromOutput(out2) || [];
                if (p2 && p2.length) fallbackParsed = p2;
              } catch (e) {
                console.warn('fallback2 call failed:', e && e.message ? e.message : e);
              }
            }

            if (fallbackParsed && fallbackParsed.length) {
              for (const fitem of fallbackParsed) {
                if (!fitem || !fitem.title) continue;
                const normTitle = String(fitem.title).trim().toLowerCase();
                if (seenTitles.has(normTitle)) continue;
                seenTitles.add(normTitle);
                results.push({
                  title: String(fitem.title).trim(),
                  composer: fitem.composer || null,
                  confidence: (typeof fitem.confidence === 'number' ? fitem.confidence : null),
                  notes: fitem.notes || null,
                  youtube_link: (Array.isArray(fitem.song_links) && fitem.song_links.length) ? fitem.song_links[0] : null,
                  source_url: final
                });
              }
            } else {
              for (const o of toEscalate) {
                const normTitle = String(o.title).trim().toLowerCase();
                if (seenTitles.has(normTitle)) continue;
                seenTitles.add(normTitle);
                results.push({
                  title: String(o.title).trim(),
                  composer: o.composer || null,
                  confidence: o.confidence || 0.35,
                  notes: 'Left ambiguous after verifier/fallbacks',
                  youtube_link: (Array.isArray(o.song_links) && o.song_links.length) ? o.song_links[0] : null,
                  source_url: final
                });
              }
            }
          }
        }
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

module.exports = { discoverURLs, parseURLs };
