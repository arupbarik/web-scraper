import * as cheerio from "cheerio";
import * as dns from "node:dns/promises";
import * as fs from "node:fs/promises";
import { isIP } from "node:net";
import { URL } from "node:url";
import robotsParser from "robots-parser";

export const USER_AGENT = "web-scraper/1.1 (educational crawler; contact: crawler@example.invalid)";
const DEFAULTS = {
  maxPages: 10,
  maxDepth: 2,
  timeoutMs: 10000,
  delayMs: 250,
  perOriginDelayMs: null,
  maxBodyBytes: 2_000_000,
  maxRedirects: 5,
  maxRetries: 2,
  retryBaseDelayMs: 250,
  retryMaxDelayMs: 10000,
  concurrency: 1,
  perOriginConcurrency: 1,
  maxQueueSize: 1000,
  robotsCacheTtlMs: 900000,
  allowPrivateNetwork: false,
};
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export function normalizeUrl(value, base) {
  let url;
  try { url = new URL(value, base); } catch { return null; }
  if (!["http:", "https:"].includes(url.protocol)) return null;
  url.hash = "";
  if (url.port === (url.protocol === "http:" ? "80" : "443")) url.port = "";
  return url.href;
}

function originOf(url) { return new URL(url).origin; }

function isUnsafeAddress(address) {
  const lower = address.toLowerCase().replace(/^\[|\]$/g, "");
  const version = isIP(lower);
  if (version === 4) {
    const parts = lower.split(".").map(Number);
    return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) ||
      (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) ||
      (parts[0] === 203 && parts[1] === 0 && parts[2] === 113);
  }
  if (version === 6) {
    return lower === "::" || lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb") || lower.startsWith("2001:db8:");
  }
  return false;
}

function isUnsafeHostname(hostname) {
  const lower = hostname.toLowerCase().replace(/\.$/, "");
  return lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local") ||
    lower === "metadata.google.internal" || lower === "metadata" || lower === "instance-data" ||
    lower.endsWith(".internal") || isUnsafeAddress(lower);
}

export function isAllowedUrl(value, config, seedOrigin = originOf(config.startUrl)) {
  const normalized = normalizeUrl(value);
  if (!normalized) return { allowed: false, reason: "unsupported-or-invalid-url" };
  const url = new URL(normalized);
  if (!config.allowPrivateNetwork && isUnsafeHostname(url.hostname)) return { allowed: false, reason: "private-network-host" };
  const origins = config.allowedOrigins ?? [seedOrigin];
  if (!origins.includes(url.origin)) return { allowed: false, reason: "outside-scope" };
  return { allowed: true, url: normalized };
}

async function assertNetworkSafe(url, config, signal) {
  if (signal?.aborted) throw signal.reason ?? new Error("Crawl cancelled");
  if (config.allowPrivateNetwork) return;
  const parsed = new URL(url);
  if (isUnsafeHostname(parsed.hostname)) throw Object.assign(new Error(`Network destination rejected: ${parsed.hostname}`), { type: "SsrfPolicyError" });
  if (isIP(parsed.hostname)) return;
  let addresses;
  try { addresses = await dns.lookup(parsed.hostname, { all: true, verbatim: true, signal }); } catch (error) {
    throw Object.assign(new Error(`DNS resolution failed for ${parsed.hostname}: ${error.message}`), { type: "DnsError" });
  }
  if (!addresses.length || addresses.some((entry) => isUnsafeAddress(entry.address))) {
    throw Object.assign(new Error(`DNS destination rejected for ${parsed.hostname}`), { type: "SsrfPolicyError" });
  }
}

export function extractLinks(html, baseUrl, selector = "a") {
  const $ = cheerio.load(html);
  const links = [];
  $(selector).each((_, element) => {
    const href = $(element).attr("href");
    const normalized = href ? normalizeUrl(href, baseUrl) : null;
    if (normalized && !links.includes(normalized)) links.push(normalized);
  });
  return links;
}

function extractText($, selector) { return $(selector).map((_, element) => $(element).text().trim()).get(); }

