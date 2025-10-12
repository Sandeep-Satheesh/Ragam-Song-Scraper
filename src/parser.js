const cheerio = require('cheerio');
const normalize = (s)=> s.replace(/\W+/g,' ').trim().toLowerCase();
function extractTitles(html){
  const $ = cheerio.load(html);
  const set = new Set();
  $('a, li, h1, h2, h3, h4, h5, h6').each((i,el)=>{
    const t = $(el).text().replace(/\s+/g,' ').trim();
    if(t && t.length>=6 && t.split(' ').length<=12) set.add(t);
  });
  const out = Array.from(set).filter(t=>/[a-zA-Z]/.test(t) && t.split(' ').length>=2);
  return out;
}
module.exports = { extractTitles, normalize };
