const se_scraper = require('se-scraper');
const { fetchHtml } = require('./fetcher');
const utils = require('./utils');
const configs = require('./configs');
const db = require('./db');
const { URL } = require('url');
const fs = require('fs');

const { runOllamaModel } = require('./ollama-handler');

class Semaphore {
  constructor(max) { this.max = max; this.current = 0; this.queue = []; }
  async acquire() { if (this.current < this.max) { this.current++; return; } await new Promise(res => this.queue.push(res)); this.current++; }
  release() { this.current = Math.max(0, this.current - 1); if (this.queue.length) { const n = this.queue.shift(); n(); } }
}

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
  };
}

// ----------------- Main entry: discoverURLs -----------------
async function discoverURLs(ragam, numPages = 2) {
  const variants = utils.genVariants(ragam);
  const queries = [];
  for (const v of variants) {
    queries.push(`${v} raga wikipedia`);
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
        const raw = await se_scraper.scrape(opts, scrape_job);
        const uset = new Set();
        utils.walkForUrls(raw, uset);
        for (const rawUrl of uset) {
          const u = utils.cleanRedirectUrl(rawUrl);
          if (!u || /accounts\.google\.com|consent\.google\.com|consent\.youtube\.com/i.test(u)) continue;
          try {
            let _ = new URL(u);
            if (!_.pathname || _.pathname === '/') continue;
            combined.add(_.href);
          } catch (e) {}
        }
        console.info(`  < - ${engine} done for query`);
      } catch (e) {
        console.warn(`  x ${engine} failed for query: `, e && e.message ? e.message : e);
      }
    })());
    await Promise.allSettled(enginePromises);
  }

  return { variants: variants, results: Array.from(combined) };
}

// ----------------- parseURLs (single array return; confidence, model_name, inference_id set) -----------------
async function parseURLs(combined, variants) {
  const pageConcurrency = 1;
  const pageSem = new Semaphore(pageConcurrency);

  let inferenceCounter = 0;
  const seenTitles = new Set();
  const results = [];

  await Promise.allSettled(Array.from(combined).map(async (originalUrl) => {
    await pageSem.acquire();
    try {
      console.info('fetching', originalUrl);
      let resp = await fetchHtml(originalUrl).catch(e => { console.warn('fetch fail', e && e.message ? e.message : e); return null; });
      const isBinary = /(\.pdf|\.docx?|\.pptx?|\.xls[xm]?|\.zip|\.rar)$/i.test(originalUrl) ||
                (resp && resp.headers && /application\/(pdf|msword|vnd|octet)/i.test(resp.headers['Content-Type']||''));
      if (isBinary) { console.info('  binary document, skipping:', originalUrl); return; }
      if (!resp || !resp.html) return;

      let { html, finalUrl } = resp;
      let final = finalUrl || originalUrl;

      if (utils.looksLikeRedirectStubHtml(html)) {
        const target = utils.extractStubTarget(html);
        if (target) {
          try {
            console.info('  following stub ->', target);
            const resolved = await fetchHtml(target).catch(e => { console.warn('follow failed', e && e.message ? e.message : e); return null; });
            if (resolved && resolved.html) { html = resolved.html; final = resolved.finalUrl || target; }
            else { console.warn('  could not resolve stub target, skipping:', target); return; }
            const isBinary2 = /(\.pdf|\.docx?|\.pptx?|\.xls[xm]?|\.zip|\.rar)$/i.test(final) ||
                 (resolved.headers && /application\/(pdf|msword|vnd|octet)/i.test(resolved.headers['Content-Type']||''));
            if (isBinary2) { console.info('  binary document, skipping:', final); return; }
          } catch (e) { console.warn('  error following stub:', e && e.message ? e.message : e); return; }
        } else { console.warn('  stub page with no extractable target, skipping:', originalUrl); return; }
      }

      if (typeof html !== 'string' || html.length < 200) return;

      console.info('-> prompting for URL ' + final);
      const prompt = buildPromptForFullHtml(utils.cleanVisibleBody(html), variants);

      // increment inference counter and capture id
      inferenceCounter += 1;
      const inferenceId = inferenceCounter;

      let primaryOut;
      try { primaryOut = await runOllamaModel(prompt); } catch (e) { console.warn('primary ollama call failed:', e && e.message ? e.message : e); return; }

      const primaryParsed = utils.extractJsonFromOutput(primaryOut && primaryOut.content ? primaryOut.content : primaryOut);
      if (!primaryParsed || !Array.isArray(primaryParsed)) return;

      const modelName = primaryOut && primaryOut.model_name ? primaryOut.model_name : null;

      for (const item of primaryParsed) {
        if (!item || !item.title) { console.warn('Invalid item in primary response:', item); continue; }
        const normTitle = String(item.title).trim().toLowerCase();
        if (seenTitles.has(normTitle)) continue;

        const rawConf = (typeof item.confidence === 'number') ? item.confidence : null;
        // derive default confidence if missing
        const confidence = (rawConf !== null) ? rawConf
          : ((item.ragam_identified || item.composer || item.source) ? 0.75 : 0.35);

        seenTitles.add(normTitle);
        results.push({
          title: String(item.title).trim(),
          composer: item.composer || null,
          confidence: confidence,
          notes: item.notes || null,
          song_links: item.song_links || null,
          source_url: final,
          model_name: modelName,
          inference_id: inferenceId
        });
      }

    } catch (e) {
      console.warn('processing fail for', originalUrl, e && e.message ? e.message : e);
    } finally {
      await utils.politeSleep();
      pageSem.release();
    }
  }));

  return results;
}

module.exports = { discoverURLs, parseURLs };