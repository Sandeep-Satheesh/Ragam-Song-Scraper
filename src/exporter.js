// exporter.js
// exports all current tables: songs_extracted, inferences_metadata, pages
// expects db.runAsync/getAsync/allAsync/closeAsync

const fs = require('fs').promises;
const path = require('path');

async function exportData(db, ragam) {
  if (!db || typeof db.allAsync !== 'function') {
    throw new Error('exportData: db must expose allAsync()');
  }

  // define all queries
  const queries = {
    songs_extracted: `
      SELECT id,
             title,
             ragam_canonical,
             ragam_identified,
             context_snippet,
             source_url,
             song_url,
             confidence,
             inference_id,
             discover_tmstmp
      FROM songs_extracted
      WHERE LOWER(ragam_canonical) = LOWER('${ragam}')
      ORDER BY discover_tmstmp DESC, id DESC;
    `,
    inferences_metadata: `
      SELECT inference_id,
             model_name,
             prompt_txt,
             thinking_txt,
             insert_tmstmp
      FROM inferences_metadata
      ORDER BY insert_tmstmp DESC, inference_id DESC;
    `,
    pages: `
      SELECT id,
             raw_url,
             final_url,
             scanned_ragam,
             parse_status,
             scrape_tmstmp
      FROM pages
      WHERE LOWER(scanned_ragam) = LOWER('${ragam}')
      ORDER BY scrape_tmstmp DESC, id DESC;
    `
  };

  const results = {};
  for (const [table, query] of Object.entries(queries)) {
    const rows = await db.allAsync(query);
    const folderPath = `output/${ragam}/`;
    await fs.mkdir(folderPath);
    const filePath = `${folderPath}/${table}.json`;
    await fs.writeFile(filePath, JSON.stringify(rows, null, 2), 'utf8');
    console.info(`Exported ${rows.length} rows from ${table} to ${filePath}`);
    results[table] = filePath;
  }

  return results;
}

module.exports = { exportData };