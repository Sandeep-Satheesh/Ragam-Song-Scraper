// fetcher.js
const axios = require('axios');
const configs = require('./configs');

let playwright;
try { playwright = require('playwright'); } catch (e) { /* optional: playwright not installed */ }

const DEFAULT_TIMEOUT = 15000;

async function tryAxios(url, timeout = DEFAULT_TIMEOUT, maxRedirects = 10) {
  const resp = await axios.get(url, {
    headers: configs.DEFAULT_HEADERS,
    timeout,
    maxRedirects,
    followAllRedirects: true,
    responseType: 'text',
    validateStatus: status => status < 400
  });
  return { html: resp.data, finalUrl: resp.request?.res?.responseUrl || resp.config.url, status: resp.status, headers: resp.headers };
}

function needsRender(html) {
  if (!html) return true;
  const small = (html.length < (configs.MIN_HTML_LENGTH || 4000));
  const hasLoadingMarkers = /loading|spinner|<div id="app"|data-reactroot|<noscript>/i.test(html) && !/<article|<main|<section|<div class="final-content"/i.test(html);
  return small || hasLoadingMarkers;
}

async function renderWithBrowser(url, timeout = DEFAULT_TIMEOUT, waitForSelector = null) {
  if (!playwright) throw new Error('Playwright not installed. npm i playwright');
  const browser = await playwright.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ userAgent: configs.DEFAULT_HEADERS['user-agent'] || undefined });
  const page = await context.newPage();
  const xhrResponses = [];
  page.on('response', async (resp) => {
    try {
      const req = resp.request();
      const rType = req.resourceType();
      const ct = (resp.headers()['content-type'] || '').toLowerCase();
      if (rType === 'xhr' || rType === 'fetch' || ct.includes('application/json')) {
        const text = await resp.text().catch(()=>null);
        xhrResponses.push({
          url: resp.url(),
          status: resp.status(),
          headers: resp.headers(),
          body: text
        });
      }
    } catch (e) { /* ignore */ }
  });

  try {
    const gotoOpts = { waitUntil: 'networkidle', timeout };
    await page.goto(url, gotoOpts);
    if (waitForSelector) {
      await page.waitForSelector(waitForSelector, { timeout: Math.min(timeout, 20000) }).catch(()=>{});
    } else {
      // small pause to let late XHRs finish
      await page.waitForTimeout(500);
    }
    const html = await page.content();
    const finalUrl = page.url();
    const headers = {}; // Playwright does not expose response headers easily here
    await browser.close();
    return { html, finalUrl, status: 200, headers, xhrResponses };
  } catch (err) {
    await browser.close().catch(()=>{});
    throw err;
  }
}

/**
 * fetchHtml(url, timeout = 15000, maxRedirects = 10, opts = {})
 * opts:
 *   - renderFallback: boolean (default true)
 *   - waitForSelector: CSS selector to wait for when rendering
 */
async function fetchHtml(url, timeout = DEFAULT_TIMEOUT, maxRedirects = 10, opts = {}) {
  opts = Object.assign({ renderFallback: true, waitForSelector: configs.RENDER_WAIT_SELECTOR || null }, opts);
  try {
    const axiosResp = await tryAxios(url, timeout, maxRedirects);
    // quick heuristic: if content looks like a JS-app shell then render
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
        // browser render failed. return axios result as graceful fallback
        return { ...axiosResp, rendered: false, xhr: [] };
      }
    }
    return { ...axiosResp, rendered: false, xhr: [] };
  } catch (err) {
    // If axios failed and renderFallback is enabled, try browser render directly
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
        throw err; // original axios error is likely informative
      }
    }
    throw err;
  }
}

module.exports = { fetchHtml };
