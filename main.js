#!/usr/bin/env node

import PromptSync from "prompt-sync";
import { crawl, writeOutput, validateConfig } from "./src/crawler.js";

const prompt = PromptSync();

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;
    const key = argument.slice(2).replaceAll("-", "_");
    args[key] = argv[index + 1]?.startsWith("--") ? true : argv[index + 1];
    if (args[key] !== true) index += 1;
  }
  return args;
}

function selectorsFromJson(value) {
  if (!value) return [];
  const selectors = JSON.parse(value);
  if (!Array.isArray(selectors)) throw new Error("--selectors must be a JSON array");
  return selectors;
}

function originsFromJson(value) {
  if (!value) return undefined;
  const origins = JSON.parse(value);
  if (!Array.isArray(origins) || origins.some((origin) => typeof origin !== "string")) throw new Error("--allowed-origins must be a JSON array of origin strings");
  return origins;
}

function interactiveConfig() {
  const url = prompt("Enter your URL: ").trim();
  const maxPages = prompt("Maximum pages [10]: ").trim() || "10";
  const maxDepth = prompt("Maximum depth [2]: ").trim() || "2";
  const custom = (prompt("Use custom selectors? (y/n) [n]: ").trim().toLowerCase() || "n") === "y";
  const selectors = [];
  if (custom) {
    do {
      selectors.push({
        field: prompt("Field name: ").trim(),
        selector: prompt("CSS selector: ").trim(),
        type: prompt("Type (text/link): ").trim().toLowerCase(),
      });
    } while ((prompt("Add another field? (y/n) [n]: ").trim().toLowerCase() || "n") === "y");
  }
  return { url, maxPages, maxDepth, selectors };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const interactive = !args.url;
  const input = interactive ? interactiveConfig() : args;
  const config = {
    startUrl: input.url,
    maxPages: input.max_pages ?? input.maxPages,
    maxDepth: input.max_depth ?? input.maxDepth,
    timeoutMs: input.timeout_ms ?? input.timeoutMs,
    delayMs: input.delay_ms ?? input.delayMs,
    outputDir: input.output_dir ?? input.outputDir ?? "result",
    selectors: interactive ? input.selectors : selectorsFromJson(input.selectors),
    generic: input.generic !== "false",
    maxBodyBytes: input.max_body_bytes ?? input.maxBodyBytes,
    concurrency: input.concurrency,
    perOriginConcurrency: input.per_origin_concurrency ?? input.perOriginConcurrency,
    perOriginDelayMs: input.per_origin_delay_ms ?? input.perOriginDelayMs,
    maxQueueSize: input.max_queue_size ?? input.maxQueueSize,
    maxRetries: input.max_retries ?? input.maxRetries,
    retryBaseDelayMs: input.retry_base_delay_ms ?? input.retryBaseDelayMs,
    retryMaxDelayMs: input.retry_max_delay_ms ?? input.retryMaxDelayMs,
    robotsCacheTtlMs: input.robots_cache_ttl_ms ?? input.robotsCacheTtlMs,
    allowedOrigins: interactive ? undefined : originsFromJson(input.allowed_origins ?? input.allowedOrigins),
    allowPrivateNetwork: input.allow_private_network === true || input.allowPrivateNetwork === "true",
  };
  const controller = new AbortController();
  const stop = () => { if (!controller.signal.aborted) { console.error("Shutdown requested; finishing current work..."); controller.abort(new Error("Crawl cancelled by user")); } };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  validateConfig(config);
  let report;
  try { report = await crawl({ ...config, signal: controller.signal }); }
  finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
  const files = await writeOutput(report, config.outputDir, { csv: input.csv === true || input.csv === "true" });
  console.log(`Crawl completed: ${report.summary.attemptedPages} attempted, ${report.summary.successfulPages} successful, ${report.summary.failedPages} failed`);
  console.log(`Results: ${files.data}`);
  if (report.summary.cancelled) process.exitCode = 130;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`Configuration/crawl error: ${error.message}`);
    process.exitCode = 1;
  });
}

export { main, parseArgs };
