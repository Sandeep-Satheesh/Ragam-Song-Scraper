#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { program } = require('commander');
require('dotenv').config();
const { initDB } = require('./db');
const { fetchHtml, politeSleep } = require('./fetcher');
const { extractTitles, normalize } = require('./parser');
const { searchYouTube } = require('./youtube');
const { discover } = require('./discover');
(async ()=>{
  const db = initDB();
  const MAX_PAGES_DEFAULT = parseInt(process.env.DEFAULT_NUM_PAGES || '5',10);
  program.requiredOption('--ragam <name>').option('--seeds <file>').option('--max-pages <n>', String, String(MAX_PAGES_DEFAULT)).option('--out <file>','Output JSON file');
  program.parse(process.argv);
  const opts = program.opts();
  const ragam = opts.ragam;
  let seeds = [];
  if(opts.seeds && fs.existsSync(opts.seeds)){
    seeds = fs.readFileSync(opts.seeds,'utf-8').split('\n').map(s=>s.trim()).filter(Boolean);
  }
  const discovered = await discover(ragam, Math.max(1, Math.ceil(parseInt(opts.maxPages||opts.max_pages||MAX_PAGES_DEFAULT)/1)));
  const pages = Array.from(new Set([...(seeds||[]), ...discovered])).slice(0, parseInt(opts.max_pages||opts.maxPages||MAX_PAGES_DEFAULT));
  console.log('Pages to scan:', pages.length);
  const runAsync = db.runAsync.bind(db);
  const getAsync = db.getAsync.bind(db);
  const allAsync = db.allAsync.bind(db);
  for(const url of pages){
    try{
      const seen = await getAsync('SELECT 1 FROM pages WHERE url = ?', [url]);
      if(seen){ console.log('skipping seen page', url); continue; }
      console.log('fetching', url);
      const html = await fetchHtml(url).catch(e=>{ console.warn('fetch failed',e.message||e); return null; });
      await runAsync('INSERT OR IGNORE INTO pages(url) VALUES (?)', [url]); // mark even if fetch fails
      if(!html) continue;
      const titles = extractTitles(html);
      for(const t of titles){
        const norm = normalize(t);
        const tseen = await getAsync('SELECT 1 FROM titles WHERE norm = ?', [norm]);
        if(tseen) continue;
        await runAsync('INSERT OR IGNORE INTO titles(norm,title,source_page,ragam) VALUES (?,?,?,?)', [norm,t,url,ragam]);
        const q = `${t} ${ragam} song`;
        const { id, url: yurl } = await searchYouTube(q);
        if(id){
          await runAsync('INSERT OR IGNORE INTO videos(youtube_id,youtube_url,title,ragam,source_page) VALUES (?,?,?,?,?)', [id,yurl,t,ragam,url]);
          console.log('added', t, id);
        }
        await politeSleep();
      }
      await politeSleep();
    }catch(e){ console.warn('page loop error', e.message || e); }
  }
  const out = opts.out || `${ragam.toLowerCase().replace(/\s+/g,'_')}_videos.json`;
  const rows = await allAsync('SELECT youtube_id,youtube_url,title,ragam,source_page FROM videos', []);
  fs.writeFileSync(out, JSON.stringify(rows,null,2),'utf-8');
  console.log('exported', rows.length, 'videos ->', out);
  await db.closeAsync();
})();
