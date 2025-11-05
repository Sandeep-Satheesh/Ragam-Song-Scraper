#!/usr/bin/env node
// index.js — run discovery, persist results, then call exporter

const { program } = require('commander');
const { initDB } = require('./db');
const { discoverURLs, parseURLs } = require('./discover');
const exporter = require('./exporter');
const utils = require('./utils');
program
  .requiredOption('--ragam <name>', 'Rāgam name to search')
  .option('--max-pages <n>', 'pages per engine', String, '5')
  .parse(process.argv);

const opts = program.opts();

(async () => {
  const ragam = opts.ragam;
  const maxPages = Math.max(1, parseInt(opts.maxPages || opts.max_pages || '5', 10));

  // init DB
  const db = initDB();
  const run = db.runAsync.bind(db);
  const get = db.getAsync.bind(db);
  const all = db.allAsync.bind(db);

  console.info(`Searching ragam="${ragam}" pagesPerEngine=${maxPages}`);

  //const discoverResults = { variants: [ragam], results: await db.allAsync('SELECT url FROM pages') };
  //discoverResults.results = discoverResults.results.map(urlObj => urlObj.url);
  const discoverResults = await discoverURLs([ragam], maxPages);
  console.info(`Discovered ${discoverResults.results.length} raw items from scraping.`);

  await Promise.all(Array.from(discoverResults.results).map(async (url) => {
    await db.run(`INSERT OR IGNORE INTO pages(url) VALUES (?)`, [url]);
  }));

  const results = await parseURLs(discoverResults.results, discoverResults.variants);

  let initDbCount = 0, newDbCount = 0;
  
  let exists = await get(`SELECT count(id) AS count FROM songs_raw`);
  if (exists && exists.count) {
    initDbCount = exists.count;
  }

  for (const item of results) {
    try {
      const title = (item.title || '').trim();
      if (!title) { skipped++; continue; }
      const title_norm = utils.stripDiacriticsAndNoise(title);
      const composer = item.composer;
      const notes = item.notes;
      const source_url = item.source_url || 'N/A';

      // insert or ignore duplicate (unique constraint)
      await run(
        `INSERT OR IGNORE INTO songs_raw (title, composer, notes, source_url, ragam)
         VALUES (?, ?, ?, ?, ?)`,
        [title_norm, composer, notes, source_url, ragam]
      );

      for (const song_link of item.song_links || []) {
        await run(
          `INSERT OR IGNORE INTO song_links (title, source_url, song_link) VALUES (?, ?, ?)`,
          [title_norm, source_url, song_link]
        );
      }

    } catch (e) {
      console.warn('error processing item', e && e.message ? e.message : e);
    }
  }

  exists = await get(`SELECT count(id) AS count FROM songs_raw`);
  if (exists && exists.count) {
    newDbCount = exists.count;
  }

  console.log(`Inserted ${newDbCount - initDbCount} new song record(s).`);

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
