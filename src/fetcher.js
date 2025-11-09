// fetcher.js
const axios = require('axios');
const configs = require('./configs');

let playwright;
try { playwright = require('playwright'); } catch (e) { playwright = null; }

let cheerio;
try { cheerio = require('cheerio'); } catch (e) { cheerio = null; }

const DEFAULT_TIMEOUT = 15000;

async function autoScroll(page, step = 1000, delay = 250, idleRounds = 3) {
  await page.evaluate(async ({ step, delay, idleRounds }) => {
    await new Promise(resolve => {
      let lastHeight = 0;
      let sameCount = 0;

      const timer = setInterval(() => {
        const currentHeight = document.body.scrollHeight;
        window.scrollBy(0, step);

        if (currentHeight !== lastHeight) {
          lastHeight = currentHeight;
          sameCount = 0; // reset if new content appeared
        } else {
          sameCount++;
        }

        // stop when height hasn't changed for several cycles
        if (sameCount >= idleRounds) {
          clearInterval(timer);
          resolve();
        }
      }, delay);
    });
  }, { step, delay, idleRounds });
}

async function tryAxios(url, timeout = DEFAULT_TIMEOUT, maxRedirects = 10) {
  const headers = Object.assign({}, configs.DEFAULT_HEADERS || {}, { 'accept-language': configs.ACCEPT_LANGUAGE || 'en-US,en;q=0.9' });
  const resp = await axios.get(url, {
    headers,
    timeout,
    maxRedirects,
    responseType: 'text',
    validateStatus: status => status < 400
  });
  // finalUrl resolution compatible with axios node adapter
  const finalUrl = resp.request?.res?.responseUrl || resp.config.url;
  return { html: resp.data, finalUrl, status: resp.status, headers: resp.headers || {} };
}

// Extract "visible" body HTML + visible text using cheerio when available.
// Removes scripts/styles/iframes/noscript and obvious hidden/loader elements.
function extractVisible(html) {
  if (!html) return { visibleHtml: '', visibleText: '' };

  // quick raw blocker phrase check (avoid full parse if obviously blocked)
  const blockerRx = /(your browser (is )?(outdated|deprecated|not supported)|please enable javascript|verify you are human|recaptcha|cloudflare|browser check|robot check|access to this site is restricted|upgrade your browser)/i;
  if (blockerRx.test(html)) return { visibleHtml: '', visibleText: '' };

  if (!cheerio) {
    // fallback: strip non-content tags and collapse whitespace
    const stripped = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return { visibleHtml: stripped, visibleText: stripped };
  }

  try {
    const $ = cheerio.load(html, { decodeEntities: true });

    // remove noise
    $('script, style, noscript, meta, link, svg, iframe, template, head').remove();

    // remove elements hidden by attribute
    $('[hidden], [aria-hidden="true"], [type="hidden"]').remove();

    // remove nodes with inline styles that hide them
    $('[style]').each((i, el) => {
      const s = ($(el).attr('style') || '').toLowerCase();
      if (s.includes('display:none') || s.includes('visibility:hidden') || s.includes('opacity:0') || s.includes('height:0') || s.includes('width:0')) $(el).remove();
    });

    // remove loader / overlay / modal / cookie banners heuristically
    $('[id],[class]').each((i, el) => {
      const id = ($(el).attr('id') || '').toLowerCase();
      const cls = ($(el).attr('class') || '').toLowerCase();
      if (/spinner|loading|skeleton|shimmer|loader|overlay|modal|banner|cookie|consent|paywall|captcha|recaptcha|verify/.test(id + ' ' + cls)) $(el).remove();
    });

    // pick visible body if present
    let root = $('body');
    if (!root || root.length === 0) root = $.root();

    // collapse remaining invisible attribute-marked nodes inside root
    root.find('[aria-hidden="true"]').remove();

    const visibleHtml = root.html() || '';
    const visibleText = root.text().replace(/\s+/g, ' ').trim() || '';

    return { visibleHtml, visibleText };
  } catch (e) {
    return { visibleHtml: '', visibleText: '' };
  }
}

