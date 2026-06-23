# Meme Lab

A layer-based meme/image editor that runs entirely in the browser. No build
step, no backend, no data ever leaves the device.

## Running it locally

Browsers block native ES module imports over `file://`, so you need any
trivial static server during development:

```
python3 -m http.server 8080
# or: npx serve .
```

Then open `http://localhost:8080/`.

## Deploying

Static files only. Push this directory to GitHub Pages, Firebase Hosting,
or any static host. No build step, no environment variables, no server
component.

## Architecture

```
index.html              shell markup, loads css/styles.css and src/main.js
css/styles.css           all styling, incl. @font-face for the embedded fonts
assets/fonts/             woff2 font files (converted from the original ttfs)
src/
  main.js                 bootstraps the app, wires cross-module reactions
  core/
    state.js                the live project data model + image cache
    layers.js                layer factory functions (default text/image/shape)
    history.js                undo/redo stack, snapshot serialization
    utils.js                   math helpers (clamp, rotation vectors, etc)
  render/
    renderer.js              scene composition, the render loop, canvas sizing
    text.js                   text layout/wrapping and text layer drawing
    shapes.js                  image/rect layer drawing, background cover-fit
    fonts.js                    waits for the custom webfonts to be ready
  interactions/
    pointer.js               mouse/touch hit-testing, drag/resize/rotate/pinch
  ui/
    icons.js                  inline SVG icon set
    layerList.js               the Layers panel + structural layer ops
    toolbar.js                  global toolbar wiring, canvas/background controls
    props/
      shared.js                  shared transform controls + small DOM helpers
      textProps.js, imageProps.js, rectProps.js, backgroundProps.js
                                  per-layer-type style panels
      panel.js                    dispatches to the right one above
  persistence/
    idb.js                    tiny generic IndexedDB key-value wrapper
    autosave.js                 debounced autosave + restore-on-load
  cutout/                    (reserved for the upcoming wand/lasso/AI cutout tools)
```

### Why it's split up like this

Each module has one job. The props panel is split per layer type
specifically so new controls for one layer type (e.g. an exposure slider on
images) don't require touching the file that renders text or shape panels.

A few modules import each other in both directions on purpose (e.g.
`core/history.js` and `ui/toolbar.js`, by way of the undo/redo buttons
calling into history and history notifying the toolbar back). This is safe
in native ES modules as long as neither side reads the other's export at
module-evaluation time, which is the case everywhere here, everything only
happens inside event handlers, called well after the whole module graph has
finished loading.

### Persistence

The app autosaves the current project to IndexedDB a moment after every
change, and restores it automatically on load. Nothing is ever sent
anywhere; it's a purely local, per-browser save tied to whatever
origin/domain the app is served from.
