// English headers
export const EN_HEADERS = {
  'User-Agent': process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9'
};

// Search engines (no Google)
export const ENGINE_CONFIGS = {
  bing: { startUrl: 'https://www.bing.com/?mkt=en-US&cc=US', browser_config: { headless: true, setExtraHTTPHeaders: EN_HEADERS }, navigationTimeout: 45000, waitForSelectorTimeout: 30000 },
  duckduckgo: { startUrl: 'https://duckduckgo.com/?kl=us-en', browser_config: { headless: true, setExtraHTTPHeaders: EN_HEADERS }, navigationTimeout: 45000, waitForSelectorTimeout: 30000 },
  yahoo: { startUrl: 'https://search.yahoo.com/?ei=UTF-8', browser_config: { headless: true, setExtraHTTPHeaders: EN_HEADERS }, navigationTimeout: 45000, waitForSelectorTimeout: 30000 },
  yandex: { startUrl: 'https://yandex.com/?lang=en', browser_config: { headless: true, setExtraHTTPHeaders: EN_HEADERS }, navigationTimeout: 45000, waitForSelectorTimeout: 30000 },
  webcrawler: { startUrl: 'https://www.webcrawler.com/?language=en', browser_config: { headless: true, setExtraHTTPHeaders: EN_HEADERS }, navigationTimeout: 45000, waitForSelectorTimeout: 30000 },
  infospace: { startUrl: 'https://www.infospace.com/?lang=en', browser_config: { headless: true, setExtraHTTPHeaders: EN_HEADERS }, navigationTimeout: 45000, waitForSelectorTimeout: 30000 }
};

// ----------------- Variant generation (unchanged) -----------------
export const VOWELS = ['a', 'e', 'i', 'o', 'u'];