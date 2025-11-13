// English headers
export const EN_HEADERS = {
  'User-Agent': process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9'
};

export const ENGINE_CONFIGS = {
  // existing
  bing: {
    startUrl: 'https://www.bing.com/?mkt=en-US&cc=US', browser_config: { headless: true, setExtraHTTPHeaders: EN_HEADERS }, navigationTimeout: 45000, waitForSelectorTimeout: 30000,
    queryUrl: q => `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=en-US`,
    selectors: { block: 'li.b_algo', title: 'h2', link: 'h2 a', snippet: '.b_caption p', next: 'a.sb_pagN' }
  },

  duckduckgo: {
    startUrl: 'https://duckduckgo.com/?kl=us-en', browser_config: { headless: true, setExtraHTTPHeaders: EN_HEADERS }, navigationTimeout: 45000, waitForSelectorTimeout: 30000,
    queryUrl: q => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}&kl=us-en`,
    selectors: { block: '.result', title: '.result__a', link: '.result__a', snippet: '.result__snippet', next: 'a.result--more__btn' }
  },

  yandex: {
    startUrl: 'https://yandex.com/?lang=en', browser_config: { headless: true, setExtraHTTPHeaders: EN_HEADERS }, navigationTimeout: 45000, waitForSelectorTimeout: 30000,
    queryUrl: q => `https://yandex.com/search/?text=${encodeURIComponent(q)}&lr=213`,
    selectors: { block: 'li.serp-item', title: 'h2 a, a.Link.Link_theme_normal', link: 'h2 a, a.Link_theme_normal', snippet: 'div.TextContainer span, div.Organic-ContentText', next: 'a.Pager-Item_kind_next' }
  },

  webcrawler: {
    startUrl: 'https://www.webcrawler.com/?language=en', browser_config: { headless: true, setExtraHTTPHeaders: EN_HEADERS }, navigationTimeout: 45000, waitForSelectorTimeout: 30000,
    queryUrl: q => `https://www.webcrawler.com/serp?q=${encodeURIComponent(q)}&language=en`,
    selectors: { block: '.web-bing__result', title: 'h2 a', link: 'h2 a', snippet: 'p', next: 'a.pagination__next' }
  },

  infospace: {
    startUrl: 'https://www.infospace.com/?lang=en', browser_config: { headless: true, setExtraHTTPHeaders: EN_HEADERS }, navigationTimeout: 45000, waitForSelectorTimeout: 30000,
    queryUrl: q => `https://www.infospace.com/serp?q=${encodeURIComponent(q)}&lang=en`,
    selectors: { block: '.web-bing__result', title: 'h2 a', link: 'h2 a', snippet: 'p', next: 'a.pagination__next' }
  },

  // missing added
  google: {
    startUrl: 'https://www.google.com/ncr?hl=en', browser_config: { headless: true, setExtraHTTPHeaders: EN_HEADERS }, navigationTimeout: 60000, waitForSelectorTimeout: 30000,
    queryUrl: q => `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=en&num=10&pws=0`,
    selectors: { block: 'div.g, div.Gx5Zad', title: 'h3', link: 'a', snippet: 'div[data-sncf], div.VwiC3b, span.aCOpRe', next: 'a#pnnext, a[aria-label="Next"]' }
  },
};

export const MODEL_PROMPT_OPTS = {
  temperature: 0.15,
  top_k: 50,
  frequency_penalty: 0.75,
  presence_penalty: 0.55,
  no_repeat_ngram_size: 3,
  think: true,
  stream: false,
  stop: ["}]"]
};

export const RENDER_WAIT_MAIN_SELECTOR = 'networkidle'
export const RENDER_WAIT_FALLBACK_SELECTOR = 'domcontentloaded'
export const RENDER_WAIT_FALLBACK_MS = 1000;
export const SCROLL_STEP = 1000;
export const SCROLL_DELAY = 500;
export const SCROLL_IDLE_ROUNDS = 3;
export const SCROLL_MAX_ITER = 50;