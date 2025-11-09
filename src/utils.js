const cheerio = require("cheerio");

// src/utils.js
function cleanRedirectUrl(url) {
  try {
    // common param keys used by wrappers: u, RU, a (bing enc), r, url
    const uMatch = url.match(/[?&](?:u|RU|url|r)=([^&]+)/i);
    if (uMatch) {
      const decoded = decodeURIComponent(uMatch[1]);
      if (/^https?:\/\//i.test(decoded)) return decoded;
    }
  } catch (_) { }
  return url;
}

function looksLikeRedirectStub(html) {
  if (!html) return false;
  const s = html.slice(0, 6000).toLowerCase();
  return /click here if the page does not redirect automatically|you are being redirected|meta http-equiv=["']refresh["']/.test(s);
}

function stripDiacritics(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // remove combining marks
}

function removeEmptyTopDownByContent($root, $) {
  // returns true only if node has meaningful content or meaningful descendants
  function hasMeaningful($el) {
    if (!$el || !$el.length) return false;

    // 1) direct media/links/attributes that carry visible meaning
    if ($el.is('img') && $el.attr('src')) return true;
    if ($el.is('a') && $el.attr('href')) return true;
    if ($el.attr('title') || $el.attr('alt') || $el.attr('aria-label')) return true;

    // 2) visible text (ignore whitespace)
    const text = $el.clone()           // clone so we can strip nested tags if needed
      .find('script,style,noscript,template').remove().end()
      .text()
      .replace(/\s+/g, '')
      .trim();
    if (text.length > 0) return true;

    // 3) any meaningful descendant
    const children = $el.children().toArray();
    for (const c of children) {
      if (hasMeaningful($(c))) return true;
    }
    return false;
  }

  // top-down sweep: remove immediate children that have no meaningful content,
  // descend only into children that do.
  function sweep($node) {
    $node.children().each((_, child) => {
      const $child = $(child);
      if (!hasMeaningful($child)) {
        $child.remove();           // remove entire subtree at this level
      } else {
        sweep($child);             // descend
      }
    });
  }

  sweep($root);
}

function removeYoutubeUI($body) {
  // all polymer/YouTube UI components to strip
  const ytSelectors = [
    'ytd-playlist-panel-renderer',
    'ytd-player',
    'ytd-thumbnail-overlay-time-status-renderer',
    'ytd-thumbnail-overlay-now-playing-renderer',
    'ytd-mini-guide-renderer',
    'ytd-masthead',
    'tp-yt-app-drawer',
    'tp-yt-paper-tooltip'
  ].join(',');

  $body.find(ytSelectors).remove();
}

function minifyHtml(html) {
  const $ = cheerio.load(html, { decodeEntities: false });

  // remove comments
  $('*').contents().each((_, el) => {
    if (el.type === 'comment') $(el).remove();
  });

  // remove redundant whitespace between tags
  let output = $('body').html()
    .replace(/\n+/g, '')         // drop newlines
    .replace(/\s{2,}/g, ' ')     // collapse spaces
    .replace(/>\s+</g, '><')     // collapse tag gaps
    .trim();

  return output;
}

function collapseYoutubeWrappers($) {
  const uselessTags = [
    'yt-formatted-string',
    'truncated-text',
    'truncated-text-content',
    'ytd-alert-with-button-renderer',
    'ytd-playlist-sidebar-renderer',
    'yt-dynamic-text-view-model',
    'yt-content-preview-image-view-model',
    'ytd-tabbed-page-header',
    'yt-content-metadata-view-model',
    'yt-description-preview-view-model',
    'ytd-playlist-sidebar-secondary-info-renderer',
    'yt-page-header-view-model',
    'yt-button-shape',
    'ytd-video-owner-renderer',
    'ytd-channel-name',
    'thumbnail-hover-overlay-view-model',
  ];
  uselessTags.forEach(tag => {
    $(tag).each((_, el) => {
      const $el = $(el);
      $el.replaceWith($el.contents());
    });
  });
}

function cleanVisibleBody(html) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const $body = $('body').length ? $('body') : $.root();

  // remove noise
  $body.find('script, style, iframe, noscript, meta, link').remove();

  // remove event/style attributes
  $body.find('*').each((_, el) => {
    ['onload', 'onclick', 'onmouseover', 'onerror', 'style'].forEach(a => $(el).removeAttr(a));
  });

  // remove all attributes except href
  $body.find('*').each((_, el) => {
    const attribs = Object.keys(el.attribs || {});
    for (const a of attribs) {
      if (a !== 'href') $(el).removeAttr(a);
    }
  });

  // remove empty elements bottom-up except allowed terminal tags or elements that contain href
  const allowed = new Set(['a','p','span','video','h1','h2','h3','h4','h5','h6','li','br','strong','em','b','i']);
  let removed;
  do {
    removed = false;
    // select all elements; iterate from deepest by using .find('*') and reverse order
    const nodes = $body.find('*').toArray().reverse();
    for (const el of nodes) {
      const $el = $(el);
      const tag = el.tagName ? el.tagName.toLowerCase() : '';
      // keep if allowlisted or has href attribute
      if (allowed.has(tag) || $el.attr && $el.attr('href')) continue;
      // if element has non-empty text or any non-empty child element, keep
      const text = $el.text().replace(/\s+/g, '').trim();
      const hasNonEmptyChild = $el.children().toArray().some(c => {
        const $c = $(c);
        return $c.text().replace(/\s+/g, '').trim().length > 0;
      });
      if (!text && !hasNonEmptyChild) {
        $el.remove();
        removed = true;
      }
    }
  } while (removed);

  removeYoutubeUI($body);
  collapseYoutubeWrappers($);
  removeEmptyTopDownByContent($body, $);
  return minifyHtml($body.html());
}

function stripDiacriticsAndNoise(s) {
  if (!s) return '';
  let t = s.normalize ? s.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : s;
  t = t.replace(/[.\-·ʻ’'`"~]/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

function extractJsonFromOutput(text) {
  if (!text) return null;
  const startArr = text.indexOf('[');
  const startObj = text.indexOf('{');
  const s = (startArr === -1 || (startObj !== -1 && startObj < startArr)) ? startObj : startArr;
  if (s === -1) return null;
  const candidate = text.slice(s);
  try { return JSON.parse(candidate); }
  catch {
    const last = Math.max(candidate.lastIndexOf(']'), candidate.lastIndexOf('}'));
    if (last !== -1) {
      try { return JSON.parse(candidate.slice(0, last + 1)); } catch { }
    }
    return null;
  }
}

async function politeSleep() {
  const delay = 1000 + Math.random() * 1000; // 1000–2000 ms
  return new Promise(resolve => setTimeout(resolve, delay));
}

module.exports = { cleanRedirectUrl, looksLikeRedirectStub, stripDiacritics, cleanVisibleBody, stripDiacriticsAndNoise, extractJsonFromOutput, politeSleep };