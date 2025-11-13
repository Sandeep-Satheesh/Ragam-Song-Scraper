#!/usr/bin/env node

const fs = require('fs');
const readline = require('readline');
const { program } = require('commander');
const db = require('./db');
const { discoverURLs, parseURLs } = require('./discover');
const exporter = require('./exporter');
const utils = require('./utils');

program
  .requiredOption('--input-file <path>', 'Text file containing rāgam names (one per line)')
  .option('--max-pages <n>', 'pages per engine', String, '5')
  .option('--dont-scrape', 'Enable or disable scraping')
  .parse(process.argv);

const opts = program.opts();

async function processRagam(ragam) {
  const maxPages = Math.max(1, parseInt(opts.maxPages || '5', 10));
  const dontScrape = opts.dontScrape || false;
  let toParse = [];

  let unparsedUrls = await db.getUnparsedURLs(ragam);
  console.info(`Found ${unparsedUrls.length} unparsed URL(s) for ${ragam} already in DB`);

  if (dontScrape) {
    console.warn(`Scraping disabled by user flag`);
  } else {
    console.info(`Searching for ragam="${ragam}" pagesPerEngine=${maxPages}`);
    let discoverResults = await discoverURLs(ragam, maxPages, new Set(unparsedUrls));
    console.info(`Found ${discoverResults.length} URL(s) from scraping`);
    toParse = discoverResults;
  }

  if (toParse.length > 0) {
    await Promise.all(toParse.map(async (url) => {
      await db.insertPageRaw(url, ragam, 'pending');
    }));
  }

  toParse.push(...unparsedUrls);
  console.info(`Total ${toParse.length} URL(s) to parse for ragam ${ragam}.`);

  await parseURLs(toParse, ragam);

  try {
    await exporter.exportData(db, ragam);
    console.log('Export complete.');
  } catch (e) {
    console.warn('export failed:', e?.message || e);
  }

  console.log(`Finished processing ragam "${ragam}".`);
}

(async () => {
  const inputFile = opts.inputFile;
  if (!fs.existsSync(inputFile)) {
    console.error(`Input file not found: ${inputFile}`);
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(inputFile),
    crlfDelay: Infinity
  });

  try {
    for await (const rawLine of rl) {
      const line = rawLine.trim();
      if (!line) continue;

      const normalized = utils.stripDiacriticsAndNoise(line);
      console.info(`\n=== Processing "${line}" (normalized: "${normalized}") ===`);
      try {
        await processRagam(normalized);
      } catch (err) {
        console.error(`Error processing "${line}":`, err?.stack || err);
        throw err;
      }
    }
  } catch (err) {
    console.error('Failed reading input file:', err?.stack || err);
    process.exit(1);
  } finally {
    try {
      await db.closeAsync();
    } catch (e) {
      console.warn('Error closing DB:', e?.message || e);
    }
    console.log('All done.');
  }
})().catch(err => {
  console.error('Fatal error:', err?.stack || err);
  process.exit(1);
});