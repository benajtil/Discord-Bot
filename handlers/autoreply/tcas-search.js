const path = require("node:path");
const Database = require("better-sqlite3");

const DB_PATH = path.join(__dirname, "data", "tcas.sqlite");

let db;

function getDatabase() {
  if (!db) {
    db = new Database(DB_PATH, {
      readonly: true,
      fileMustExist: true,
    });
  }

  return db;
}

function searchTcas(message, limit = 5) {
  const tokens = String(message)
    .toLowerCase()
    .normalize("NFKC")
    .match(/[\p{L}\p{N}]+/gu);

  if (!tokens) return [];

  const uniqueTokens = [...new Set(tokens)]
    .filter((token) => token.length >= 2)
    .slice(0, 10);

  if (!uniqueTokens.length) return [];

  const query = uniqueTokens
    .map((token) => `"${token.replace(/"/g, '""')}"`)
    .join(" OR ");

  try {
    const rows = getDatabase()
      .prepare(
        `
        SELECT samples.text
        FROM samples_fts
        JOIN samples ON samples.id = samples_fts.rowid
        WHERE samples_fts MATCH ?
        ORDER BY bm25(samples_fts)
        LIMIT ?
      `,
      )
      .all(query, Math.max(1, Math.min((Number(limit) || 5) * 3, 15)));

    return [...new Set(rows.map((row) => row.text))].slice(
      0,
      Math.max(1, Math.min(Number(limit) || 5, 5)),
    );
  } catch (error) {
    console.error("TCAS search failed:", error.message);
    return [];
  }
}

module.exports = { searchTcas };
