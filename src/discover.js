// discover.js (refactored)
const se_scraper = require('se-scraper');
const { fetchHtml } = require('./fetcher');
const utils = require('./utils');
const configs = require('./configs');
const db = require('./db');
const { URL } = require('url');
const fs = require('fs');
const { runOllamaModel } = require('./ollama-handler');
const ytdl = require('ytdl-core');
const axios = require('axios');

// Resolve redirect by performing a single HEAD/GET without following redirects.
// Returns the resolved absolute URL if Location header present or the original/final URL.
async function resolveRedirectUrl(inputUrl, { method = 'get', timeout = 5000 } = {}) {
  try {
    // use GET because some endpoints return different headers on HEAD
    const res = await axios.request({
      url: inputUrl,
      method,
      timeout,
      maxRedirects: 10,
      validateStatus: status => status >= 200 && status < 400,
      headers: configs.EN_HEADERS
    });
    // 3xx -> Location header usually contains redirect target
    if (res.status >= 300 && res.headers && res.headers.location) {
      return new URL(res.headers.location, inputUrl).href;
    }
    
    if (utils.looksLikeRedirectStubHtml(res.data)) {
      return utils.extractStubTarget(res.data);
    }

    // axios might expose final URL on the request object in some cases
    if (res.request && res.request.res && res.request.res.responseUrl) {
      return res.request.res.responseUrl;
    }

    // otherwise return the input (no redirect)
    return inputUrl;
  } catch (err) {
    // axios throws when 3xx and maxRedirects=0 on some versions; check err.response
    if (err && err.response && err.response.headers && err.response.headers.location) {
      try { return new URL(err.response.headers.location, inputUrl).href; } catch (e) { return err.response.headers.location; }
    }
    // on network errors just rethrow to let caller decide
    throw err;
  }
}

function buildPromptForFullHtml(html, ragam) {
  const templatePath = 'prompts/html-scraper/system.txt';
  const templateString = fs.readFileSync(templatePath, 'utf8');
  let formattedString = templateString;
  formattedString = formattedString.replaceAll(new RegExp(`\\$\\{ragam\\}`, 'g'), ragam);
  return {
    system: formattedString,
    user: `TASK: Extract all scItems defined above from the HTML below.

### START_INPUT_DATA

${html}

### END_INPUT_DATA`
  };
}

async function discoverURLs(ragam, numPages, unparsedUrlSet) {
  const queries = [];
  queries.push(`${ragam} raga carnatic`);
  queries.push(`${ragam} raga songs playlist youtube`);
  queries.push(`${ragam} ragam compositions`);
  queries.push(`${ragam} raga film songs`);
  queries.push(`${ragam} raga song kriti`);
  queries.push(`carnatic film songs in ${ragam} raga`);

  const results = [];

  for (const q of queries) {
    console.info('query:', q);
    const enginePromises = Object.entries(configs.ENGINE_CONFIGS).map(([engine, cfg]) => (async () => {
      try {
        const scrape_job = { search_engine: engine, keywords: [q], num_pages: numPages };
        const raw = await se_scraper.scrape(cfg, scrape_job);
        const uset = new Set();
        utils.walkForUrls(raw, uset);
        for (const rawUrl of uset) {
          // clean obvious redirect wrappers first
          const cleaned = utils.cleanRedirectUrl(rawUrl);
          if (!cleaned || /accounts\.google\.com|consent\.google\.com|consent\.youtube\.com/i.test(cleaned)) continue;

          try {
            // resolve single-step redirect if present
            let resolved;
            resolved = await resolveRedirectUrl(cleaned);

            const parsed = new URL(resolved);
            const href = parsed.href;

            if (!unparsedUrlSet.has(href)) {
              results.push(href);
              unparsedUrlSet.add(href);
            } else {
              console.info('Skipping already seen URL', href);
            }
          } catch (e) {
            console.info('Skipping invalid URL', cleaned);
          }
        }
        console.info(`${engine} done for query ${q}`);
      } catch (e) {
        console.warn(`  x ${engine} failed for query: ${q}`, e);
      }
    })());
    await Promise.allSettled(enginePromises);
  }

  return results;
}

async function getYoutubeVideoTitle(url) {
  const info = await ytdl.getBasicInfo(url);
  return info.videoDetails.title || null;
}

