// exporter.js
// exports songs table to JSON using provided db object (expects db.runAsync/getAsync/allAsync/closeAsync)

const fs = require('fs').promises;

async function exportSongs(db, outPath = 'songs_export.json') {
  if (!db || typeof db.allAsync !== 'function') throw new Error('exportSongs: db must expose allAsync()');
  const rows = await db.allAsync('SELECT id,title,composer,notes,youtube_link,source_url,ragam,discovered_at FROM songs ORDER BY discovered_at DESC');
  await fs.writeFile(outPath, JSON.stringify(rows, null, 2), 'utf8');
  console.info(`Exported ${rows.length} songs to ${outPath}`);
  return outPath;
}

module.exports = { exportSongs };
