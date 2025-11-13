// db.js
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');
const path = require('path');
const { Semaphore } = require('./utils'); // <- uses the provided Semaphore class

const DB_PATH = process.env.RAGAM_DB || path.join(process.cwd(), 'scraper.db');

let db = null;

function createDB() {
  if (db) return db;

  db = new sqlite3.Database(DB_PATH);

  // promisify commonly used methods and attach to db
  db.runAsync = promisify(db.run.bind(db));
  db.getAsync = promisify(db.get.bind(db));
  db.allAsync = promisify(db.all.bind(db));
  db.execAsync = promisify(db.exec.bind(db));
  db.closeAsync = promisify(db.close.bind(db));

  // single-writer semaphore
  const writeLock = new Semaphore(1);

  db.serialize(() => {
    // enforce FK constraints
    db.run(`PRAGMA foreign_keys = ON;`);

    // inferences_metadata
    db.run(`
      CREATE TABLE IF NOT EXISTS inferences_metadata (
        inference_id INTEGER PRIMARY KEY,
        model_name TEXT NOT NULL,
        prompt_txt TEXT NOT NULL,
        thinking_txt TEXT NOT NULL,
        insert_tmstmp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Entry for manually scraped YouTube videos
    db.run(`
      INSERT OR IGNORE INTO inferences_metadata (inference_id, model_name, prompt_txt, thinking_txt) VALUES (-1, '', '', '');
    `);

    // songs_extracted
    db.run(`
      CREATE TABLE IF NOT EXISTS songs_extracted (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        ragam_canonical TEXT NOT NULL,
        ragam_identified TEXT NOT NULL,
        context_snippet TEXT,
        source_url TEXT NOT NULL,
        song_url TEXT,
        confidence NUMBER NOT NULL,
        inference_id INTEGER NOT NULL,
        discover_tmstmp DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(title, source_url),
        FOREIGN KEY (inference_id)
          REFERENCES inferences_metadata(inference_id)
          ON DELETE CASCADE
          ON UPDATE CASCADE
      );
    `);

    // pages
    db.run(`
      CREATE TABLE IF NOT EXISTS pages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        raw_url TEXT UNIQUE NOT NULL,
        final_url TEXT UNIQUE,
        scanned_ragam TEXT NOT NULL,
        parse_status TEXT NOT NULL DEFAULT 'pending',
        scrape_tmstmp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  });

  /**
   * Returns integer count of rows in inferences_metadata
   */
  db.getInferenceCount = async function () {
    const row = await this.getAsync(`SELECT COUNT(*) AS count FROM inferences_metadata;`);
    return (row && row.count) ? row.count : 0;
  };

  db.getUnparsedURLs = async function (ragam) {
    const rows = await this.allAsync(
      `SELECT raw_url AS raw_url FROM pages WHERE parse_status <> 'parsed' AND scanned_ragam = ? ORDER BY scrape_tmstmp DESC;`,
      [ragam]
    );
    if (!rows) return [];
    return rows.map(r => r.raw_url);
  };

  /**
   * Update parse_status for a given url and optional ragam.
   * Uses semaphore for write safety.
   */
  db.updateParseStatus = async function (raw_url, status, ragam = null) {
    if (!raw_url || !status) throw new Error('updateParseStatus: raw_url and status are required');

    await writeLock.acquire();
    try {
      if (ragam) {
        await this.runAsync(
          `UPDATE pages SET parse_status = ?, scrape_tmstmp = CURRENT_TIMESTAMP WHERE raw_url = ? AND scanned_ragam = ?;`,
          [status, raw_url, ragam]
        );
      } else {
        await this.runAsync(
          `UPDATE pages SET parse_status = ?, scrape_tmstmp = CURRENT_TIMESTAMP WHERE raw_url = ?;`,
          [status, raw_url]
        );
      }
      return true;
    } finally {
      writeLock.release();
    }
  };

  /**
   * Update final_url for a given raw_url
   */
  db.updateFinalUrl = async function (finalUrl, rawUrl) {
    if (!rawUrl || !finalUrl) throw new Error('updateFinalUrl: url and finalUrl are required');

    await writeLock.acquire();
    try {
      await this.runAsync(
        `UPDATE pages SET final_url = ?, scrape_tmstmp = CURRENT_TIMESTAMP WHERE raw_url = ?;`,
        [finalUrl, rawUrl]
      );
      return true;
    } finally {
      writeLock.release();
    }
  };

  /**
   * Insert a pages row. idempotent due to UNIQUE(raw_url).
   */
  db.insertPageRaw = async function (rawUrl, ragam, parseStatus = 'pending') {
    if (!rawUrl || !ragam) throw new Error('insertPageRaw: rawUrl and ragam are required');

    await writeLock.acquire();
    try {
      await this.runAsync(
        `INSERT OR IGNORE INTO pages (raw_url, scanned_ragam, parse_status) VALUES (?, ?, ?);`,
        [rawUrl, ragam, parseStatus]
      );
      return true;
    } finally {
      writeLock.release();
    }
  };

  /**
   * Insert a metadata row (uses provided inference_id)
   */
  db.insertInference = async function (inferenceMeta) {
    if (!Number.isInteger(inferenceMeta.inference_id)) throw new Error('insertInference: inference_id not found!');

    await writeLock.acquire();
    try {
      await this.runAsync(
        `INSERT INTO inferences_metadata (inference_id, model_name, prompt_txt, thinking_txt) VALUES (?, ?, ?, ?);`,
        [inferenceMeta.inference_id, inferenceMeta.model_name || '', inferenceMeta.prompt || '', inferenceMeta.thinking || '']
      );
      return true;
    } finally {
      writeLock.release();
    }
  };

  /**
   * Insert a song result into songs_extracted. Expects inference_id integer.
   */
  db.insertSong = async function (song) {
    const title = (song.title || '').trim();
    if (!title) throw new Error('insertSong: title is required');
    const inference_id = Number.isInteger(song.inference_id) ? song.inference_id : null;
    if (inference_id === null) throw new Error('insertSong: inference_id (int) is required');

    const ragam_canonical = song.ragam_canonical != null ? song.ragam_canonical : '';
    const ragam_identified = song.ragam_identified != null ? song.ragam_identified : '';
    const context_snippet = song.context_snippet || null;
    const source_url = song.source_url;
    const song_url = song.song_link || song.song_url;
    const confidence = typeof song.confidence === 'number' ? song.confidence : 0;

    await writeLock.acquire();
    try {
      await this.runAsync(
        `INSERT INTO songs_extracted
         (title, ragam_canonical, ragam_identified, context_snippet, source_url, song_url, confidence, inference_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        [title, ragam_canonical, ragam_identified, context_snippet, source_url, song_url, confidence, inference_id]
      );
      return true;
    } finally {
      writeLock.release();
    }
  };

  db.deleteByOriginalUrl = async function (originalUrl, ragam) {
    if (!originalUrl) throw new Error('passed URL is not valid!');
    if (!ragam) throw new Error('passed ragam is not valid!');

    await writeLock.acquire();
    try {
      await this.runAsync(
        `DELETE FROM pages WHERE raw_url = ? AND scanned_ragam = ?`,
        [originalUrl, ragam]
      );
      return true;
    } finally {
      writeLock.release();
    }
  };

  db.finalUrlExists = async function (finalUrl, ragam) {
    if (!finalUrl) throw new Error('passed URL is not valid!');
    if (!ragam) throw new Error('passed ragam is not valid!');

    const row = await this.getAsync(
      `SELECT final_url FROM pages WHERE final_url = ? AND scanned_ragam = ?`,
      [finalUrl, ragam]
    );
    return row && row.final_url ? (row.final_url) === finalUrl : false;
  };

  /**
   * Persist parsed output. Acquire lock once and perform all writes inside transaction.
   * This function duplicates the lower-level SQL to avoid nested lock deadlocks.
   */
  db.persistParsedOutput = async function (originalUrl, finalUrl, inferenceMeta, results) {
    await writeLock.acquire();
    try {
      // begin TX
      await this.runAsync(`BEGIN TRANSACTION;`);

      try {
        // determine inferenceCounter
        let inferenceCounter = null;

        if (inferenceMeta && Number.isInteger(inferenceMeta.inference_id)) {
          inferenceCounter = inferenceMeta.inference_id;
        } else if (inferenceMeta) {
          inferenceCounter = await db.getInferenceCount();
          inferenceCounter += 1;
        } else if (results && results.length > 0 && Number.isInteger(results[0].inference_id)) {
          inferenceCounter = results[0].inference_id;
        } else {
          // fallback: next id = count + 1
          inferenceCounter = await db.getInferenceCount();
          inferenceCounter += 1;
        }

        // insert inference meta if provided
        if (inferenceMeta) {
          await this.runAsync(
            `INSERT INTO inferences_metadata (inference_id, model_name, prompt_txt, thinking_txt) VALUES (?, ?, ?, ?);`,
            [inferenceCounter, inferenceMeta.model_name || '', inferenceMeta.prompt || '', inferenceMeta.thinking || '']
          );
        }

        // insert songs
        for (const r of results || []) {
          const title = (r.title || '').trim();
          if (!title) continue; // skip invalid
          const ragam_canonical = r.ragam_canonical != null ? r.ragam_canonical : '';
          const ragam_identified = r.ragam_identified != null ? r.ragam_identified : '';
          const context_snippet = r.context_snippet || null;
          const source_url = r.source_url;
          const song_url = r.song_link || r.song_url;
          const confidence = typeof r.confidence === 'number' ? r.confidence : 0;

          await this.runAsync(
            `INSERT INTO songs_extracted
             (title, ragam_canonical, ragam_identified, context_snippet, source_url, song_url, confidence, inference_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
            [title, ragam_canonical, ragam_identified, context_snippet, source_url, song_url, confidence, inferenceCounter]
          );
        }

        // write state to pages
        await this.runAsync(
          `UPDATE pages SET final_url = ?, scrape_tmstmp = CURRENT_TIMESTAMP WHERE raw_url = ?;`,
          [finalUrl, originalUrl]
        );

        await this.runAsync(
          `UPDATE pages SET parse_status = ?, scrape_tmstmp = CURRENT_TIMESTAMP WHERE raw_url = ?;`,
          ['parsed', originalUrl]
        );

        await this.runAsync(`COMMIT;`);
      } catch (err) {
        await this.runAsync(`ROLLBACK;`);
        throw err;
      }

    } finally {
      writeLock.release();
    }
  };

  return db;
}

module.exports = createDB();
