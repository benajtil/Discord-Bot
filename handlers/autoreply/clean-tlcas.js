const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

const INPUT_DIR = path.join(__dirname, "tlcas-main", "tlcas-main");
const OUTPUT_DIR = path.join(__dirname, "processed");

const OUTPUT_FILE = path.join(OUTPUT_DIR, "tlcas-clean.txt");
const STATS_FILE = path.join(OUTPUT_DIR, "tlcas-stats.json");

const MIN_CHARS = 5;
const MAX_CHARS = 250;
const MIN_WORDS = 2;
const MAX_WORDS = 40;

function normalizeText(text) {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("fil-PH")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function splitIntoSamples(text) {
  return text
    .split(/(?<=[.!?])\s+(?=[\p{L}\p{N}"'(])/u)
    .map(normalizeText)
    .filter(Boolean);
}

function isUsableLine(line) {
  if (line.length < MIN_CHARS || line.length > MAX_CHARS) {
    return false;
  }

  const words = line.split(/\s+/);

  if (words.length < MIN_WORDS || words.length > MAX_WORDS) {
    return false;
  }

  if (/https?:\/\/|www\./i.test(line)) {
    return false;
  }

  if (/^(deleted|removed|edited by author)\b/i.test(line)) {
    return false;
  }

  if (!/\p{L}/u.test(line)) {
    return false;
  }

  return true;
}

function collectTextFiles(directory) {
  if (!fs.existsSync(directory)) {
    throw new Error(`Input directory not found: ${directory}`);
  }

  const files = [];

  for (const entry of fs.readdirSync(directory, {
    withFileTypes: true,
  })) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectTextFiles(fullPath));
    } else if (entry.isFile() && /\.txt$/i.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

async function main() {
  const files = collectTextFiles(INPUT_DIR);

  if (files.length === 0) {
    throw new Error("No .txt files found.");
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const seen = new Set();

  const stats = {
    filesScanned: 0,
    physicalLinesRead: 0,
    samplesCreated: 0,
    kept: 0,
    duplicates: 0,
    rejected: 0,
  };

  const output = fs.createWriteStream(OUTPUT_FILE, {
    encoding: "utf8",
  });

  try {
    for (const file of files) {
      console.log(`Processing: ${path.basename(file)}`);

      const input = fs.createReadStream(file, {
        encoding: "utf8",
      });

      const reader = readline.createInterface({
        input,
        crlfDelay: Infinity,
      });

      for await (const rawLine of reader) {
        stats.physicalLinesRead++;

        // Split long corpus lines into smaller samples.
        const samples = splitIntoSamples(rawLine);

        for (const sample of samples) {
          stats.samplesCreated++;

          if (!isUsableLine(sample)) {
            stats.rejected++;
            continue;
          }

          if (seen.has(sample)) {
            stats.duplicates++;
            continue;
          }

          seen.add(sample);
          output.write(`${sample}\n`);
          stats.kept++;
        }
      }

      stats.filesScanned++;
    }
  } finally {
    output.end();
  }

  await new Promise((resolve, reject) => {
    output.once("finish", resolve);
    output.once("error", reject);
  });

  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2), "utf8");

  console.log("\nTLCAS cleaning complete!");
  console.log(stats);
  console.log(`\nOutput: ${OUTPUT_FILE}`);
  console.log(`Statistics: ${STATS_FILE}`);
}

main().catch((error) => {
  console.error("[TLCAS Cleaner]", error);
  process.exitCode = 1;
});
