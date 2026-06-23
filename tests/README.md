# Tests

A Playwright regression suite for the app, plus the debug-only hooks it
needs to introspect live state from outside the browser.

## Setup (once)

```
pip install -r tests/requirements.txt
playwright install chromium
```

## Running

From the repo root:

```
python3 -m http.server 8731 &
python3 tests/test_full.py
```

It generates its own sample test image on each run (`tests/output/sample.png`),
no fixture files to keep in sync. `tests/output/` is gitignored.

## What's in here

- `test_full.py` — the actual suite. Extend this per feature, don't create
  one-off scripts that get thrown away; this is the regression gate.
- `index.test.html` — a copy of `index.html` that additionally loads
  `test-hooks.js`. Never reference this from the real app.
- `test-hooks.js` — exposes `window.__test` (read live state, force a
  selection, get a layer's on-screen rect) by importing the exact same
  module instances `main.js` is using. Production `index.html` never loads
  this file.

If you add a new module that the tests need to peek into, add the import
and a small accessor to `test-hooks.js` rather than adding test-only
globals inside `src/`.
