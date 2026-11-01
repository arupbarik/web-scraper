import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";
import { extractLinks, extractPage, normalizeUrl, crawl, writeOutput } from "../src/crawler.js";

function startServer(externalLink = "") {
  const requests = [];
  let retryCount = 0;
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    response.setHeader("content-type", "text/html; charset=utf-8");
    if (request.url === "/robots.txt") return response.end("User-agent: *\nAllow: /\nDisallow: /blocked\nCrawl-delay: 0\n");
    if (request.url === "/") return response.end(`<!doctype html><title>Home</title><meta name=description content=desc><h1>Welcome</h1><p>Text</p><a href='/one#fragment'>one</a><a href='/one'>duplicate</a><a href='/two'>two</a><a href='mailto:x@y'>bad</a><a>missing</a><a href='/blocked'>blocked</a>${externalLink ? `<a href='${externalLink}'>external</a>` : ""}`);
    if (request.url === "/one") return response.end("<title>One</title><h2>Heading</h2><div class=card>Card</div><a href='/two'>two</a>");
    if (request.url === "/two") return response.end("<title>Two</title><a href='/three'>three</a>");
    if (request.url === "/three") return response.end("<title>Three</title>");
    if (request.url === "/missing") { response.statusCode = 404; return response.end("missing"); }
    if (request.url === "/file") { response.setHeader("content-type", "application/pdf"); return response.end("pdf"); }
    if (request.url === "/slow") return setTimeout(() => response.end("late"), 100);
    if (request.url === "/retry") {
      retryCount += 1;
      if (retryCount === 1) { response.statusCode = 503; return response.end("retry"); }
      return response.end("<title>Recovered</title>");
    }
    response.statusCode = 404;
    response.end("not found");
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, requests, base: `http://127.0.0.1:${server.address().port}` })));
}

function startParallelServer() {
  let active = 0;
  let maximumActive = 0;
  const server = http.createServer((request, response) => {
    if (request.url === "/robots.txt") return response.end("User-agent: *\nAllow: /\n");
    response.setHeader("content-type", "text/html; charset=utf-8");
    if (request.url === "/") return response.end("<a href='/a'>a</a><a href='/b'>b</a>");
    if (["/a", "/b"].includes(request.url)) {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      response.on("finish", () => { active -= 1; });
      return setTimeout(() => response.end(`<title>${request.url}</title>`), 60);
    }
    response.statusCode = 404;
    response.end("missing");
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, getMaximumActive: () => maximumActive, base: `http://127.0.0.1:${server.address().port}` })));
}

test("URL and extraction helpers resolve, normalize, and ignore malformed links", () => {
  assert.equal(normalizeUrl("/page#part", "https://example.test/root"), "https://example.test/page");
  assert.equal(normalizeUrl("mailto:test@example.test", "https://example.test"), null);
  assert.deepEqual(extractLinks("<a href='/a#x'></a><a href='/a'></a><a></a><a href='javascript:x'></a>", "https://example.test"), ["https://example.test/a"]);
  const page = extractPage("<title>T</title><h1>H</h1><a href='/x'>X</a>", "https://example.test");
  assert.deepEqual(page.headings, ["H"]);
  assert.deepEqual(page.links, ["https://example.test/x"]);
});

test("crawler enforces depth, page limit, robots, deduplication, and custom fields", async (t) => {
  const fixture = await startServer();
  t.after(() => fixture.server.close());
  const report = await crawl({ startUrl: `${fixture.base}/`, maxPages: 3, maxDepth: 2, delayMs: 0, timeoutMs: 500, allowPrivateNetwork: true, selectors: [{ field: "cards", selector: ".card", type: "text" }, { field: "outgoing", selector: "a", type: "link" }] });
  assert.equal(report.results.length, 3);
  assert.deepEqual(report.results.map((row) => row.depth), [0, 1, 1]);
  assert.equal(report.results[0].extracted.custom.cards.length, 0);
  assert.deepEqual(report.results[1].extracted.custom.cards, ["Card"]);
  assert.ok(report.allEligibleUrls.every((url) => !url.includes("blocked")));
  assert.equal(new Set(fixture.requests.filter((url) => url === "/one")).size, 1);
  const depthReport = await crawl({ startUrl: `${fixture.base}/`, maxPages: 4, maxDepth: 2, delayMs: 0, allowPrivateNetwork: true });
  assert.deepEqual(depthReport.results.map((row) => row.depth), [0, 1, 1, 2]);
});

