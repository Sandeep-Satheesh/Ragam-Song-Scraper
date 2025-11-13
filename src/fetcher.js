// fetcher.js
const configs = require('./configs');
const playwright = require('playwright');
const ytdl = require('ytdl-core');

const DEFAULT_TIMEOUT = 15000;
const FALLBACK_WAIT = configs.RENDER_WAIT_FALLBACK_MS || 3000;

/** Scroll page to load dynamic content */
async function autoScroll(page, step = 1000, delay = 250, idleRounds = 3, maxIter = 60) {
  await page.evaluate(
    async ({ step, delay, idleRounds, maxIter }) => {
      await new Promise((resolve) => {
        let lastHeight = -1, sameCount = 0, iter = 0;
        const tick = async () => {
          window.scrollBy(0, step);
          iter++;
          const currentHeight = document.body.scrollHeight || document.documentElement.scrollHeight || 0;
          if (currentHeight !== lastHeight) {
            lastHeight = currentHeight;
            sameCount = 0;
          } else sameCount++;
          if (sameCount >= idleRounds || iter >= maxIter) return resolve();
          setTimeout(tick, delay);
        };
        setTimeout(tick, delay);
      });
    },
    { step, delay, idleRounds, maxIter }
  );
}

/** Render page with Playwright, skip scrolling if YouTube video */
async function renderWithBrowser(url, timeout = DEFAULT_TIMEOUT, waitForSelector = null) {
  const browser = await playwright.chromium.launch({
    headless: false,
    executablePath: configs.CHROME_EXECUTABLE_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });

  const context = await browser.newContext({
    userDataDir: 'C:\\Users\\ssand\\AppData\\Local\\Google\\Chrome\\User Data'
  });

  const page = await context.newPage();
  const xhrResponses = [];
  let mainResponse = null;
  let finalUrl = null;

  page.on('response', async (resp) => {
    try {
      const req = resp.request();
      const rType = req.resourceType();
      const ct = (resp.headers()['content-type'] || '').toLowerCase();
      if (rType === 'xhr' || rType === 'fetch' || ct.includes('application/json')) {
        const text = await resp.text().catch(() => null);
        xhrResponses.push({ url: resp.url(), status: resp.status(), headers: resp.headers(), body: text });
      }
    } catch {}
  });

  async function tryGoto() {
    try {
      mainResponse = await page.goto(url, { waitUntil: 'networkidle', timeout });
    } catch {
      try {
        mainResponse = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Math.min(timeout, 20000) });
        await page.waitForTimeout(FALLBACK_WAIT);
      } catch {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Math.min(timeout, 20000) }).catch(() => {});
        await page.waitForTimeout(FALLBACK_WAIT);
      }
    }
  }

  try {
    await tryGoto();

    finalUrl = page.url() || url;
    const isYouTubeVideo = ytdl.validateURL(finalUrl);

    if (!isYouTubeVideo) {
      await autoScroll(page, configs.SCROLL_STEP || 800, configs.SCROLL_DELAY || 200);
    } else {
      await page.waitForTimeout(configs.YT_SETTLE_WAIT_MS || 600);
    }

    if (waitForSelector)
      await page.waitForSelector(waitForSelector, { timeout: Math.min(timeout, 15000) }).catch(() => {});
    else
      await page.waitForTimeout(600);

    const html = await page.content();
    const status = typeof mainResponse?.status === 'function' ? mainResponse.status() : (mainResponse?.status || 200);
    const headers = typeof mainResponse?.headers === 'function' ? mainResponse.headers() : (mainResponse?.headers || {});
    await browser.close();

    return { html, finalUrl, status, headers, xhrResponses };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

/** Main fetchHtml */
async function fetchHtml(url, timeout = DEFAULT_TIMEOUT, opts = {}) {
  const renderResp = await renderWithBrowser(url, timeout, opts.waitForSelector);
  return {
    html: renderResp.html,
    finalUrl: renderResp.finalUrl,
    status: renderResp.status,
    headers: renderResp.headers,
    rendered: true,
    xhr: renderResp.xhrResponses
  };
}

module.exports = { fetchHtml };