const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

const INPUT = path.join(__dirname, "processed", "tlcas-clean.txt");
const OUTPUT_DIR = path.join(__dirname, "processed");
const OUTPUT = path.join(OUTPUT_DIR, "tlcas-review.txt");

const MAX_CANDIDATES = 5000;
const MIN_WORDS = 3;
const MAX_WORDS = 15;
const MAX_CHARS = 100;

function isCandidate(text) {
  const words = text.split(/\s+/);

  if (text.length > MAX_CHARS) return false;
  if (words.length < MIN_WORDS || words.length > MAX_WORDS) {
    return false;
  }

  if (/https?:\/\/|www\.|deleted|removed/i.test(text)) {
    return false;
  }

  // Exclude lines that contain no letters.
  if (!/\p{L}/u.test(text)) return false;

  return true;
}

async function main() {
  if (!fs.existsSync(INPUT)) {
    throw new Error(`Cleaned corpus not found: ${INPUT}`);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const reader = readline.createInterface({
    input: fs.createReadStream(INPUT, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  // Reservoir sampling selects candidates from across the whole file.
  const reservoir = [];
  let eligible = 0;

  for await (const rawLine of reader) {
    const text = rawLine.trim();

    if (!isCandidate(text)) continue;

    eligible++;

    const item = { text };

    if (reservoir.length < MAX_CANDIDATES) {
      reservoir.push(item);
      continue;
    }

    const index = Math.floor(Math.random() * eligible);

    if (index < MAX_CANDIDATES) {
      reservoir[index] = item;
    }
  }

  const output = reservoir.map((item) => item.text).join("\n");

  fs.writeFileSync(OUTPUT, output ? `${output}\n` : "", "utf8");

  console.log("Candidate extraction complete.");
  console.log(`Eligible phrases: ${eligible}`);
  console.log(`Candidates saved: ${reservoir.length}`);
  console.log(`Output: ${OUTPUT}`);
}

main().catch((error) => {
  console.error("[TLCAS Candidate Extractor]", error);
  process.exitCode = 1;
});