test("crawler records HTTP, content-type, and timeout failures without stopping", async (t) => {
  const fixture = await startServer();
  t.after(() => fixture.server.close());
  const report = await crawl({ startUrl: `${fixture.base}/missing`, maxPages: 1, maxDepth: 0, delayMs: 0, timeoutMs: 20, allowPrivateNetwork: true });
  assert.equal(report.results[0].status, "failed");
  assert.equal(report.results[0].httpStatus, 404);
  const nonHtml = await crawl({ startUrl: `${fixture.base}/file`, maxPages: 1, maxDepth: 0, delayMs: 0, timeoutMs: 100, allowPrivateNetwork: true });
  assert.equal(nonHtml.logs[0].type, "ContentTypeError");
  const timeout = await crawl({ startUrl: `${fixture.base}/slow`, maxPages: 1, maxDepth: 0, delayMs: 0, timeoutMs: 10, allowPrivateNetwork: true });
  assert.equal(timeout.logs[0].type, "TimeoutError");
  await assert.rejects(() => crawl({ startUrl: fixture.base, maxPages: 1, maxDepth: 0, delayMs: 0 }), /private-network-host/);
});

test("allowed origins use separate robots policies", async (t) => {
  const second = await startServer();
  const first = await startServer(`${second.base}/one`);
  t.after(() => { first.server.close(); second.server.close(); });
  const report = await crawl({ startUrl: `${first.base}/`, allowedOrigins: [first.base, second.base], maxPages: 5, maxDepth: 1, delayMs: 0, allowPrivateNetwork: true });
  assert.equal(report.results.length, 4);
  assert.ok(report.results.some((row) => row.requestedUrl === `${second.base}/one`));
  assert.ok(first.requests.includes("/robots.txt"));
  assert.ok(second.requests.includes("/robots.txt"));
});

test("retries transient failures and supports cancellation", async (t) => {
  const fixture = await startServer();
  t.after(() => fixture.server.close());
  const report = await crawl({ startUrl: `${fixture.base}/retry`, maxPages: 1, maxDepth: 0, delayMs: 0, timeoutMs: 100, maxRetries: 1, retryBaseDelayMs: 1, retryMaxDelayMs: 1, allowPrivateNetwork: true });
  assert.equal(report.results[0].status, "succeeded");
  assert.equal(report.results[0].attempts, 2);
  assert.equal(report.summary.retries, 1);
  const controller = new AbortController();
  const pending = crawl({ startUrl: `${fixture.base}/slow`, maxPages: 1, maxDepth: 0, delayMs: 0, timeoutMs: 1000, maxRetries: 0, allowPrivateNetwork: true, signal: controller.signal });
  setTimeout(() => controller.abort(new Error("test cancellation")), 10);
  const cancelled = await pending;
  assert.equal(cancelled.summary.cancelled, true);
});

test("global and per-origin concurrency limits are enforced", async (t) => {
  const fixture = await startParallelServer();
  t.after(() => fixture.server.close());
  const report = await crawl({ startUrl: fixture.base, maxPages: 3, maxDepth: 1, concurrency: 2, perOriginConcurrency: 2, delayMs: 0, allowPrivateNetwork: true });
  assert.equal(report.results.length, 3);
  assert.equal(fixture.getMaximumActive(), 2);
  assert.equal(report.summary.concurrency, 2);
});

test("output is valid JSON and optional CSV", async (t) => {
  const fixture = await startServer();
  t.after(() => fixture.server.close());
  const report = await crawl({ startUrl: fixture.base, maxPages: 1, maxDepth: 0, delayMs: 0, allowPrivateNetwork: true });
  const directory = await mkdtemp(path.join(os.tmpdir(), "web-scraper-"));
  const files = await writeOutput(report, directory, { csv: true });
  const data = JSON.parse(await readFile(files.data, "utf8"));
  assert.equal(data.pages.length, 1);
  assert.match(await readFile(files.csv, "utf8"), /requestedUrl/);
});
