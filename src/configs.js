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

  yahoo: {
    startUrl: 'https://search.yahoo.com/?ei=UTF-8', browser_config: { headless: true, setExtraHTTPHeaders: EN_HEADERS }, navigationTimeout: 45000, waitForSelectorTimeout: 30000,
    queryUrl: q => `https://search.yahoo.com/search?p=${encodeURIComponent(q)}&ei=UTF-8`,
    selectors: { block: 'div#web ol>li div>div', title: 'h3.title', link: 'h3.title a', snippet: 'div.compText p, p', next: 'a.next' }
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

  baidu: {
    startUrl: 'https://www.baidu.com/', browser_config: { headless: true, setExtraHTTPHeaders: EN_HEADERS }, navigationTimeout: 60000, waitForSelectorTimeout: 30000,
    queryUrl: q => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}&ie=utf-8&tn=baiduhome_pg`,
    selectors: { block: 'div.result, div.c-container', title: 'h3 a', link: 'h3 a', snippet: 'div.c-abstract, div.content-right_8Zs40', next: 'a.n' }
  },

  aol: {
    startUrl: 'https://search.aol.com/', browser_config: { headless: true, setExtraHTTPHeaders: EN_HEADERS }, navigationTimeout: 45000, waitForSelectorTimeout: 30000,
    queryUrl: q => `https://search.aol.com/aol/search?q=${encodeURIComponent(q)}&ei=UTF-8`,
    selectors: { block: 'div.algo', title: 'h3 a', link: 'h3 a', snippet: 'div.compText p', next: 'a.next' }
  },

  ask: {
    startUrl: 'https://www.ask.com/', browser_config: { headless: true, setExtraHTTPHeaders: EN_HEADERS }, navigationTimeout: 45000, waitForSelectorTimeout: 30000,
    queryUrl: q => `https://www.ask.com/web?q=${encodeURIComponent(q)}`,
    selectors: { block: 'div.PartialSearchResults-item', title: 'a.PartialSearchResults-item-title-link', link: 'a.PartialSearchResults-item-title-link', snippet: 'p.PartialSearchResults-item-abstract', next: 'a.next' }
  },

  mojeek: {
    startUrl: 'https://www.mojeek.com/', browser_config: { headless: true, setExtraHTTPHeaders: EN_HEADERS }, navigationTimeout: 45000, waitForSelectorTimeout: 30000,
    queryUrl: q => `https://www.mojeek.com/search?q=${encodeURIComponent(q)}&s=0`,
    selectors: { block: '#results li.result', title: 'a.result-title', link: 'a.result-title', snippet: 'p.s', next: 'a.next' }
  },

  naver: {
    startUrl: 'https://search.naver.com/', browser_config: { headless: true, setExtraHTTPHeaders: EN_HEADERS }, navigationTimeout: 60000, waitForSelectorTimeout: 30000,
    queryUrl: q => `https://search.naver.com/search.naver?query=${encodeURIComponent(q)}&where=web`,
    selectors: { block: 'div.webdoc', title: 'a.title_link', link: 'a.title_link', snippet: 'div.total_dsc, div.dsc_txt', next: 'a.btn_next' }
  },

  seznam: {
    startUrl: 'https://www.seznam.cz/', browser_config: { headless: true, setExtraHTTPHeaders: EN_HEADERS }, navigationTimeout: 45000, waitForSelectorTimeout: 30000,
    queryUrl: q => `https://search.seznam.cz/?q=${encodeURIComponent(q)}`,
    selectors: { block: 'div.Result', title: 'h3 a', link: 'h3 a', snippet: 'p.Result-snippet', next: 'a.Paging-link.next' }
  },
};


// models in staged pipeline order (names you must have available in Ollama Cloud/local)
export const MODELS = {
  primary: process.env.OLLAMA_PRIMARY_MODEL || 'gpt-oss:120b-cloud',           // fast extractor
  verifier: process.env.OLLAMA_VERIFIER_MODEL || 'gpt-oss:120b-cloud',        // disambiguator
  fallback1: process.env.OLLAMA_FALLBACK1_MODEL || 'qwen3-coder:480b-cloud', // heavy fallback
  fallback2: process.env.OLLAMA_FALLBACK2_MODEL || 'deepseek-v3:671b-cloud'  // largest fallback
};

// ----------------- Variant generation (unchanged) -----------------
export const VOWELS = ['a', 'e', 'i', 'o', 'u'];

export const RENDER_WAIT_SELECTOR = 'networkidle'