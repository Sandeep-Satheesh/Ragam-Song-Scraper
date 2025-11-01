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
  } catch (_) {}
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

function cleanVisibleBody(html) {
  const $ = cheerio.load(html, { decodeEntities: false });

  // target <body> or root
  const $body = $('body').length ? $('body') : $.root();

  // remove totally irrelevant tags
  $body.find('script, noscript, iframe, style, link, meta, svg, canvas, form, input, textarea, button').remove();

  // remove comments
  $body.contents().each((_, node) => {
    if (node.type === 'comment') $(node).remove();
  });

  // helper checks
  const styleHidden = (s) =>
    !!s && /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0|height\s*:\s*0px|width\s*:\s*0px/i.test(s);

  const classOrIdBoilerplate = (val) =>
    !!val && /\b(header|nav|footer|menu|aside|sidebar|banner|advert|ads?|sponsor|subscribe|cookie|consent|promo|skip-nav)\b/i.test(val);

  const attrHidden = ($el) => {
    const role = ($el.attr('role') || '').toLowerCase();
    return $el.attr('hidden') !== undefined
      || ($el.attr('aria-hidden') || '').toLowerCase() === 'true'
      || role === 'navigation' || role === 'banner' || role === 'complementary' || role === 'search';
  };

  // remove nodes likely not visible or boilerplate
  $body.find('*').each((_, el) => {
    const $el = $(el);
    const style = ($el.attr('style') || '').toLowerCase();
    const cls = ($el.attr('class') || '');
    const id = ($el.attr('id') || '');

    if (styleHidden(style) || classOrIdBoilerplate(`${id} ${cls}`) || attrHidden($el)) {
      $el.remove();
      return;
    }

    // remove nodes that are empty after trimming whitespace and have no children
    const text = $el.text().replace(/\s+/g, '');
    if (!text && $el.children().length === 0) $el.remove();
  });

  // collapse consecutive empty nodes and trim excessive attributes that may bloat
  $body.find('*').each((_, el) => {
    const $el = $(el);

    // drop event handlers and inline data attributes that are irrelevant
    const attrs = $el.attr();
    for (const a in attrs) {
      if (/^on/i.test(a) || /^data-?_/i.test(a) || a === 'style' || a === 'role' || a === 'aria-hidden') {
        $el.removeAttr(a);
      }
    }
  });

  // final pass: remove any empty tags left
  $body.find('*').each((_, el) => {
    const $el = $(el);
    if ($el.children().length === 0 && !$el.text().trim()) $el.remove();
  });

  // return the cleaned body as raw HTML including the <body> wrapper
  return `<body>${$body.html() || ''}</body>`;
}

function stripDiacriticsAndNoise(s) {
  if (!s) return '';
  let t = s.normalize ? s.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : s;
  t = t.replace(/[.\-·ʻ’'`"~]/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

module.exports = { cleanRedirectUrl, looksLikeRedirectStub, stripDiacritics, cleanVisibleBody, stripDiacriticsAndNoise };