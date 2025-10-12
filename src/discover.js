// Discover using every search engine se-scraper advertises, merge + dedupe results.
const se_scraper = require('se-scraper');
const utils = require('utils');

async function runScrapeWithOpts(scrape_job, opts) {
  return await se_scraper.scrape(opts, scrape_job);
}

function walkForUrls(obj, set) {
  if (!obj) return;
  if (typeof obj === 'string' && obj.startsWith('http')) { set.add(obj); return; }
  if (Array.isArray(obj)) { obj.forEach(o => walkForUrls(o, set)); return; }
  if (typeof obj === 'object') { for (const k of Object.keys(obj)) walkForUrls(obj[k], set); }
}

function normalizeUrlKeepOriginal(u) {
  try {
    const urlObj = new URL(u);
    urlObj.hash = '';
    let norm = urlObj.toString().replace(/\/+$/, '');
    return norm;
  } catch (e) { return null; }
}

// Map of engine -> default opts (tweak if needed)
const ENGINE_CONFIGS = {
  google: { startUrl: 'https://www.google.com/ncr', browser_config: { headless: false, args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] }, navigationTimeout: 60000, waitForSelectorTimeout: 60000 },
  google_news: { startUrl: 'https://news.google.com', browser_config: { headless: true, args:['--no-sandbox'] }, navigationTimeout: 45000, waitForSelectorTimeout: 30000 },
  google_news_app: { startUrl: 'https://news.google.com', browser_config: { headless: true, args:['--no-sandbox'] }, navigationTimeout: 45000, waitForSelectorTimeout: 30000 },
  google_image: { startUrl: 'https://www.google.com/imghp', browser_config: { headless: true, args:['--no-sandbox'] }, navigationTimeout: 45000, waitForSelectorTimeout: 30000 },
  bing: { startUrl: 'https://www.bing.com', browser_config: { headless: true, args:['--no-sandbox'] }, navigationTimeout: 45000, waitForSelectorTimeout: 30000 },
  bing_news: { startUrl: 'https://www.bing.com/news', browser_config: { headless: true, args:['--no-sandbox'] }, navigationTimeout: 45000, waitForSelectorTimeout: 30000 },
  infospace: { startUrl: 'https://www.infospace.com', browser_config: { headless: true, args:['--no-sandbox'] }, navigationTimeout: 45000, waitForSelectorTimeout: 30000 },
  duckduckgo: { startUrl: 'https://duckduckgo.com', browser_config: { headless: true, args:['--no-sandbox'] }, navigationTimeout: 45000, waitForSelectorTimeout: 30000 },
  yandex: { startUrl: 'https://yandex.com', browser_config: { headless: true, args:['--no-sandbox'] }, navigationTimeout: 45000, waitForSelectorTimeout: 30000 },
  webcrawler: { startUrl: 'https://www.webcrawler.com', browser_config: { headless: true, args:['--no-sandbox'] }, navigationTimeout: 45000, waitForSelectorTimeout: 30000 }
};

async function discover(ragam, numPages = 10) {
  ragam = utils.stripDiacritics(ragam);

  const keywords = [
    `${ragam} ragam songs carnatic`,
    `${ragam} ragam film songs`,
    `${ragam} ragam songs`
  ];

  const combinedUrls = new Map(); // norm -> original (first seen)

  // iterate all engines advertised by se-scraper
  for (const engine of Object.keys(ENGINE_CONFIGS)) {
    const cfg = ENGINE_CONFIGS[engine];
    const scrape_job = { search_engine: engine, keywords, num_pages: numPages };

    try {
      console.info(`scraping ${engine} (${keywords.length} keywords x ${numPages} pages)`);
      const raw = await runScrapeWithOpts(scrape_job, cfg);
      const urlSet = new Set();
      walkForUrls(raw, urlSet);
      for (const u of urlSet) {
        // filter out common interstitials
        if (!u || /accounts\.google\.com|consent\.google\.com|consent\.youtube\.com/i.test(u)) continue;
        const norm = normalizeUrlKeepOriginal(u);
        if (!norm) continue;
        if (!combinedUrls.has(norm)) combinedUrls.set(norm, u); // keep first-seen original
      }
    } catch (err) {
      console.warn(`${engine} scrape failed:`, err && err.message ? err.message : err);
      // continue to next engine
    }
  }

  // Return deduped original URLs in insertion order
  return Array.from(combinedUrls.values());
}

module.exports = { discover };
