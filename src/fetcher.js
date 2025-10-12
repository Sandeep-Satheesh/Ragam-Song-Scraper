const axios = require('axios');
const USER_AGENT = 'ragam-se-scraper-js/0.1 (+https://example.com)';
async function fetchHtml(url, timeout=15000) {
  const res = await axios.get(url, { headers: { 'User-Agent': USER_AGENT }, timeout });
  return res.data;
}
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
async function politeSleep(min=800,max=2000){ const ms = Math.floor(Math.random()*(max-min))+min; await sleep(ms); }
module.exports = { fetchHtml, politeSleep };