export function extractPage(html, pageUrl, selectors = [], generic = true) {
  const $ = cheerio.load(html);
  const result = {
    title: $("title").first().text().trim() || null,
    metaDescription: $("meta[name='description']").attr("content")?.trim() || null,
    headings: extractText($, "h1,h2,h3,h4,h5,h6"),
    paragraphs: extractText($, "p"),
    links: extractLinks(html, pageUrl),
    custom: {},
  };
  if (!generic) { delete result.title; delete result.metaDescription; delete result.headings; delete result.paragraphs; }
  for (const field of selectors) {
    if (!field || typeof field.field !== "string" || typeof field.selector !== "string" || !["text", "link"].includes(field.type)) continue;
    result.custom[field.field] = field.type === "link" ? extractLinks(html, pageUrl, field.selector) : extractText($, field.selector);
  }
  return result;
}

function errorRecord(error, url, httpStatus = null) {
  return { type: error.type ?? error.name ?? "Error", message: error.message, failedUrl: url, httpStatus };
}

function retryAfterMs(response, fallback) {
  const value = response.headers.get("retry-after");
  if (!value) return fallback;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : fallback;
}

function wait(ms, signal) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); signal.removeEventListener("abort", onAbort); reject(signal.reason ?? new Error("Crawl cancelled")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function readBody(response, maxBytes, signal) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw Object.assign(new Error(`Response exceeds ${maxBytes} bytes`), { type: "ResponseTooLargeError" });
      chunks.push(value);
      if (signal?.aborted) throw signal.reason ?? new Error("Crawl cancelled");
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return Buffer.from(body).toString("utf8");
}

async function requestOnce(url, config, signal) {
  if (signal?.aborted) throw signal.reason ?? new Error("Crawl cancelled");
  await assertNetworkSafe(url, config, signal);
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason ?? new Error("Crawl cancelled"));
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(Object.assign(new Error(`Request timed out after ${config.timeoutMs}ms`), { type: "TimeoutError" })), config.timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, redirect: "manual", headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" } });
  } catch (error) {
    if (controller.signal.reason?.type === "TimeoutError") throw controller.signal.reason;
    if (signal?.aborted) throw signal.reason ?? error;
    if (error.name === "AbortError") throw Object.assign(new Error(`Request timed out after ${config.timeoutMs}ms`), { type: "TimeoutError" });
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

async function fetchWithRetry(url, config, signal, metrics) {
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    try {
      const response = await requestOnce(url, config, signal);
      if (response.status >= 300 && response.status < 400) return { response, attempt };
      if (!response.ok && RETRYABLE_STATUSES.has(response.status) && attempt < config.maxRetries) {
        await response.body?.cancel();
        const exponential = Math.min(config.retryMaxDelayMs, config.retryBaseDelayMs * (2 ** attempt));
        const jitter = Math.floor(Math.random() * Math.max(1, exponential * 0.25));
        await wait(Math.min(config.retryMaxDelayMs, Math.max(exponential + jitter, retryAfterMs(response, exponential))), signal);
        metrics.retries += 1;
        continue;
      }
      return { response, attempt };
    } catch (error) {
      if (signal?.aborted || error.type === "SsrfPolicyError" || error.type === "DnsError" || attempt >= config.maxRetries) throw error;
      const exponential = Math.min(config.retryMaxDelayMs, config.retryBaseDelayMs * (2 ** attempt));
      await wait(exponential + Math.floor(Math.random() * Math.max(1, exponential * 0.25)), signal);
      metrics.retries += 1;
    }
  }
  throw new Error("Retry loop exhausted");
}

