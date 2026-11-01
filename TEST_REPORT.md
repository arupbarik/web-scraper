# Test Report

## Command

```text
npm test
```

## Result

7 tests passed, 0 failed, using Node's built-in test runner. Tests use a local controlled HTTP server and do not depend on public websites.

Covered behavior includes URL normalization, relative links, invalid and missing href values, duplicate links, depth 0/1/2 traversal, maximum page limits, robots allowed/disallowed paths, separate policies for multiple origins, HTTP 404 failures, non-HTML responses, request timeouts, private-network rejection, generic extraction, custom text and link selectors, empty selector results, transient retries with per-page attempt counts, cancellation, global/per-origin concurrency, valid JSON, and CSV output.

## Bugs Found and Fixed

- The original code fetched before enforcing a coherent page limit and had incorrect depth traversal.
- Link arrays were pushed into the queue as nested arrays.
- URLs were not deduplicated at scheduling time and missing href values could throw.
- `selection_checker` tested `length < 0`, which is never true.
- `if (extract_choice === ("l" || "links"))` never accepted the `links` spelling.
- Several variables used during extraction were undefined, including `html`, `url`, `pg`, and the generic/custom mode flag.
- Robots policy was global instead of cached per origin.
- Output directory creation, status/content validation, timeout handling, redirects, and structured failures were missing or incomplete.
- Production hardening added bounded retries, jitter, `Retry-After`, streaming body limits, DNS preflight, queue bounds, cancellation, and concurrency scheduling.

## Remaining Limitations

The suite does not claim complete SSRF protection, browser/JavaScript rendering, authenticated crawling, or checkpoint/resume persistence. DNS rebinding remains possible because Fetch does not pin the preflight DNS result to its socket; use egress controls or a resolver-aware client for a hard SSRF boundary.
