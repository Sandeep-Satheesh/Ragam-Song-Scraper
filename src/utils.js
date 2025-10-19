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
  const $ = cheerio.load(html);

  // Focus on <body> if available
  const $body = $("body").length ? $("body") : $.root();

  // Remove non-visible or useless elements
  $body.find("script, style, noscript, iframe, svg, canvas, meta, link").remove();

  // Remove comments
  $body.contents().each((_, el) => {
    if (el.type === "comment") $(el).remove();
  });

  // Patterns for unwanted elements (nav, ads, footer, etc.)
  const removePatterns = [
    /(header|nav|footer|menu|aside)/i,
    /(sidebar|advert|ads?|sponsor|subscribe|cookie|banner)/i,
  ];

  // Remove matching elements by tag name, id, or class
  $body.find("*").each((_, el) => {
    const tag = el.tagName || "";
    const id = $(el).attr("id") || "";
    const cls = $(el).attr("class") || "";
    const haystack = `${tag} ${id} ${cls}`;
    if (removePatterns.some((pat) => pat.test(haystack))) $(el).remove();
  });

  // Collect paragraph-like text blocks
  const keepTags = ["p", "div", "li", "article", "section", "h1", "h2", "h3", "h4", "h5", "h6"];
  const blocks = [];

  $body.find(keepTags.join(",")).each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text.length >= 15) blocks.push(text);
  });

  // Fallback if no blocks found
  if (!blocks.length) {
    const raw = $body.text().replace(/\s+/g, " ").trim();
    if (raw) blocks.push(raw);
  }

  // Deduplicate consecutive duplicates
  const deduped = blocks.filter((b, i) => i === 0 || b !== blocks[i - 1]);

  // Join blocks with double newline for readability
  const cleanedText = deduped.join("\n\n");

  return cleanedText;
}

function stripDiacriticsAndNoise(s) {
  if (!s) return '';
  let t = s.normalize ? s.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : s;
  t = t.replace(/[.\-·ʻ’'`"~]/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

module.exports = { cleanRedirectUrl, looksLikeRedirectStub, stripDiacritics, cleanVisibleBody, stripDiacriticsAndNoise };