const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');
const path = require('path');
const DB_PATH = process.env.RAGAM_DB || path.join(process.cwd(),'scraper.db');
function initDB(){
  const db = new sqlite3.Database(DB_PATH);
  // promisify commonly used methods
  db.runAsync = promisify(db.run.bind(db));
  db.getAsync = promisify(db.get.bind(db));
  db.allAsync = promisify(db.all.bind(db));
  db.execAsync = promisify(db.exec.bind(db));
  db.closeAsync = promisify(db.close.bind(db));
  db.serialize(()=> {
      db.run(`
      CREATE TABLE IF NOT EXISTS songs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        composer TEXT,
        notes TEXT,
        youtube_link TEXT,
        source_url TEXT NOT NULL,
        ragam TEXT DEFAULT 'TBD',
        discovered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(title, source_url)
      );
    `);
    db.run(`CREATE TABLE IF NOT EXISTS pages(url TEXT PRIMARY KEY, fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  });
  return db;
}
module.exports = { initDB };
