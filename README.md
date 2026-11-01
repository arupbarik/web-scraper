# Web Scraper

A bounded Node.js crawler for static HTML pages. It uses the built-in Fetch API, Cheerio, and `robots-parser`. The original implementation used the same core libraries; the hardened version keeps that approach while separating crawling, extraction, scheduling, and output responsibilities.

## Features

- HTTP/HTTPS URL validation, fragment removal, relative-link resolution, and same-origin scope by default.
- FIFO breadth-first crawling with depth and total-page limits.
- Configurable global/per-origin concurrency, per-origin pacing, bounded queue, retries, jitter, and graceful SIGINT/SIGTERM cancellation.
- Duplicate scheduling prevention and invalid/missing link handling.
- Request timeout, HTML content-type checks, response-size limit, bounded redirect handling, and structured failures.
- Per-origin cached `robots.txt` policies and sequential request pacing.
- Generic title, meta description, headings, paragraphs, and links extraction.
- Multiple custom text or link CSS selector fields in one page record.
- JSON output and optional CSV output.

## Installation

Requires Node.js 20 or newer.

```bash
npm install
npm test
```

## Usage

Interactive mode:

```bash
npm start
```

CLI mode:

```bash
node main.js --url https://example.com --max-pages 10 --max-depth 2 --delay-ms 250 --concurrency 2 --per-origin-concurrency 1 --output-dir result --csv true
```

Custom selectors are supplied as JSON:

```bash
node main.js --url https://example.com --max-pages 5 --selectors '[{"field":"prices","selector":".price","type":"text"},{"field":"productLinks","selector":"a.product","type":"link"}]'
```

Supported options include `url`, `max-pages`, `max-depth`, `timeout-ms`, `delay-ms`, `per-origin-delay-ms`, `concurrency`, `per-origin-concurrency`, `max-queue-size`, `max-retries`, `retry-base-delay-ms`, `retry-max-delay-ms`, `robots-cache-ttl-ms`, `max-body-bytes`, `output-dir`, `allowed-origins`, `selectors`, `generic`, and `csv`. Defaults are 10 pages, depth 2, a 10-second timeout, 250 ms pacing, one global worker, one worker per origin, a 1,000-item queue, two retries, and a 2 MB response limit. `allowed-origins` is a JSON array of complete origins and is required for deliberate multi-origin crawling.

## Output

The output directory is created automatically:

- `data.json`: summary plus one coherent record per attempted page.
- `logs.json`: robots and page failures with type, message, URL, and HTTP status where available.
- `all_eligible_urls.json`: normalized URLs accepted for scheduling.
- `extracted_data_urls.json`: successfully parsed HTML page URLs.
- `data.csv`: optional flat page-level export.

## Safety and limitations

Use the crawler only on sites you are authorized to crawl. Same-origin crawling is the default, redirects are revalidated against that scope, DNS is resolved before requests, and localhost/private/link-local/metadata destinations are rejected by default. Tests enable `allowPrivateNetwork` only for local fixtures. This is not complete SSRF protection: Node's built-in Fetch API does not pin the validated DNS result to the socket, so DNS rebinding remains a TOCTOU limitation. Deployments needing a hard SSRF boundary should add network egress controls or a resolver-aware HTTP client/proxy. JavaScript-rendered content, authentication, CAPTCHA bypass, and unrestricted cross-domain crawling are not supported. `robots.txt` is a convention, not an access-control mechanism; retrieval failures are handled conservatively by denying that origin.

The crawler records retry, queue, concurrency, and robots metrics in `data.json`. Robots-declared sitemap URLs are not automatically expanded because doing so could bypass the configured page bound or create unbounded work. Long-running checkpoint/resume persistence is intentionally not implemented; page and queue bounds make the in-memory frontier finite.

## Documentation

- `ARCHITECTURE.md` describes the data flow and state model.
- `TEST_REPORT.md` records executed tests and results.
- `AI_CONTRIBUTION.md` distinguishes original and AI-assisted work.
- `Reasearch-Files/` contains the existing project research and roadmap materials. No root `project-roadmap.txt` was present in the repository.
