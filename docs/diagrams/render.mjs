// Renders every src/*.mmd file to output/<name>.png with the locally installed Mermaid CLI.
// Stops at the first failure.
//
// Mermaid CLI drives a headless browser. Instead of letting Puppeteer download its own,
// this uses an installed Chrome or Edge: set CHROME_PATH, or keep one in a default location.
//
// A PNG is otherwise squeezed into an 800 px wide page, which makes wide diagrams unreadable.
// So each diagram is first rendered to SVG to read its natural size, then to PNG at twice that
// size (--size caps the longer side).

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const PIXEL_RATIO = 2;

const here = fileURLToPath(new URL(".", import.meta.url));
const srcDir = join(here, "src");
const outDir = join(here, "output");
const cli = join(here, "node_modules", "@mermaid-js", "mermaid-cli", "src", "cli.js");

const BROWSER_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

const browser = BROWSER_CANDIDATES.find((path) => path && existsSync(path));
if (!browser) {
  console.error("No Chrome or Edge found. Set CHROME_PATH to a Chromium-based browser.");
  process.exit(1);
}
if (!existsSync(cli)) {
  console.error("Mermaid CLI is not installed. Run npm ci in docs/diagrams first.");
  process.exit(1);
}

const puppeteerConfig = join(tmpdir(), "sixdegrees-mermaid-puppeteer.json");
writeFileSync(puppeteerConfig, JSON.stringify({ executablePath: browser, headless: "shell" }));
mkdirSync(outDir, { recursive: true });

function mermaid(input, output, extra = []) {
  const result = spawnSync(
    process.execPath,
    [
      cli, "--quiet",
      "--input", input,
      "--output", output,
      "--configFile", join(here, "mermaid.config.json"),
      "--puppeteerConfigFile", puppeteerConfig,
      "--backgroundColor", "white",
      ...extra,
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    console.error(`Failed to render ${basename(input)}.`);
    process.exit(result.status ?? 1);
  }
}

function naturalSize(svgPath) {
  const match = readFileSync(svgPath, "utf8").match(/viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/);
  if (!match) {
    console.error(`No viewBox in ${svgPath}.`);
    process.exit(1);
  }
  return { width: Number(match[1]), height: Number(match[2]) };
}

const sources = readdirSync(srcDir).filter((name) => name.endsWith(".mmd")).sort();
for (const name of sources) {
  const input = join(srcDir, name);
  const output = join(outDir, `${basename(name, ".mmd")}.png`);
  const svg = join(tmpdir(), `sixdegrees-${basename(name, ".mmd")}.svg`);
  mermaid(input, svg);
  const { width, height } = naturalSize(svg);
  rmSync(svg, { force: true });
  const size = Math.ceil(Math.max(width, height) * PIXEL_RATIO);
  mermaid(input, output, ["--size", String(size)]);
  console.log(`render ${name} -> output/${basename(output)} (${Math.round(width)} x ${Math.round(height)} at ${PIXEL_RATIO}x)`);
}
console.log(`Rendered ${sources.length} diagrams.`);