// Decide whether page requires a real browser render
function needsRender(html) {
  if (!html) return true;
  const cfg = configs || {};
  const MIN_HTML = cfg.MIN_HTML_LENGTH || 2000;    // visible HTML length
  const MIN_TEXT = cfg.MIN_TEXT_LENGTH || 200;     // visible text length
  const MAX_TAG_TEXT_RATIO = cfg.MAX_TAG_TEXT_RATIO || 6;

  // early blocker phrase detection on raw HTML
  const blockerRx = /(your browser (is )?(outdated|deprecated|not supported)|please enable javascript|verify you are human|recaptcha|cloudflare|browser check|robot check|access to this site is restricted|upgrade your browser)/i;
  if (blockerRx.test(html)) return true;

  const { visibleHtml, visibleText } = extractVisible(html);
  const textLen = (visibleText || '').length;
  const htmlLen = (visibleHtml || '').length;
  const tagCount = ((visibleHtml || '').match(/</g) || []).length;
  const tagTextRatio = tagCount / Math.max(1, textLen);

  const loadingRx = /\b(loading|spinner|skeleton|shimmer|please wait|buffering|initializing|aria-busy=["']?true)\b/i;
  const hasLoadingMarkers = loadingRx.test(visibleHtml) || loadingRx.test(visibleText) || loadingRx.test(html);

  const hasSemantic = /<article\b|<main\b|<section\b|<h1\b|<h2\b|class=["'].*(content|article|post|entry|main).*["']|data-reactroot/i.test(html);

  if (htmlLen < MIN_HTML) return true;
  if (textLen < MIN_TEXT) return true;
  if (hasLoadingMarkers && !hasSemantic) return true;
  if (tagTextRatio > MAX_TAG_TEXT_RATIO) return true;

  return false;
}

async function renderWithBrowser(url, timeout = DEFAULT_TIMEOUT, waitForSelector = null) {
  if (!playwright) throw new Error('Playwright not installed. npm i playwright');
  const browser = await playwright.chromium.launch({
    headless: false,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage'
    ]
  });

  const context = await browser.newContext({
    userDataDir: 'C:\\Users\\ssand\\AppData\\Local\\Google\\Chrome\\User Data'
  });

  const page = await context.newPage();
  const xhrResponses = [];
  let mainResponse = null;

  page.on('response', async (resp) => {
    try {
      const req = resp.request();
      const rType = req.resourceType();
      const ct = (resp.headers()['content-type'] || '').toLowerCase();
      if ((rType === 'xhr' || rType === 'fetch' || ct.includes('application/json'))) {
        const text = await resp.text().catch(() => null);
        xhrResponses.push({ url: resp.url(), status: resp.status(), headers: resp.headers(), body: text });
      }
    } catch (e) { /* ignore */ }
  });

  try {
    mainResponse = await page.goto(url, { waitUntil: 'networkidle', timeout });
    await page.waitForTimeout(750);
    await autoScroll(page);

    if (waitForSelector) {
      await page.waitForSelector(waitForSelector, { timeout: Math.min(timeout, 20000) }).catch(() => {});
    } else {
      await page.waitForTimeout(500); // allow late XHRs
    }
    const html = await page.content();
    const finalUrl = page.url();
    const status = mainResponse?.status?.() || 200;
    const headers = mainResponse?.headers?.() || {};
    await browser.close();
    return { html, finalUrl, status, headers, xhrResponses };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

/**
 * fetchHtml(url, timeout = DEFAULT_TIMEOUT, maxRedirects = 10, opts = {})
 * opts:
 *  - renderFallback: boolean (default true)
 *  - waitForSelector: CSS selector to wait for when rendering
 */
async function fetchHtml(url, timeout = DEFAULT_TIMEOUT, maxRedirects = 10, opts = {}) {
  opts = Object.assign({ renderFallback: true, waitForSelector: configs.RENDER_WAIT_SELECTOR || null }, opts);

  try {
    const axiosResp = await tryAxios(url, timeout, maxRedirects);

    // decide on render using visible content heuristics
    if (opts.renderFallback && needsRender(axiosResp.html)) {
      try {
        const renderResp = await renderWithBrowser(url, timeout, opts.waitForSelector);
        return {
          html: renderResp.html,
          finalUrl: renderResp.finalUrl,
          status: renderResp.status,
          headers: renderResp.headers,
          rendered: true,
          xhr: renderResp.xhrResponses
        };
      } catch (e) {
        // fall back gracefully to axios result
        console.warn('Render fallback failed:', e);
        return { ...axiosResp, rendered: false, xhr: [] };
      }
    }
    return { ...axiosResp, rendered: false, xhr: [] };
  } catch (err) {
    // axios failed. try rendering if allowed.
    if (opts.renderFallback && playwright) {
      try {
        const renderResp = await renderWithBrowser(url, timeout, opts.waitForSelector);
        return {
          html: renderResp.html,
          finalUrl: renderResp.finalUrl,
          status: renderResp.status,
          headers: renderResp.headers,
          rendered: true,
          xhr: renderResp.xhrResponses
        };
      } catch (e) {
        throw err; // return original axios error
      }
    }
    throw err;
  }
}

module.exports = { fetchHtml };