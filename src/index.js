#!/usr/bin/env node
// index.js — run discovery, persist results, then call exporter

const { program } = require('commander');
const { initDB } = require('./db');
const { discoverAndExtract } = require('./discover');
const exporter = require('./exporter');
const utils = require('./utils');
program
  .requiredOption('--ragam <name>', 'Rāgam name to search')
  .option('--max-pages <n>', 'pages per engine', String, '5')
  .option('--model <name>', 'Local Ollama model', 'gemma3:4b') 
  .parse(process.argv);

const opts = program.opts();

(async () => {
  const ragam = opts.ragam;
  const maxPages = Math.max(1, parseInt(opts.maxPages || opts.max_pages || '5', 10));
  const model = opts.model;

  // init DB
  const db = initDB();
  const run = db.runAsync.bind(db);
  const get = db.getAsync.bind(db);
  const all = db.allAsync.bind(db);

  // ensure songs table exists (dedupe by title + source_url)

  console.info(`Searching ragam="${ragam}" model="${model}" pagesPerEngine=${maxPages}`);

  const results = await discoverAndExtract(ragam, maxPages, model);

  console.info(`Discovered ${results.length} raw items from scraping.`);

  let inserted = 0, skipped = 0;
  for (const item of results) {
    try {
      const title = (item.title || '').trim();
      if (!title) { skipped++; continue; }
      const title_norm = utils.stripDiacriticsAndNoise(title);
      const composer = item.composer;
      const notes = item.notes;
      const youtube_link = item.youtube_link;
      const source_url = item.source_url || 'N/A';

      // insert or ignore duplicate (unique constraint)
      await run(
        `INSERT OR IGNORE INTO songs (title, composer, notes, youtube_link, source_url, ragam)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [title_norm, composer, notes, youtube_link, source_url, ragam]
      );

      // mark page seen if URL is real
      if (source_url) {
        await run(`INSERT OR IGNORE INTO pages(url) VALUES (?)`, [source_url]);
      }

      // count inserted/confirmed
      const exists = await get(`SELECT 1 FROM songs WHERE title = ? AND source_url = ? LIMIT 1`, [title_norm, source_url]);
      if (exists) inserted++; else skipped++;
    } catch (e) {
      console.warn('error processing item', e && e.message ? e.message : e);
    }
  }

  console.log(`Inserted/confirmed ${inserted} songs, skipped ${skipped}.`);

  // export to JSON via exporter module
  try {
    await exporter.exportSongs(db, `${ragam.toLowerCase().replace(/\s+/g,'_')}_songs.json`);
    console.log('Export complete.');
  } catch (e) {
    console.warn('export failed:', e && e.message ? e.message : e);
  }

  await db.closeAsync();
  console.log('Done.');
})().catch(err => {
  console.error('Fatal error:', err && err.stack ? err.stack : err);
  process.exit(1);
});