async function fetchPage(url, config, signal, metrics) {
  let current = url;
  let attempts = 0;
  for (let redirect = 0; redirect <= config.maxRedirects; redirect += 1) {
    const { response, attempt } = await fetchWithRetry(current, config, signal, metrics);
    attempts += attempt + 1;
    metrics.attempts += attempt + 1;
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const destination = normalizeUrl(response.headers.get("location"), current);
      const check = destination && isAllowedUrl(destination, config, originOf(config.startUrl));
      if (!check?.allowed) throw Object.assign(new Error(`Redirect rejected: ${check?.reason ?? "invalid destination"}`), { type: "RedirectPolicyError", httpStatus: response.status });
      await assertNetworkSafe(destination, config, signal);
      current = destination;
      continue;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error(`HTTP ${response.status}`), { type: "HttpError", httpStatus: response.status }); }
    if (!contentType.toLowerCase().includes("text/html") && !contentType.toLowerCase().includes("application/xhtml+xml")) { await response.body?.cancel(); throw Object.assign(new Error(`Unsupported content type: ${contentType || "unknown"}`), { type: "ContentTypeError", httpStatus: response.status }); }
    return { html: await readBody(response, config.maxBodyBytes, signal), status: response.status, finalUrl: current, attempts };
  }
  throw Object.assign(new Error(`Too many redirects (maximum ${config.maxRedirects})`), { type: "RedirectError" });
}

async function getRobots(origin, config, cache, metrics, signal) {
  const existing = cache.get(origin);
  if (existing && existing.expiresAt > Date.now()) return existing.policy;
  if (existing?.promise) return existing.promise;
  const robotsUrl = `${origin}/robots.txt`;
  const promise = (async () => {
    let policy;
    try {
      const response = await requestOnce(robotsUrl, config, signal);
      if (response.status === 404) policy = robotsParser(robotsUrl, "");
      else if (response.ok) policy = robotsParser(robotsUrl, await readBody(response, config.maxBodyBytes, signal));
      else { await response.body?.cancel(); throw new Error(`robots.txt HTTP ${response.status}`); }
      for (const sitemap of policy.getSitemaps?.() ?? []) if (!metrics.sitemaps.includes(sitemap)) metrics.sitemaps.push(sitemap);
      metrics.robotsRequests += 1;
    } catch (error) {
      metrics.robotsFailures += 1;
      metrics.logs.push(errorRecord(Object.assign(new Error(`Robots retrieval failed: ${error.message}; origin denied conservatively`), { type: "RobotsError" }), robotsUrl));
      policy = null;
    }
    cache.set(origin, { policy, expiresAt: Date.now() + config.robotsCacheTtlMs });
    return policy;
  })();
  cache.set(origin, { promise, expiresAt: Date.now() + config.robotsCacheTtlMs });
  return promise;
}

class OriginScheduler {
  constructor(config) { this.config = config; this.states = new Map(); }
  state(origin) { if (!this.states.has(origin)) this.states.set(origin, { active: 0, nextAt: 0 }); return this.states.get(origin); }
  canAcquire(origin) { return this.state(origin).active < this.config.perOriginConcurrency; }
  async acquire(origin, signal, minimumDelay = 0) {
    const state = this.state(origin);
    while (state.active >= this.config.perOriginConcurrency) await wait(10, signal);
    const now = Date.now();
    const delay = Math.max(this.config.perOriginDelayMs ?? this.config.delayMs, minimumDelay);
    const pause = Math.max(0, state.nextAt - now);
    state.active += 1;
    state.nextAt = Math.max(now, state.nextAt) + delay;
    try { await wait(pause, signal); } catch (error) { state.active -= 1; throw error; }
    return () => { state.active -= 1; };
  }
}

function csvEscape(value) { const text = Array.isArray(value) || typeof value === "object" ? JSON.stringify(value ?? "") : String(value ?? ""); return `"${text.replaceAll('"', '""')}"`; }

