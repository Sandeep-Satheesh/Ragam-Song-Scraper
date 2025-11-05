# Ragam SE Scraper (Node.js + se-scraper) - sqlite3 patch
Tries to scrape information on songs of a particular ragam

Quick start:
1. Install Node 24.10.0 and npm.
2. `npm install` (se-scraper must be installed from GitHub; see package.json)
3. Set OLLAMA_API_KEY as an environment variable, with the Ollama API key's value
4. Usage: `node src/index.js --ragam "<your ragam name>" --seeds <path to seeds.txt> --max-pages <number of pages>`