async function parseURLs(urlList, ragam) {
  const pageConcurrency = 2;
  const pageSem = new utils.Semaphore(pageConcurrency);

  const seenTitles = new Set();
  
  await Promise.allSettled(Array.from(urlList).map(async (originalUrl) => {
    await pageSem.acquire();
    try {
      console.info('fetching', originalUrl);

      // resolve any immediate HTTP redirect once before fetching HTML body
      let urlToFetch = originalUrl;
      try { urlToFetch = await resolveRedirectUrl(originalUrl); } catch (e) { /* keep original */ }

      let resp = await fetchHtml(urlToFetch);

      let isBinary = /(\.pdf|\.docx?|\.pptx?|\.xls[xm]?|\.zip|\.rar)$/i.test(urlToFetch) ||
                (resp && resp.headers && /application\/(pdf|msword|vnd|octet)/i.test(resp.headers['Content-Type']||''));
      if (isBinary) { 
        console.info('  binary document, skipping:', urlToFetch);
        console.info('Removing it from DB as well...');
        await db.deleteByOriginalUrl(originalUrl, ragam);
        return;
      }
      if (!resp || !resp.html) {
        console.info('empty HTML, skipping:', urlToFetch);
        console.info('Removing it from DB as well...');
        await db.deleteByOriginalUrl(originalUrl, ragam);
        return;
      }

      let { html, finalUrl } = resp;
      let final = finalUrl || urlToFetch;

      if (typeof html !== 'string' || html.length < 200) {
        console.info('too little HTML, skipping:', final);
        console.info('Removing it from DB as well...');
        await db.deleteByOriginalUrl(originalUrl, ragam);
        return;
      }

      if (await db.finalUrlExists(final, ragam)) {
        console.info('Skipping already seen URL ' + final);
        console.info('Removing it from DB as well...');
        await db.deleteByOriginalUrl(originalUrl, ragam);
        return;
      }

      if (ytdl.validateURL(final)) {
        let results = [{
          title: await getYoutubeVideoTitle(final),
          ragam_canonical: ragam,
          ragam_identified: ragam,
          context_snippet: 'Came up in search results, manually scraped',
          song_link: final,
          confidence: 0.5,
          source_url: final,
          inference_id: -1 //inference ID for manual insertion 
        }];

        await db.persistParsedOutput(originalUrl, final, null, results);
        return;
      }

      console.info('-> prompting for URL ' + final);
      const prompt = buildPromptForFullHtml(utils.cleanVisibleBody(html), ragam);

      let primaryOut;
      try { primaryOut = await runOllamaModel(prompt); } catch (e) { console.warn('primary ollama call failed:', e && e.message ? e.message : e); return; }

      const modelName = primaryOut && primaryOut.model_name ? primaryOut.model_name : 'UNKNOWN';
      let promptData = {
        model_name: modelName,
        prompt: prompt.user,
        thinking: primaryOut.thinking
      };

      const primaryParsed = utils.extractJsonFromOutput(primaryOut.content);
      if (!primaryParsed || !Array.isArray(primaryParsed)) {
        console.info('Prompt returned empty response, recording metadata...');
        await db.persistParsedOutput(originalUrl, final, promptData, []);
        return;
      }

      let results = [];

      for (const item of primaryParsed) {
        if (!item || !item.title) { console.warn('Invalid item in primary response:', item); continue; }
        const normTitle = String(item.title).trim().toLowerCase();
        if (seenTitles.has(normTitle)) continue;

        const confidence = (typeof item.confidence === 'number') ? item.confidence : 0.1;

        seenTitles.add(normTitle);
        results.push({
          title: String(item.title).trim(),
          ragam_canonical: item.ragam_canonical,
          ragam_identified: item.ragam_identified,
          context_snippet: item.context_snippet,
          song_link: item.song_link,
          confidence: confidence,
          source_url: final
        });
      }

      try {
        await db.persistParsedOutput(originalUrl, final, promptData, results);
        console.info('Updated DB state for ' + final);
      } catch (e) {
        console.error('Failed to persist parsed output:', e && e.message ? e.message : e);
        db.updateParseStatus(db, originalUrl, 'failed');
      }

    } catch (e) {
      console.warn('processing fail for', originalUrl, e && e.message ? e.message : e);
      db.updateParseStatus(db, originalUrl, 'failed');
    } finally {
      await utils.politeSleep();
      pageSem.release();
    }
  })); 
}

module.exports = { discoverURLs, parseURLs, resolveRedirectUrl };