export function validateConfig(input) {
  const config = { ...DEFAULTS, ...input };
  if (!config.startUrl || !normalizeUrl(config.startUrl)) throw new Error("startUrl must be a valid HTTP or HTTPS URL");
  for (const [key, min] of [["maxPages", 1], ["maxDepth", 0], ["timeoutMs", 1], ["delayMs", 0], ["maxBodyBytes", 1], ["maxRedirects", 0], ["maxRetries", 0], ["retryBaseDelayMs", 0], ["retryMaxDelayMs", 0], ["concurrency", 1], ["perOriginConcurrency", 1], ["maxQueueSize", 1], ["robotsCacheTtlMs", 0]]) {
    if (!Number.isInteger(Number(config[key])) || Number(config[key]) < min) throw new Error(`${key} must be an integer >= ${min}`);
  }
  config.startUrl = normalizeUrl(config.startUrl);
  for (const key of ["maxPages", "maxDepth", "timeoutMs", "delayMs", "maxBodyBytes", "maxRedirects", "maxRetries", "retryBaseDelayMs", "retryMaxDelayMs", "concurrency", "perOriginConcurrency", "maxQueueSize", "robotsCacheTtlMs"]) config[key] = Number(config[key]);
  if (config.allowedOrigins !== undefined) {
    if (!Array.isArray(config.allowedOrigins) || config.allowedOrigins.length === 0) throw new Error("allowedOrigins must be a non-empty array");
    config.allowedOrigins = config.allowedOrigins.map((origin) => {
      let parsed;
      try { parsed = new URL(origin); } catch { throw new Error(`Invalid allowed origin: ${origin}`); }
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.href !== `${parsed.origin}/`) throw new Error(`allowedOrigins must contain origins without paths: ${origin}`);
      return parsed.origin;
    });
  }
  if (config.perOriginDelayMs !== null && config.perOriginDelayMs !== undefined) {
    if (!Number.isInteger(Number(config.perOriginDelayMs)) || Number(config.perOriginDelayMs) < 0) throw new Error("perOriginDelayMs must be an integer >= 0");
    config.perOriginDelayMs = Number(config.perOriginDelayMs);
  }
  if (config.retryMaxDelayMs < config.retryBaseDelayMs) throw new Error("retryMaxDelayMs must be >= retryBaseDelayMs");
  return config;
}

