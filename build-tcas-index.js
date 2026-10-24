const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const Database = require("better-sqlite3");

const SOURCE = path.join(
  __dirname,
  "handlers",
  "autoreply",
  "processed",
  "tlcas-clean.txt",
);
const DB_DIR = path.join(__dirname, "handlers", "autoreply", "data");
const DB_PATH = path.join(
  __dirname,
  "handlers",
  "autoreply",
  "data",
  "tcas.sqlite",
);
const BATCH_SIZE = 5000;

async function main() {
  if (!fs.existsSync(SOURCE)) {
    throw new Error(`TCAS file not found: ${SOURCE}`);
  }

  fs.mkdirSync(DB_DIR, { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS samples (
      id INTEGER PRIMARY KEY,
      text TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS samples_fts
    USING fts5(text, content='samples', content_rowid='id');
  `);

  const insertSample = db.prepare("INSERT INTO samples (text) VALUES (?)");

  const insertFts = db.prepare(
    "INSERT INTO samples_fts (rowid, text) VALUES (?, ?)",
  );

  const insertBatch = db.transaction((lines) => {
    for (const line of lines) {
      const result = insertSample.run(line);
      insertFts.run(result.lastInsertRowid, line);
    }
  });

  const input = fs.createReadStream(SOURCE, {
    encoding: "utf8",
  });

  const reader = readline.createInterface({
    input,
    crlfDelay: Infinity,
  });

  let batch = [];
  let total = 0;

  try {
    for await (const rawLine of reader) {
      const line = rawLine.trim();

      if (!line) continue;

      batch.push(line);

      if (batch.length >= BATCH_SIZE) {
        insertBatch(batch);
        total += batch.length;
        batch = [];

        if (total % 50000 === 0) {
          console.log(`Indexed ${total.toLocaleString()} samples`);
        }
      }
    }

    if (batch.length) {
      insertBatch(batch);
      total += batch.length;
    }

    console.log(`Finished indexing ${total.toLocaleString()} samples.`);
    console.log(`Database: ${DB_PATH}`);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error("TCAS indexing failed:", error);
  process.exitCode = 1;
});