export async function crawl(input) {
  const config = validateConfig(input);
  const start = Date.now();
  const seedOrigin = originOf(config.startUrl);
  const seedCheck = isAllowedUrl(config.startUrl, config, seedOrigin);
  if (!seedCheck.allowed) throw new Error(`Starting URL rejected: ${seedCheck.reason}`);
  await assertNetworkSafe(config.startUrl, config, input.signal);
  const queue = [{ url: config.startUrl, depth: 0 }];
  const scheduled = new Set([config.startUrl]);
  const extractedDataUrls = [];
  const allEligibleUrls = [config.startUrl];
  const results = [];
  const metrics = { logs: [], retries: 0, attempts: 0, robotsRequests: 0, robotsFailures: 0, sitemaps: [], excludedUrls: 0, duplicateUrls: 0, maxQueueObserved: 1 };
  const robots = new Map();
  const scheduler = new OriginScheduler(config);
  const signal = input.signal;
  let stopped = false;
  let cancelled = false;

  const processOne = async (item) => {
    const policy = await getRobots(originOf(item.url), config, robots, metrics, signal);
    if (!policy || policy.isAllowed(item.url, USER_AGENT) === false) {
      metrics.logs.push({ type: "RobotsDenied", message: "URL disallowed by robots.txt", failedUrl: item.url, httpStatus: null });
      return;
    }
    const robotsDelay = Number(policy.getCrawlDelay?.(USER_AGENT) ?? 0) * 1000;
    const release = await scheduler.acquire(originOf(item.url), signal, robotsDelay);
    try {
      const page = await fetchPage(item.url, config, signal, metrics);
      const extracted = extractPage(page.html, page.finalUrl, config.selectors ?? [], config.generic !== false);
      const links = extracted.links ?? [];
      let queued = 0;
      if (item.depth < config.maxDepth) for (const link of links) {
        const check = isAllowedUrl(link, config, seedOrigin);
        if (!check.allowed) { metrics.excludedUrls += 1; continue; }
        if (scheduled.has(check.url)) { metrics.duplicateUrls += 1; continue; }
        if (queue.length >= config.maxQueueSize || scheduled.size >= config.maxPages) { metrics.excludedUrls += 1; continue; }
        const linkPolicy = await getRobots(originOf(check.url), config, robots, metrics, signal);
        if (!linkPolicy || linkPolicy.isAllowed(check.url, USER_AGENT) === false) continue;
        scheduled.add(check.url); queue.push({ url: check.url, depth: item.depth + 1 }); allEligibleUrls.push(check.url); queued += 1;
        metrics.maxQueueObserved = Math.max(metrics.maxQueueObserved, queue.length);
      }
      results.push({ requestedUrl: item.url, finalUrl: page.finalUrl, depth: item.depth, status: "succeeded", httpStatus: page.status, extracted, linksFound: links.length, linksQueued: queued, attempts: page.attempts, crawledAt: new Date().toISOString(), error: null });
      extractedDataUrls.push(item.url);
    } catch (error) {
      if (signal?.aborted) throw error;
      metrics.logs.push(errorRecord(error, item.url, error.httpStatus ?? null));
      results.push({ requestedUrl: item.url, finalUrl: null, depth: item.depth, status: "failed", httpStatus: error.httpStatus ?? null, extracted: null, linksFound: 0, linksQueued: 0, attempts: error.attempts ?? null, crawledAt: new Date().toISOString(), error: errorRecord(error, item.url, error.httpStatus ?? null) });
    } finally { release(); }
  };

  let activeTasks = 0;
  const worker = async () => {
    while (!stopped && !signal?.aborted) {
      const itemIndex = queue.findIndex((candidate) => scheduler.canAcquire(originOf(candidate.url)));
      const item = itemIndex === -1 ? null : queue.splice(itemIndex, 1)[0];
      if (!item) {
        if (activeTasks === 0 && queue.length === 0) return;
        await wait(5, signal);
        continue;
      }
      activeTasks += 1;
      try { await processOne(item); } finally { activeTasks -= 1; }
    }
  };
  const workerResults = await Promise.allSettled(Array.from({ length: config.concurrency }, () => worker()));
  const unexpected = workerResults.find((result) => result.status === "rejected");
  if (unexpected) {
    stopped = true;
    if (signal?.aborted) cancelled = true;
    else metrics.logs.push(errorRecord(unexpected.reason, config.startUrl));
  }
  return {
    results, logs: metrics.logs, allEligibleUrls, extractedDataUrls,
    summary: {
      startUrl: config.startUrl, startedAt: new Date(start).toISOString(), finishedAt: new Date().toISOString(), durationMs: Date.now() - start,
      attemptedPages: results.length, successfulPages: results.filter((r) => r.status === "succeeded").length, failedPages: results.filter((r) => r.status === "failed").length,
      discoveredUrls: allEligibleUrls.length, excludedUrls: metrics.excludedUrls, duplicateUrls: metrics.duplicateUrls, retries: metrics.retries, requestAttempts: metrics.attempts,
      robotsRequests: metrics.robotsRequests, robotsFailures: metrics.robotsFailures, sitemapUrls: metrics.sitemaps, maxQueueObserved: metrics.maxQueueObserved, concurrency: config.concurrency, cancelled,
    },
  };
}

export async function writeOutput(report, outputDir, options = {}) {
  await fs.mkdir(outputDir, { recursive: true });
  const paths = { logs: `${outputDir}/logs.json`, allEligibleUrls: `${outputDir}/all_eligible_urls.json`, extractedDataUrls: `${outputDir}/extracted_data_urls.json`, data: `${outputDir}/data.json` };
  await fs.writeFile(paths.logs, JSON.stringify(report.logs, null, 2));
  await fs.writeFile(paths.allEligibleUrls, JSON.stringify(report.allEligibleUrls, null, 2));
  await fs.writeFile(paths.extractedDataUrls, JSON.stringify(report.extractedDataUrls, null, 2));
  await fs.writeFile(paths.data, JSON.stringify({ summary: report.summary, pages: report.results }, null, 2));
  if (options.csv) { paths.csv = `${outputDir}/data.csv`; const columns = ["requestedUrl", "finalUrl", "depth", "status", "httpStatus", "linksFound", "linksQueued", "attempts", "error"]; await fs.writeFile(paths.csv, `${columns.join(",")}\n${report.results.map((row) => columns.map((column) => csvEscape(row[column])).join(",")).join("\n")}\n`); }
  return paths;
}
