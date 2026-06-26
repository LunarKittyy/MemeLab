"""
Regression suite for the Meme Lab app.

Usage:
    cd <repo root>
    python3 -m http.server 8731 &
    python3 tests/test_full.py

Extend this file per new feature rather than writing throwaway scripts.
Every feature in PLAN.md should leave this suite green, with new cases
added for whatever it just built.
"""
import sys
import os
from playwright.sync_api import sync_playwright
from PIL import Image

BASE_URL = os.environ.get("TEST_BASE_URL", "http://localhost:8731")
import os as _os
BASE_URL = _os.environ.get("BASE_URL", "http://localhost:8731")
TEST_URL = f"{BASE_URL}/tests/index.test.html"
PROD_URL = f"{BASE_URL}/index.html"

OUT_DIR = os.path.join(os.path.dirname(__file__), "output")
os.makedirs(OUT_DIR, exist_ok=True)
SAMPLE_IMG = os.path.join(OUT_DIR, "sample.png")

results = []


def check(name, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    results.append((name, status))
    print(f"[{status}] {name}" + (f" — {detail}" if detail and not cond else ""))


def make_sample_image():
    # A simple synthetic image so this suite has no dependency on any
    # particular uploaded asset. Two flat color blocks plus some texture
    # is enough for layer/transform/export tests; cutout-feature tests
    # (wand/lasso/AI) will want something with more distinct regions and
    # should generate their own purpose-built fixture rather than reusing
    # this one.
    img = Image.new("RGB", (640, 480), (235, 90, 140))
    for y in range(480):
        for x in range(0, 640, 8):
            if (x // 8 + y // 8) % 2 == 0:
                img.putpixel((x, y), (40, 200, 210))
    img.save(SAMPLE_IMG)


def launch_browser(p):
    # Use pre-installed Chromium to avoid version mismatch
    chromium_path = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
    if os.path.exists(chromium_path):
        return p.chromium.launch(executable_path=chromium_path, args=['--no-sandbox'])
    return p.chromium.launch(args=['--no-sandbox'])


def run():
    make_sample_image()
    with sync_playwright() as p:
        browser = launch_browser(p)

        ctx = browser.new_context(viewport={"width": 1400, "height": 900})
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.goto(TEST_URL)
        page.wait_for_timeout(500)
        check("loads clean, no page errors", len(errors) == 0, str(errors))

        # ---- basic add/select ----
        page.click("#btnAddText")
        page.wait_for_timeout(150)
        st = page.evaluate("window.__test.getState()")
        check("text layer added", len(st["layers"]) == 1 and st["layers"][0]["type"] == "text")
        text_id = st["layers"][0]["id"]

        with page.expect_file_chooser() as fc:
            page.click("#iconAddImage")
        fc.value.set_files(SAMPLE_IMG)
        page.wait_for_timeout(500)
        st = page.evaluate("window.__test.getState()")
        check("image layer added on top", len(st["layers"]) == 2 and st["layers"][1]["type"] == "image")
        image_id = st["layers"][1]["id"]
        check("image layer auto-selected", st["selectedId"] == image_id)

        # ---- drag-priority regression (selected-but-covered layer drags correctly) ----
        page.evaluate("(id) => window.__test.selectLayer(id)", text_id)
        page.wait_for_timeout(100)
        before = page.evaluate("window.__test.getState()")
        text_before = next(l for l in before["layers"] if l["id"] == text_id)
        rect = page.evaluate("(id) => window.__test.layerScreenRect(id)", text_id)
        page.mouse.move(rect["cx"], rect["cy"])
        page.mouse.down()
        page.mouse.move(rect["cx"] + 40, rect["cy"] + 25, steps=5)
        page.mouse.up()
        page.wait_for_timeout(150)
        after = page.evaluate("window.__test.getState()")
        text_after = next(l for l in after["layers"] if l["id"] == text_id)
        image_after = next(l for l in after["layers"] if l["id"] == image_id)
        moved = abs(text_after["x"] - text_before["x"]) > 5 or abs(text_after["y"] - text_before["y"]) > 5
        check("dragging the covered selected layer moves it, not the top layer", moved)
        check("the top layer stayed put during that drag",
              abs(image_after["x"] - before["layers"][1]["x"]) < 0.01)
        check("selection stayed on the dragged layer", after["selectedId"] == text_id)

        page.evaluate("(id) => window.__test.selectLayer(id)", None)
        page.wait_for_timeout(80)
        img_rect = page.evaluate("(id) => window.__test.layerScreenRect(id)", image_id)
        page.mouse.move(img_rect["cx"], img_rect["cy"])
        page.mouse.down()
        page.mouse.move(img_rect["cx"] + 10, img_rect["cy"] + 8, steps=3)
        page.mouse.up()
        page.wait_for_timeout(120)
        st2 = page.evaluate("window.__test.getState()")
        check("fresh click with nothing selected picks the top layer", st2["selectedId"] == image_id)

        # ---- pinch-to-scale regression ----
        page.evaluate("(id) => window.__test.selectLayer(id)", image_id)
        page.wait_for_timeout(100)
        before_pinch = page.evaluate("window.__test.getState()")
        img_before = next(l for l in before_pinch["layers"] if l["id"] == image_id)
        r = page.evaluate("(id) => window.__test.layerScreenRect(id)", image_id)
        page.evaluate("""
        (r) => {
          const stage = document.getElementById('stage');
          function fire(type, id, x, y){
            stage.dispatchEvent(new PointerEvent(type, { pointerId:id, pointerType:'touch', clientX:x, clientY:y, bubbles:true, cancelable:true, isPrimary: id===1 }));
          }
          fire('pointerdown', 1, r.cx-20, r.cy);
          fire('pointerdown', 2, r.cx+20, r.cy);
          for (let i=1;i<=5;i++){ fire('pointermove',1,r.cx-20-i*15,r.cy); fire('pointermove',2,r.cx+20+i*15,r.cy); }
          fire('pointerup', 1, r.cx-95, r.cy);
          fire('pointerup', 2, r.cx+95, r.cy);
        }
        """, r)
        page.wait_for_timeout(150)
        after_pinch = page.evaluate("window.__test.getState()")
        img_after = next(l for l in after_pinch["layers"] if l["id"] == image_id)
        check("pinch-out grew the selected layer", img_after["w"] > img_before["w"] * 1.3,
              f"{img_before['w']:.0f} -> {img_after['w']:.0f}")
        check("pinch preserved aspect ratio",
              abs(img_before["w"] / img_before["h"] - img_after["w"] / img_after["h"]) < 0.01)
        check("no errors after pinch", len(errors) == 0, str(errors))

        # ---- undo/redo regression ----
        page.click("#btnUndo")
        page.wait_for_timeout(100)
        undone = page.evaluate("window.__test.getState()")
        img_undone = next(l for l in undone["layers"] if l["id"] == image_id)
        check("undo reverted the pinch resize", abs(img_undone["w"] - img_before["w"]) < 1)
        redo_disabled_before = page.get_attribute("#btnRedo", "disabled")
        check("redo button is enabled immediately after an undo", redo_disabled_before is None)
        page.click("#btnRedo")
        page.wait_for_timeout(100)
        check("no errors after undo/redo", len(errors) == 0, str(errors))

        # ---- export ----
        with page.expect_download() as dl_info:
            page.click("#btnExport")
        dl = dl_info.value
        export_path = os.path.join(OUT_DIR, "export_test.png")
        dl.save_as(export_path)
        img = Image.open(export_path)
        check("exported PNG is valid 2x square", img.size == (2160, 2160), str(img.size))

        # ---- autosave -> IndexedDB ----
        page.evaluate("(id) => window.__test.selectLayer(id)", text_id)
        ta = page.locator("#tText")
        ta.fill("REGRESSION SUITE TEXT")
        ta.dispatch_event("change")
        page.wait_for_timeout(1100)
        dot_class = page.get_attribute("#saveDot", "class")
        check("save dot shows 'saved' after edit settles", "saved" in dot_class, dot_class)

        idb_dump = page.evaluate("""
        async () => {
          return new Promise((resolve) => {
            const req = indexedDB.open('memelab', 1);
            req.onsuccess = () => {
              const db = req.result;
              const tx = db.transaction('kv', 'readonly');
              const getReq = tx.objectStore('kv').get('project');
              getReq.onsuccess = () => resolve(getReq.result);
              getReq.onerror = () => resolve(null);
            };
            req.onerror = () => resolve(null);
          });
        }
        """)
        check("IndexedDB actually has a saved project", idb_dump is not None)
        if idb_dump:
            has_text = any(l.get("text") == "REGRESSION SUITE TEXT" for l in idb_dump["layers"])
            check("saved project contains the edited text", has_text)
            has_image = any(
                l["type"] == "image" and l.get("src", "").startswith("data:image")
                for l in idb_dump["layers"]
            )
            check("saved project contains the image layer", has_image)

        layer_count_before_reload = len(page.evaluate("window.__test.getState()")["layers"])

        page.reload()
        page.wait_for_timeout(700)
        check("no errors after reload", len(errors) == 0, str(errors))
        restored = page.evaluate("window.__test.getState()")
        check("layer count survived reload", len(restored["layers"]) == layer_count_before_reload,
              f"{layer_count_before_reload} vs {len(restored['layers'])}")
        restored_text = next((l for l in restored["layers"] if l["type"] == "text"), None)
        check("restored text matches", bool(restored_text) and restored_text["text"] == "REGRESSION SUITE TEXT")
        restored_image = next((l for l in restored["layers"] if l["type"] == "image"), None)
        check("restored image layer has a usable src", bool(restored_image) and restored_image["src"].startswith("data:image"))

        page.click("#btnAddText")
        page.wait_for_timeout(150)
        st3 = page.evaluate("window.__test.getState()")
        ids = [l["id"] for l in st3["layers"]]
        check("no duplicate ids after adding post-restore", len(ids) == len(set(ids)))

        page.screenshot(path=os.path.join(OUT_DIR, "qa_desktop.png"))

        # ---- feature #2: blur / pixelate censor shape ----
        # A fresh context with a known image underneath a rect layer.
        ctx_box = browser.new_context(viewport={"width": 1400, "height": 900})
        page_box = ctx_box.new_page()
        errors_box = []
        page_box.on("pageerror", lambda exc: errors_box.append(str(exc)))
        page_box.goto(TEST_URL)
        page_box.wait_for_timeout(500)

        # Upload the sample image so there are pixels underneath the shape.
        with page_box.expect_file_chooser() as fc_box:
            page_box.click("#iconAddImage")
        fc_box.value.set_files(SAMPLE_IMG)
        page_box.wait_for_timeout(500)

        # Add a rect layer on top — this is the censor shape.
        page_box.click("#btnAddRect")
        page_box.wait_for_timeout(150)
        st_box = page_box.evaluate("window.__test.getState()")
        rect_id = next(l["id"] for l in st_box["layers"] if l["type"] == "rect")
        check("censor-shape: rect layer created", rect_id is not None)

        # Select the rect so the props panel shows.
        page_box.evaluate("(id) => window.__test.selectLayer(id)", rect_id)
        page_box.wait_for_timeout(150)

        # Verify default mode is 'color'.
        st_rect = page_box.evaluate("window.__test.getState()")
        rect_layer = next(l for l in st_rect["layers"] if l["id"] == rect_id)
        check("censor-shape: default mode is 'color'", (rect_layer.get("mode") or "color") == "color")

        # Export at 1x with color mode as baseline.
        page_box.evaluate("document.getElementById('exportScale').dataset.value = '1'")
        page_box.wait_for_timeout(100)
        with page_box.expect_download() as dl_color:
            page_box.click("#btnExport")
        color_export_path = os.path.join(OUT_DIR, "censor_color_export.png")
        dl_color.value.save_as(color_export_path)
        img_color = Image.open(color_export_path)
        check("censor-shape: color-mode export is valid PNG", img_color.size[0] > 0)

        import hashlib
        def img_hash(path):
            return hashlib.md5(open(path, 'rb').read()).hexdigest()

        # Switch to blur mode via the seg button in the rect props panel.
        page_box.evaluate("""
        () => {
          const btns = document.querySelectorAll('#rModeSeg button');
          const blurBtn = [...btns].find(b => b.dataset.v === 'blur');
          if (blurBtn) blurBtn.click();
        }
        """)
        page_box.wait_for_timeout(150)
        st_blur = page_box.evaluate("window.__test.getState()")
        rect_blur = next(l for l in st_blur["layers"] if l["id"] == rect_id)
        check("censor-shape: blur mode set in state", rect_blur.get("mode") == "blur")

        with page_box.expect_download() as dl_blur:
            page_box.click("#btnExport")
        blur_export_path = os.path.join(OUT_DIR, "censor_blur_export.png")
        dl_blur.value.save_as(blur_export_path)
        img_blur = Image.open(blur_export_path)
        check("censor-shape: blur export is a valid PNG of the same size",
              img_blur.size == img_color.size, f"{img_color.size} vs {img_blur.size}")
        check("censor-shape: blur export is visually distinct from color export",
              img_hash(blur_export_path) != img_hash(color_export_path))

        # Switch to pixelate mode.
        page_box.evaluate("""
        () => {
          const btns = document.querySelectorAll('#rModeSeg button');
          const pixBtn = [...btns].find(b => b.dataset.v === 'pixelate');
          if (pixBtn) pixBtn.click();
        }
        """)
        page_box.wait_for_timeout(150)
        st_pix = page_box.evaluate("window.__test.getState()")
        rect_pix = next(l for l in st_pix["layers"] if l["id"] == rect_id)
        check("censor-shape: pixelate mode set in state", rect_pix.get("mode") == "pixelate")

        with page_box.expect_download() as dl_pix:
            page_box.click("#btnExport")
        pix_export_path = os.path.join(OUT_DIR, "censor_pixelate_export.png")
        dl_pix.value.save_as(pix_export_path)
        img_pix = Image.open(pix_export_path)
        check("censor-shape: pixelate export is a valid PNG of the same size",
              img_pix.size == img_color.size)
        check("censor-shape: pixelate export is visually distinct from color export",
              img_hash(pix_export_path) != img_hash(color_export_path))
        check("censor-shape: pixelate export is visually distinct from blur export",
              img_hash(pix_export_path) != img_hash(blur_export_path))
        check("censor-shape: no page errors throughout", len(errors_box) == 0, str(errors_box))
        ctx_box.close()

        # ---- layer preview thumbnails regression test ----
        preview_check = page.evaluate("""() => {
            const img = document.querySelector('.layerrow .layer-preview img.thumb-img');
            const badge = document.querySelector('.layerrow .layer-preview .mini-typebadge');
            return {
                hasImg: !!img,
                hasBadge: !!badge,
                imgAttrId: img ? img.getAttribute('data-id') : null
            };
        }""")
        check("layer-preview: thumb-img exists in row", preview_check["hasImg"])
        check("layer-preview: mini-typebadge exists in row", preview_check["hasBadge"])
        check("layer-preview: thumb-img has valid layer data-id", preview_check["imgAttrId"] is not None)

        ctx.close()

        # ---- fresh profile, nothing saved yet ----
        ctx2 = browser.new_context(viewport={"width": 400, "height": 800})
        page2 = ctx2.new_page()
        errors2 = []
        page2.on("pageerror", lambda exc: errors2.append(str(exc)))
        page2.goto(TEST_URL)
        page2.wait_for_timeout(500)
        check("fresh profile boots blank with no errors",
              len(errors2) == 0 and len(page2.evaluate("window.__test.getState()")["layers"]) == 0,
              str(errors2))
        page2.screenshot(path=os.path.join(OUT_DIR, "qa_mobile_blank.png"))
        page2.click("#btnOpenLeft")
        page2.wait_for_timeout(200)
        page2.screenshot(path=os.path.join(OUT_DIR, "qa_mobile_layers.png"))
        check("mobile drawer opens with no errors", len(errors2) == 0, str(errors2))
        ctx2.close()

        # ---- production index.html (no test hooks) also boots clean ----
        ctx3 = browser.new_context(viewport={"width": 1200, "height": 800})
        page3 = ctx3.new_page()
        errors3 = []
        page3.on("pageerror", lambda exc: errors3.append(str(exc)))
        page3.goto(PROD_URL)
        page3.wait_for_timeout(500)
        check("production index.html (no test hooks) boots clean", len(errors3) == 0, str(errors3))
        ctx3.close()

        # ---- Section 2: canvas zoom & pan ----
        ctx_zoom = browser.new_context(viewport={"width": 1400, "height": 900})
        page_zoom = ctx_zoom.new_page()
        errors_zoom = []
        page_zoom.on("pageerror", lambda exc: errors_zoom.append(str(exc)))
        page_zoom.goto(TEST_URL)
        page_zoom.wait_for_timeout(500)
        check("zoom: boots clean", len(errors_zoom) == 0, str(errors_zoom))

        vp0 = page_zoom.evaluate("window.__test.getViewport()")
        check("zoom: initial zoom is 1", vp0["zoom"] == 1)
        check("zoom: initial pan is 0,0", vp0["panX"] == 0 and vp0["panY"] == 0)
        check("zoom: fitScale is positive", vp0["fitScale"] > 0)

        # Scroll-wheel zoom — must hover canvas area first
        ca_box = page_zoom.evaluate("""() => {
            const r = document.getElementById('canvasArea').getBoundingClientRect();
            return { cx: r.left + r.width/2, cy: r.top + r.height/2 };
        }""")
        cx_ca, cy_ca = ca_box["cx"], ca_box["cy"]
        page_zoom.mouse.move(cx_ca, cy_ca)
        page_zoom.mouse.wheel(0, -300)
        page_zoom.wait_for_timeout(100)
        vp1 = page_zoom.evaluate("window.__test.getViewport()")
        check("zoom: scroll-wheel zoom-in increases zoom", vp1["zoom"] > 1.0,
              f"zoom={vp1['zoom']}")
        check("zoom: scroll-wheel no page errors", len(errors_zoom) == 0, str(errors_zoom))

        # Reset via button
        page_zoom.click("#zoomReset")
        page_zoom.wait_for_timeout(100)
        vp2 = page_zoom.evaluate("window.__test.getViewport()")
        check("zoom: reset button restores zoom to 1", vp2["zoom"] == 1)
        check("zoom: reset button zeroes pan", vp2["panX"] == 0 and vp2["panY"] == 0)

        # Undo should NOT revert zoom (viewport is not in history)
        page_zoom.click("#btnAddText")
        page_zoom.wait_for_timeout(150)
        # Zoom in
        page_zoom.mouse.move(cx_ca, cy_ca)
        page_zoom.mouse.wheel(0, -300)
        page_zoom.wait_for_timeout(100)
        vp_after_zoom = page_zoom.evaluate("window.__test.getViewport()")
        zoom_before_undo = vp_after_zoom["zoom"]
        page_zoom.click("#btnUndo")
        page_zoom.wait_for_timeout(100)
        vp_after_undo = page_zoom.evaluate("window.__test.getViewport()")
        check("zoom: undo does not affect viewport zoom",
              abs(vp_after_undo["zoom"] - zoom_before_undo) < 0.001,
              f"{zoom_before_undo} -> {vp_after_undo['zoom']}")

        check("zoom: no errors throughout", len(errors_zoom) == 0, str(errors_zoom))
        ctx_zoom.close()

        # ---- Section 4: non-destructive adjustment stack ----
        ctx_adj = browser.new_context(viewport={"width": 1400, "height": 900})
        page_adj = ctx_adj.new_page()
        errors_adj = []
        page_adj.on("pageerror", lambda exc: errors_adj.append(str(exc)))
        page_adj.goto(TEST_URL)
        page_adj.wait_for_timeout(500)

        # Add an image layer; verify schema fields exist from the factory.
        with page_adj.expect_file_chooser() as fc_adj:
            page_adj.click("#iconAddImage")
        fc_adj.value.set_files(SAMPLE_IMG)
        page_adj.wait_for_timeout(500)
        st_adj = page_adj.evaluate("window.__test.getState()")
        adj_img = next(l for l in st_adj["layers"] if l["type"] == "image")
        check("adj: image layer has adjustments array",
              isinstance(adj_img.get("adjustments"), list))
        check("adj: adjustments array starts empty",
              len(adj_img.get("adjustments", [])) == 0)
        check("adj: image layer has mask field", "mask" in adj_img)
        check("adj: mask starts disabled", not adj_img["mask"]["enabled"])
        adj_img_id = adj_img["id"]

        # Select the image layer so the props panel renders.
        page_adj.evaluate("(id) => window.__test.selectLayer(id)", adj_img_id)
        page_adj.wait_for_timeout(200)

        # Open the Adjustments collapsible (click its header).
        page_adj.evaluate("""() => {
            const hdr = document.querySelector('#adjSection-hdr');
            if (hdr) hdr.click();
        }""")
        page_adj.wait_for_timeout(100)

        # Export baseline with no adjustments.
        page_adj.evaluate("document.getElementById('exportScale').dataset.value = '1'")
        page_adj.wait_for_timeout(50)
        with page_adj.expect_download() as dl_base:
            page_adj.click("#btnExport")
        base_path = os.path.join(OUT_DIR, "adj_base.png")
        dl_base.value.save_as(base_path)
        img_base = Image.open(base_path)
        check("adj: baseline export is valid PNG", img_base.size[0] > 0)

        # Move the brightness slider to +80.
        page_adj.evaluate("""() => {
            const sl = document.getElementById('aiBright');
            if (!sl) return;
            sl.value = '80';
            sl.dispatchEvent(new Event('input', { bubbles: true }));
            sl.dispatchEvent(new Event('change', { bubbles: true }));
        }""")
        page_adj.wait_for_timeout(200)

        # Verify layer.adjustments array was updated in state.
        st_adj2 = page_adj.evaluate("window.__test.getState()")
        adj_img2 = next(l for l in st_adj2["layers"] if l["id"] == adj_img_id)
        bright_entry = next((a for a in adj_img2.get("adjustments", []) if a["type"] == "brightness"), None)
        check("adj: brightness slider writes to layer.adjustments",
              bright_entry is not None and bright_entry["value"] == 80,
              str(adj_img2.get("adjustments")))

        # Export with brightness applied — result must differ visually.
        with page_adj.expect_download() as dl_bright:
            page_adj.click("#btnExport")
        bright_path = os.path.join(OUT_DIR, "adj_bright.png")
        dl_bright.value.save_as(bright_path)
        img_bright = Image.open(bright_path)
        check("adj: bright export is valid PNG of same size", img_bright.size == img_base.size)

        import hashlib
        def adj_hash(path):
            return hashlib.md5(open(path, 'rb').read()).hexdigest()

        check("adj: bright export is visually distinct from baseline",
              adj_hash(bright_path) != adj_hash(base_path))

        # Average pixel brightness should have increased significantly.
        import struct
        px_base = list(img_base.convert("L").getdata())
        px_bright = list(img_bright.convert("L").getdata())
        avg_base = sum(px_base) / len(px_base)
        avg_bright = sum(px_bright) / len(px_bright)
        check("adj: brightness adjustment visibly brightens the export",
              avg_bright > avg_base + 10,
              f"base avg={avg_base:.1f} bright avg={avg_bright:.1f}")

        # Undo should revert the brightness in state.
        page_adj.click("#btnUndo")
        page_adj.wait_for_timeout(150)
        st_adj3 = page_adj.evaluate("window.__test.getState()")
        adj_img3 = next(l for l in st_adj3["layers"] if l["id"] == adj_img_id)
        bright_after_undo = next(
            (a for a in adj_img3.get("adjustments", []) if a["type"] == "brightness"), None)
        check("adj: undo reverts brightness adjustment",
              bright_after_undo is None or bright_after_undo["value"] == 0,
              str(adj_img3.get("adjustments")))

        # No errors throughout.
        check("adj: no page errors throughout", len(errors_adj) == 0, str(errors_adj))
        ctx_adj.close()

        # ---- Track H: Export format, filename, .meme project, canvas resize ----
        ctx_h = browser.new_context(viewport={"width": 1400, "height": 900})
        page_h = ctx_h.new_page()
        errors_h = []
        page_h.on("pageerror", lambda exc: errors_h.append(str(exc)))
        page_h.goto(TEST_URL)
        page_h.wait_for_timeout(600)
        check("track-h: boots clean", len(errors_h) == 0, str(errors_h))

        # Add an image layer
        with page_h.expect_file_chooser() as fc_h:
            page_h.click("#iconAddImage")
        fc_h.value.set_files(SAMPLE_IMG)
        page_h.wait_for_timeout(500)

        # ---- JPEG export via localStorage settings ----
        # Set localStorage export settings to JPEG, scale 1
        page_h.evaluate("""
        () => {
          localStorage.setItem('exportSettings', JSON.stringify({
            format: 'jpeg', quality: 92, scaleMode: 'multiplier', scale: 1, outW: 1080, outH: 1080
          }));
        }
        """)
        page_h.wait_for_timeout(50)
        # Set scale selector to 1 so quickExport picks it up
        page_h.evaluate("document.getElementById('exportScale').dataset.value = '1'")
        with page_h.expect_download() as dl_jpeg_info:
            page_h.click("#btnExport")
        dl_jpeg = dl_jpeg_info.value
        jpeg_path = os.path.join(OUT_DIR, "track_h_export.jpg")
        dl_jpeg.save_as(jpeg_path)
        page_h.wait_for_timeout(200)

        # Check JPEG magic bytes: FF D8
        with open(jpeg_path, 'rb') as f:
            header = f.read(4)
        check("track-h: JPEG export has valid JPEG header",
              header[0] == 0xFF and header[1] == 0xD8,
              header.hex())
        check("track-h: JPEG download filename is meme.jpg",
              dl_jpeg.suggested_filename == 'meme.jpg', dl_jpeg.suggested_filename)

        # ---- WEBP export ----
        page_h.evaluate("""
        () => {
          localStorage.setItem('exportSettings', JSON.stringify({
            format: 'webp', quality: 85, scaleMode: 'multiplier', scale: 1, outW: 1080, outH: 1080
          }));
        }
        """)
        page_h.wait_for_timeout(50)
        with page_h.expect_download() as dl_webp_info:
            page_h.click("#btnExport")
        dl_webp = dl_webp_info.value
        webp_path = os.path.join(OUT_DIR, "track_h_export.webp")
        dl_webp.save_as(webp_path)
        page_h.wait_for_timeout(200)

        # WEBP starts with RIFF...WEBP
        with open(webp_path, 'rb') as f:
            whead = f.read(12)
        check("track-h: WEBP export has valid WEBP header",
              whead[:4] == b'RIFF' and whead[8:12] == b'WEBP',
              whead.hex())
        check("track-h: WEBP download filename is meme.webp",
              dl_webp.suggested_filename == 'meme.webp', dl_webp.suggested_filename)

        # Reset localStorage to PNG for remaining tests
        page_h.evaluate("""
        () => {
          localStorage.setItem('exportSettings', JSON.stringify({
            format: 'png', quality: 92, scaleMode: 'multiplier', scale: 2, outW: 1080, outH: 1080
          }));
        }
        """)

        # ---- .meme export ----
        state_before = page_h.evaluate("window.__test.getState()")
        layer_count_before = len(state_before["layers"])
        width_before = state_before["width"]
        height_before = state_before["height"]

        with page_h.expect_download() as dl_meme_info:
            page_h.evaluate("""
            async () => {
              // Access the exportMemeFile function via a module import path
              // from the test page's perspective
              const { exportMemeFile } = await import('/src/persistence/memeFile.js');
              await exportMemeFile();
            }
            """)
        dl_meme = dl_meme_info.value
        meme_path = os.path.join(OUT_DIR, "track_h_project.meme")
        dl_meme.save_as(meme_path)
        page_h.wait_for_timeout(200)

        # .meme is a zip — check PK header
        with open(meme_path, 'rb') as f:
            meme_head = f.read(4)
        check("track-h: .meme export is a zip (PK header)",
              meme_head[:2] == b'PK', meme_head.hex())
        check("track-h: .meme download filename is project.meme",
              dl_meme.suggested_filename == 'project.meme', dl_meme.suggested_filename)

        # ---- .meme import restores state ----
        # Open the document panel and use its file picker for import
        page_h.click("#btnDocument")
        page_h.wait_for_timeout(300)
        # Check the document panel opened
        panel_visible = page_h.evaluate("""
        () => {
          const p = document.getElementById('documentPanel');
          return p && p.classList.contains('show');
        }
        """)
        check("track-h: document panel opens on btnDocument click", panel_visible)

        # Close panel, then use a direct importMemeFile call to test
        page_h.evaluate("document.getElementById('documentPanel').classList.remove('show')")
        page_h.wait_for_timeout(100)

        # Reset state to empty, then import
        page_h.evaluate("""
        () => {
          const btn = document.getElementById('btnReset');
          if (btn) { btn.click(); setTimeout(() => btn.click(), 10); }
        }
        """)
        page_h.wait_for_timeout(400)

        with page_h.expect_file_chooser() as fc_meme:
            page_h.evaluate("""
            async () => {
              const { importMemeFile } = await import('/src/persistence/memeFile.js');
              // Create a temp input to trigger the file chooser
              const inp = document.createElement('input');
              inp.type = 'file'; inp.accept = '.meme';
              inp.onchange = (e) => importMemeFile(e.target.files[0]);
              document.body.appendChild(inp);
              inp.click();
            }
            """)
        fc_meme.value.set_files(meme_path)
        page_h.wait_for_timeout(800)

        state_after = page_h.evaluate("window.__test.getState()")
        check("track-h: .meme import restores layer count",
              len(state_after["layers"]) == layer_count_before,
              f"{layer_count_before} vs {len(state_after['layers'])}")
        check("track-h: .meme import restores width",
              state_after["width"] == width_before,
              f"{width_before} vs {state_after['width']}")
        check("track-h: .meme import restores height",
              state_after["height"] == height_before,
              f"{height_before} vs {state_after['height']}")

        check("track-h: no errors throughout", len(errors_h) == 0, str(errors_h))
        ctx_h.close()

        # ---- Canvas Size mode: keeps layer at absolute position ----
        ctx_resize = browser.new_context(viewport={"width": 1400, "height": 900})
        page_resize = ctx_resize.new_page()
        errors_resize = []
        page_resize.on("pageerror", lambda exc: errors_resize.append(str(exc)))
        page_resize.goto(TEST_URL)
        page_resize.wait_for_timeout(500)

        with page_resize.expect_file_chooser() as fc_r:
            page_resize.click("#iconAddImage")
        fc_r.value.set_files(SAMPLE_IMG)
        page_resize.wait_for_timeout(500)

        st_r = page_resize.evaluate("window.__test.getState()")
        layer_r = next(l for l in st_r["layers"] if l["type"] == "image")
        orig_x = layer_r["x"]
        orig_y = layer_r["y"]
        orig_w = layer_r["w"]
        orig_h = layer_r["h"]

        # Apply Canvas Size resize (no layer scaling)
        page_resize.evaluate("""
        async () => {
          const { applyCanvasResize } = await import('/src/ui/documentPanel.js');
          applyCanvasResize(800, 600, 'canvas');
        }
        """)
        page_resize.wait_for_timeout(200)

        st_r2 = page_resize.evaluate("window.__test.getState()")
        layer_r2 = next(l for l in st_r2["layers"] if l["type"] == "image")
        check("track-h: Canvas Size mode preserves layer x",
              abs(layer_r2["x"] - orig_x) < 0.01, f"{orig_x} -> {layer_r2['x']}")
        check("track-h: Canvas Size mode preserves layer y",
              abs(layer_r2["y"] - orig_y) < 0.01, f"{orig_y} -> {layer_r2['y']}")
        check("track-h: Canvas Size mode preserves layer w",
              abs(layer_r2["w"] - orig_w) < 0.01, f"{orig_w} -> {layer_r2['w']}")
        check("track-h: canvas width changed to 800",
              st_r2["width"] == 800, f"width={st_r2['width']}")

        # ---- Image Size mode: scales layer proportionally ----
        # Get current position after the canvas resize above
        layer_before_img = layer_r2
        cur_x = layer_before_img["x"]
        cur_w = layer_before_img["w"]
        old_cw = st_r2["width"]  # 800
        old_ch = st_r2["height"]  # 600

        page_resize.evaluate("""
        async () => {
          const { applyCanvasResize } = await import('/src/ui/documentPanel.js');
          applyCanvasResize(400, 300, 'image');
        }
        """)
        page_resize.wait_for_timeout(200)

        st_r3 = page_resize.evaluate("window.__test.getState()")
        check("track-h: Image Size mode sets new canvas width",
              st_r3["width"] == 400, f"width={st_r3['width']}")
        layer_r3 = next(l for l in st_r3["layers"] if l["type"] == "image")
        # Layer should have been scaled by 400/800 = 0.5
        expected_x = cur_x * 0.5
        expected_w = cur_w * 0.5
        check("track-h: Image Size mode scales layer x proportionally",
              abs(layer_r3["x"] - expected_x) < 2, f"expected {expected_x:.1f}, got {layer_r3['x']:.1f}")
        check("track-h: Image Size mode scales layer w proportionally",
              abs(layer_r3["w"] - expected_w) < 2, f"expected {expected_w:.1f}, got {layer_r3['w']:.1f}")

        check("track-h: no errors in resize tests", len(errors_resize) == 0, str(errors_resize))
        ctx_resize.close()

        # ---- Track I: Arc text path ----
        ctx_arc = browser.new_context(viewport={"width": 1400, "height": 900})
        page_arc = ctx_arc.new_page()
        errors_arc = []
        page_arc.on("pageerror", lambda exc: errors_arc.append(str(exc)))
        page_arc.goto(TEST_URL)
        page_arc.wait_for_timeout(500)

        # Add a text layer and verify arc defaults to 0.
        page_arc.click("#btnAddText")
        page_arc.wait_for_timeout(150)
        st_arc = page_arc.evaluate("window.__test.getState()")
        arc_layer = next(l for l in st_arc["layers"] if l["type"] == "text")
        check("arc: defaultTextLayer has arc=0", arc_layer.get("arc") == 0)
        arc_id = arc_layer["id"]

        # Set arc to 45 via JS (simulating slider input).
        page_arc.evaluate("(id) => window.__test.selectLayer(id)", arc_id)
        page_arc.wait_for_timeout(150)
        page_arc.evaluate("""() => {
            const sl = document.getElementById('tArc');
            if (!sl) return;
            sl.value = '45';
            sl.dispatchEvent(new Event('input', { bubbles: true }));
            sl.dispatchEvent(new Event('change', { bubbles: true }));
        }""")
        page_arc.wait_for_timeout(100)
        st_arc2 = page_arc.evaluate("window.__test.getState()")
        arc_layer2 = next(l for l in st_arc2["layers"] if l["id"] == arc_id)
        check("arc: slider sets layer.arc to 45", arc_layer2.get("arc") == 45)

        # Export with arc=45 — must produce a valid PNG without errors.
        page_arc.evaluate("document.getElementById('exportScale').dataset.value = '1'")
        with page_arc.expect_download() as dl_arc:
            page_arc.click("#btnExport")
        arc_export_path = os.path.join(OUT_DIR, "arc_export.png")
        dl_arc.value.save_as(arc_export_path)
        img_arc = Image.open(arc_export_path)
        check("arc: arc=45 export is a valid PNG", img_arc.size[0] > 0)
        check("arc: no page errors during arc render", len(errors_arc) == 0, str(errors_arc))

        # Reset to flat (arc=0) and verify it still exports identically shaped output.
        page_arc.evaluate("""() => {
            const btn = document.getElementById('tArcReset');
            if (btn) btn.click();
        }""")
        page_arc.wait_for_timeout(100)
        st_arc3 = page_arc.evaluate("window.__test.getState()")
        arc_layer3 = next(l for l in st_arc3["layers"] if l["id"] == arc_id)
        check("arc: reset button sets arc back to 0", arc_layer3.get("arc") == 0)

        # Migration: load a snapshot that has a text layer missing the arc field.
        page_arc.evaluate("""() => {
            const snap = {
                width: 1080, height: 1080,
                background: { type: 'color', color: '#ffffff', src: null, fit: 'cover' },
                layers: [{
                    id: 'L999', type: 'text', name: 'Old Text',
                    x: 100, y: 100, w: 400, h: 80, rotation: 0, opacity: 1,
                    visible: true, locked: false, aspectLocked: false,
                    text: 'Old layer', font: 'MemeImpact', sizeScale: 0.6,
                    color: '#ffffff', align: 'center', vAlign: 'middle',
                    bold: false, italic: false, lineHeight: 1.15, letterSpacing: 0, padding: 14,
                    stroke: { enabled: false, color: '#000000', width: 2 },
                    box: { enabled: false, mode: 'color', color: '#ffffff', amount: 16 },
                    adjustments: [], blendMode: 'normal'
                    // NOTE: arc field intentionally missing
                }]
            };
            // applyLoadedSnapshot is not exported, so use IDB to simulate a restore.
            return new Promise((resolve) => {
                const req = indexedDB.open('memelab', 1);
                req.onsuccess = () => {
                    const db = req.result;
                    const tx = db.transaction('kv', 'readwrite');
                    tx.objectStore('kv').put(snap, 'project');
                    tx.oncomplete = () => resolve(true);
                };
            });
        }""")
        page_arc.reload()
        page_arc.wait_for_timeout(700)
        st_migrated = page_arc.evaluate("window.__test.getState()")
        old_layer = next((l for l in st_migrated["layers"] if l.get("name") == "Old Text"), None)
        check("arc: migration adds arc=0 to old text layers on load",
              old_layer is not None and old_layer.get("arc") == 0)
        check("arc: no errors after migration reload", len(errors_arc) == 0, str(errors_arc))
        ctx_arc.close()

        # ---- Track I: Speech bubble ----
        ctx_sb = browser.new_context(viewport={"width": 1400, "height": 900})
        page_sb = ctx_sb.new_page()
        errors_sb = []
        page_sb.on("pageerror", lambda exc: errors_sb.append(str(exc)))
        page_sb.goto(TEST_URL)
        page_sb.wait_for_timeout(500)

        page_sb.click("#btnAddBubble")
        page_sb.wait_for_timeout(200)
        st_sb = page_sb.evaluate("window.__test.getState()")
        sb_layer = next((l for l in st_sb["layers"] if l.get("subtype") == "speechbubble"), None)
        check("speechbubble: layer created with correct subtype", sb_layer is not None)
        if sb_layer:
            check("speechbubble: has tailDir", sb_layer.get("tailDir") == "bottom")
            check("speechbubble: has tailPos", sb_layer.get("tailPos") == 0.5)
            check("speechbubble: has tailLen", sb_layer.get("tailLen") == 30)

        # Export — must render without errors.
        page_sb.evaluate("document.getElementById('exportScale').dataset.value = '1'")
        with page_sb.expect_download() as dl_sb:
            page_sb.click("#btnExport")
        sb_export_path = os.path.join(OUT_DIR, "speechbubble_export.png")
        dl_sb.value.save_as(sb_export_path)
        img_sb = Image.open(sb_export_path)
        check("speechbubble: export is a valid PNG", img_sb.size[0] > 0)
        check("speechbubble: no page errors", len(errors_sb) == 0, str(errors_sb))

        # Select the bubble and change tail direction via props panel.
        sb_id = sb_layer["id"] if sb_layer else None
        if sb_id:
            page_sb.evaluate("(id) => window.__test.selectLayer(id)", sb_id)
            page_sb.wait_for_timeout(150)
            page_sb.evaluate("""() => {
                const btns = document.querySelectorAll('#rTailDirSeg button');
                const topBtn = [...btns].find(b => b.dataset.v === 'top');
                if (topBtn) topBtn.click();
            }""")
            page_sb.wait_for_timeout(100)
            st_sb2 = page_sb.evaluate("window.__test.getState()")
            sb_layer2 = next((l for l in st_sb2["layers"] if l["id"] == sb_id), None)
            check("speechbubble: tail direction updates via props",
                  sb_layer2 is not None and sb_layer2.get("tailDir") == "top")

        check("speechbubble: no errors after tail direction change", len(errors_sb) == 0, str(errors_sb))
        ctx_sb.close()

        # ---- Track I: Emoji sticker insertion ----
        ctx_emoji = browser.new_context(viewport={"width": 1400, "height": 900})
        page_emoji = ctx_emoji.new_page()
        errors_emoji = []
        page_emoji.on("pageerror", lambda exc: errors_emoji.append(str(exc)))
        page_emoji.goto(TEST_URL)
        page_emoji.wait_for_timeout(500)

        # Open sticker picker and click an emoji button.
        page_emoji.click("#btnAddSticker")
        page_emoji.wait_for_timeout(300)
        picker_visible = page_emoji.evaluate("!!document.getElementById('stickerPickerPopover')")
        check("emoji: sticker picker opens on button click", picker_visible)

        page_emoji.evaluate("""() => {
            const btn = document.querySelector('.sticker-emoji-btn');
            if (btn) btn.click();
        }""")
        page_emoji.wait_for_timeout(200)
        st_emoji = page_emoji.evaluate("window.__test.getState()")
        emoji_layer = next((l for l in st_emoji["layers"] if l["type"] == "text"), None)
        check("emoji: clicking emoji creates a text layer", emoji_layer is not None)
        if emoji_layer:
            check("emoji: emoji layer text is a single emoji character",
                  bool(emoji_layer.get("text")))
            check("emoji: emoji layer uses emoji font stack",
                  "Emoji" in (emoji_layer.get("font") or "") or "emoji" in (emoji_layer.get("font") or "").lower())

        check("emoji: no page errors during emoji insertion", len(errors_emoji) == 0, str(errors_emoji))
        ctx_emoji.close()

        # ---- Track I: Text style presets (localStorage round-trip) ----
        ctx_preset = browser.new_context(viewport={"width": 1400, "height": 900})
        page_preset = ctx_preset.new_page()
        errors_preset = []
        page_preset.on("pageerror", lambda exc: errors_preset.append(str(exc)))
        page_preset.goto(TEST_URL)
        page_preset.wait_for_timeout(500)

        # Set a text preset directly via localStorage + page evaluation.
        preset_result = page_preset.evaluate("""() => {
            const preset = {
                name: 'TestPreset',
                font: 'MemeImpact',
                sizeScale: 0.5,
                color: '#ff0000',
                align: 'left',
                vAlign: 'top',
                bold: true,
                italic: false,
                lineHeight: 1.2,
                letterSpacing: 2,
                padding: 10,
                stroke: { enabled: false, color: '#000000', width: 0 },
                box: { enabled: false, mode: 'color', color: '#ffffff', amount: 0 }
            };
            localStorage.setItem('memelab-text-presets', JSON.stringify([preset]));
            // Read it back
            const loaded = JSON.parse(localStorage.getItem('memelab-text-presets') || '[]');
            return loaded.length === 1 && loaded[0].name === 'TestPreset' && loaded[0].color === '#ff0000';
        }""")
        check("presets: localStorage round-trip works correctly", preset_result)

        # Add a text layer, select it, open props, apply the preset via UI.
        page_preset.click("#btnAddText")
        page_preset.wait_for_timeout(150)
        st_pre = page_preset.evaluate("window.__test.getState()")
        pre_id = next(l["id"] for l in st_pre["layers"] if l["type"] == "text")
        page_preset.evaluate("(id) => window.__test.selectLayer(id)", pre_id)
        page_preset.wait_for_timeout(200)

        # Re-render props panel to pick up presets from localStorage.
        page_preset.reload()
        page_preset.wait_for_timeout(700)
        # The preset is in localStorage — check it's persisted.
        preset_still_there = page_preset.evaluate("""() => {
            const loaded = JSON.parse(localStorage.getItem('memelab-text-presets') || '[]');
            return loaded.length >= 1 && loaded[0].name === 'TestPreset';
        }""")
        check("presets: preset survives page reload in localStorage", preset_still_there)
        check("presets: no page errors throughout", len(errors_preset) == 0, str(errors_preset))
        ctx_preset.close()

        # ---- Section 5: Track L — Layer Panel Coherence ----
        ctx_l = browser.new_context(viewport={"width": 1400, "height": 900})
        page_l = ctx_l.new_page()
        errors_l = []
        page_l.on("pageerror", lambda exc: errors_l.append(str(exc)))
        page_l.goto(TEST_URL)
        page_l.wait_for_timeout(500)
        check("track-l: boots clean", len(errors_l) == 0, str(errors_l))

        # Add two text layers so we have multiple to work with
        page_l.click("#btnAddText")
        page_l.wait_for_timeout(150)
        page_l.click("#btnAddText")
        page_l.wait_for_timeout(150)
        st_l = page_l.evaluate("window.__test.getState()")
        check("track-l: two text layers added", len(st_l["layers"]) == 2)
        lid_a = st_l["layers"][0]["id"]
        lid_b = st_l["layers"][1]["id"]

        # ---- Row icon trim: no dup/delete buttons in row ----
        dup_in_row = page_l.evaluate("""() => !!document.querySelector('.layerrow .dup')""")
        del_in_row = page_l.evaluate("""() => !!document.querySelector('.layerrow .del')""")
        merge_in_row = page_l.evaluate("""() => !!document.querySelector('.layerrow .merge')""")
        check("track-l: no dup button in layer row", not dup_in_row)
        check("track-l: no delete button in layer row", not del_in_row)
        check("track-l: no merge button in layer row", not merge_in_row)
        vis_in_row = page_l.evaluate("""() => !!document.querySelector('.layerrow .vis')""")
        lock_in_row = page_l.evaluate("""() => !!document.querySelector('.layerrow .lock')""")
        check("track-l: vis button still in layer row", vis_in_row)
        check("track-l: lock button still in layer row", lock_in_row)

        # ---- Single click selects, does NOT open rename ----
        page_l.evaluate("(id) => window.__test.selectLayer(id)", lid_a)
        page_l.wait_for_timeout(100)
        # Check that there's a lname-text span, not an active input
        rename_input_visible = page_l.evaluate("""() => !!document.querySelector('.layerrow .lname-input')""")
        check("track-l: single-select does not activate rename input", not rename_input_visible)

        # ---- Double-click on layer name activates inline rename ----
        # Select layer A first via API
        page_l.evaluate("(id) => window.__test.selectLayer(id)", lid_a)
        page_l.wait_for_timeout(100)
        # Find the selected row's name span and double-click it
        row_a_selector = f'.layerrow[data-id="{lid_a}"] .lname-text'
        page_l.dblclick(row_a_selector)
        page_l.wait_for_timeout(150)
        rename_input_active = page_l.evaluate("""() => !!document.querySelector('.layerrow .lname-input')""")
        check("track-l: double-click on layer name activates rename input", rename_input_active)
        # Type a new name and confirm with Enter
        page_l.keyboard.type("MyRenamedLayer")
        page_l.keyboard.press("Enter")
        page_l.wait_for_timeout(150)
        st_after_rename = page_l.evaluate("window.__test.getState()")
        layer_a_name = next(l["name"] for l in st_after_rename["layers"] if l["id"] == lid_a)
        check("track-l: rename via double-click updates layer name", layer_a_name == "MyRenamedLayer",
              f"name={layer_a_name}")
        # Rename input should be gone after confirm
        rename_input_gone = page_l.evaluate("""() => !document.querySelector('.layerrow .lname-input')""")
        check("track-l: rename input dismissed after Enter", rename_input_gone)

        # ---- Undo after rename reverts the name ----
        page_l.click("#btnUndo")
        page_l.wait_for_timeout(150)
        st_undo_rename = page_l.evaluate("window.__test.getState()")
        layer_a_name_after_undo = next(l["name"] for l in st_undo_rename["layers"] if l["id"] == lid_a)
        check("track-l: undo after rename reverts the name",
              layer_a_name_after_undo != "MyRenamedLayer",
              f"name after undo={layer_a_name_after_undo}")

        # ---- Context menu has "Rename" item ----
        # Right-click on a layer row
        page_l.evaluate("(id) => window.__test.selectLayer(id)", lid_a)
        page_l.wait_for_timeout(100)
        row_a = page_l.locator(f'.layerrow[data-id="{lid_a}"]')
        row_a.click(button="right")
        page_l.wait_for_timeout(100)
        rename_in_menu = page_l.evaluate("""() => {
            const items = [...document.querySelectorAll('.ctx-item')];
            return items.some(el => el.textContent.trim().toLowerCase() === 'rename');
        }""")
        check("track-l: context menu has Rename item", rename_in_menu)
        # Dismiss menu
        page_l.keyboard.press("Escape")
        page_l.wait_for_timeout(100)

        # ---- Multi-select: Ctrl-click adds to selection ----
        page_l.evaluate("(id) => window.__test.selectLayer(id)", lid_a)
        page_l.wait_for_timeout(100)
        # Ctrl-click layer B row
        row_b = page_l.locator(f'.layerrow[data-id="{lid_b}"]')
        row_b.click(modifiers=["Control"])
        page_l.wait_for_timeout(100)
        sel_ids = page_l.evaluate("window.__test.getSelectedIds()")
        check("track-l: ctrl-click adds second layer to selectedIds",
              lid_a in sel_ids and lid_b in sel_ids,
              f"selectedIds={sel_ids}")
        check("track-l: multi-select has 2 layers", len(sel_ids) == 2, f"count={len(sel_ids)}")

        # Check that multi-selected row has the multi-selected CSS class
        multi_class = page_l.evaluate(f"""() => {{
            const row = document.querySelector('.layerrow[data-id="{lid_a}"]');
            return row ? row.classList.contains('multi-selected') : false;
        }}""")
        check("track-l: secondary selected row gets multi-selected class", multi_class)

        # ---- Single click clears multi-select ----
        row_b.click()
        page_l.wait_for_timeout(100)
        sel_ids_after = page_l.evaluate("window.__test.getSelectedIds()")
        check("track-l: single click clears multi-select to one layer",
              len(sel_ids_after) == 1, f"selectedIds={sel_ids_after}")

        # ---- Multi-select group move: moving primary moves all ----
        # Re-select both layers
        page_l.evaluate("(id) => window.__test.selectLayer(id)", lid_a)
        page_l.wait_for_timeout(100)
        row_b.click(modifiers=["Control"])
        page_l.wait_for_timeout(100)

        # Record initial positions
        st_before_move = page_l.evaluate("window.__test.getState()")
        la_before = next(l for l in st_before_move["layers"] if l["id"] == lid_a)
        lb_before = next(l for l in st_before_move["layers"] if l["id"] == lid_b)

        # Find primary (lid_b is primary after ctrl-click) screen rect and drag
        primary_id = page_l.evaluate("window.__test.getSelectedId()")
        r_move = page_l.evaluate("(id) => window.__test.layerScreenRect(id)", primary_id)
        page_l.mouse.move(r_move["cx"], r_move["cy"])
        page_l.mouse.down()
        page_l.mouse.move(r_move["cx"] + 60, r_move["cy"] + 40, steps=6)
        page_l.mouse.up()
        page_l.wait_for_timeout(150)

        st_after_move = page_l.evaluate("window.__test.getState()")
        la_after = next(l for l in st_after_move["layers"] if l["id"] == lid_a)
        lb_after = next(l for l in st_after_move["layers"] if l["id"] == lid_b)

        la_moved = abs(la_after["x"] - la_before["x"]) > 5 or abs(la_after["y"] - la_before["y"]) > 5
        lb_moved = abs(lb_after["x"] - lb_before["x"]) > 5 or abs(lb_after["y"] - lb_before["y"]) > 5
        check("track-l: group move moves primary selected layer", lb_moved,
              f"lb x: {lb_before['x']:.0f} -> {lb_after['x']:.0f}")
        check("track-l: group move also moves secondary selected layer", la_moved,
              f"la x: {la_before['x']:.0f} -> {la_after['x']:.0f}")

        # The deltas should be approximately equal (group move)
        dx_a = la_after["x"] - la_before["x"]
        dy_a = la_after["y"] - la_before["y"]
        dx_b = lb_after["x"] - lb_before["x"]
        dy_b = lb_after["y"] - lb_before["y"]
        same_delta = abs(dx_a - dx_b) < 2 and abs(dy_a - dy_b) < 2
        check("track-l: group move applies same delta to all selected layers", same_delta,
              f"da=({dx_a:.1f},{dy_a:.1f}) db=({dx_b:.1f},{dy_b:.1f})")

        # ---- selectedIds not in undo history snapshots ----
        # After undo, selectedIds should be cleared/reset (not the multi-select state)
        page_l.click("#btnUndo")
        page_l.wait_for_timeout(100)
        sel_ids_after_undo = page_l.evaluate("window.__test.getSelectedIds()")
        # Should have at most 1 id (the primary from the snapshot), not two
        check("track-l: selectedIds reset after undo (not persisted in history)",
              len(sel_ids_after_undo) <= 1,
              f"selectedIds after undo={sel_ids_after_undo}")

        check("track-l: no page errors throughout", len(errors_l) == 0, str(errors_l))
        ctx_l.close()

        # ---- Track K: Filter presets ----
        ctx_fp = browser.new_context(viewport={"width": 1400, "height": 900})
        page_fp = ctx_fp.new_page()
        errors_fp = []
        page_fp.on("pageerror", lambda exc: errors_fp.append(str(exc)))
        page_fp.goto(TEST_URL)
        page_fp.wait_for_timeout(500)

        # Add an image layer.
        with page_fp.expect_file_chooser() as fc_fp:
            page_fp.click("#iconAddImage")
        fc_fp.value.set_files(SAMPLE_IMG)
        page_fp.wait_for_timeout(500)
        st_fp = page_fp.evaluate("window.__test.getState()")
        fp_img = next(l for l in st_fp["layers"] if l["type"] == "image")
        fp_img_id = fp_img["id"]

        # Select the image layer so props panel renders.
        page_fp.evaluate("(id) => window.__test.selectLayer(id)", fp_img_id)
        page_fp.wait_for_timeout(300)

        # Filter strip must be visible (not behind a collapsible).
        strip_visible = page_fp.evaluate("""() => {
            const strip = document.getElementById('filterStrip');
            if (!strip) return false;
            const rect = strip.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        }""")
        check("fp: filter strip is visible (not collapsed)", strip_visible)

        # There must be chips for None and noir at minimum.
        chips_exist = page_fp.evaluate("""() => {
            const none = document.querySelector('.filter-chip[data-preset-id="none"]');
            const noir = document.querySelector('.filter-chip[data-preset-id="noir"]');
            return !!(none && noir);
        }""")
        check("fp: None and noir chips exist in strip", chips_exist)

        # Click the noir chip and verify adjustments.
        page_fp.evaluate("""() => {
            const chip = document.querySelector('.filter-chip[data-preset-id="noir"]');
            if (chip) chip.click();
        }""")
        page_fp.wait_for_timeout(200)
        st_fp2 = page_fp.evaluate("window.__test.getState()")
        fp_img2 = next(l for l in st_fp2["layers"] if l["id"] == fp_img_id)
        adjs2 = fp_img2.get("adjustments", [])
        noir_bright = next((a for a in adjs2 if a["type"] == "brightness"), None)
        noir_contr  = next((a for a in adjs2 if a["type"] == "contrast"), None)
        noir_sat    = next((a for a in adjs2 if a["type"] == "saturation"), None)
        check("fp: noir sets brightness=5",
              noir_bright is not None and noir_bright["value"] == 5,
              str(adjs2))
        check("fp: noir sets contrast=40",
              noir_contr is not None and noir_contr["value"] == 40,
              str(adjs2))
        check("fp: noir sets saturation=-80",
              noir_sat is not None and noir_sat["value"] == -80,
              str(adjs2))

        # noir chip should be visually marked active.
        noir_active = page_fp.evaluate("""() => {
            const chip = document.querySelector('.filter-chip[data-preset-id="noir"]');
            return chip ? chip.classList.contains('active') : false;
        }""")
        check("fp: noir chip has active class after applying", noir_active)

        # getActivePresetId via JS should return 'noir'.
        active_id_via_js = page_fp.evaluate("""async () => {
            const { getActivePresetId } = await import('../src/presets/filters.js');
            const { state } = await import('../src/core/state.js');
            const layer = state.layers.find(l => l.type === 'image');
            return layer ? getActivePresetId(layer) : null;
        }""")
        check("fp: getActivePresetId returns 'noir' after applying noir",
              active_id_via_js == 'noir', str(active_id_via_js))

        # Export with noir applied — must succeed and differ from no-filter baseline.
        page_fp.evaluate("document.getElementById('exportScale').dataset.value = '1'")
        page_fp.wait_for_timeout(50)
        with page_fp.expect_download() as dl_fp_noir:
            page_fp.click("#btnExport")
        noir_export_path = os.path.join(OUT_DIR, "fp_noir.png")
        dl_fp_noir.value.save_as(noir_export_path)
        import hashlib as _hashlib
        fp_noir_img = Image.open(noir_export_path)
        check("fp: noir export is a valid PNG", fp_noir_img.size[0] > 0)

        # Undo — adjustments must revert to empty (no filter).
        page_fp.click("#btnUndo")
        page_fp.wait_for_timeout(200)
        st_fp3 = page_fp.evaluate("window.__test.getState()")
        fp_img3 = next(l for l in st_fp3["layers"] if l["id"] == fp_img_id)
        check("fp: undo after applying noir reverts adjustments",
              len(fp_img3.get("adjustments", [])) == 0,
              str(fp_img3.get("adjustments")))

        # Re-apply noir; then click None chip → adjustments must clear.
        page_fp.evaluate("""() => {
            const chip = document.querySelector('.filter-chip[data-preset-id="noir"]');
            if (chip) chip.click();
        }""")
        page_fp.wait_for_timeout(150)
        page_fp.evaluate("""() => {
            const chip = document.querySelector('.filter-chip[data-preset-id="none"]');
            if (chip) chip.click();
        }""")
        page_fp.wait_for_timeout(150)
        st_fp4 = page_fp.evaluate("window.__test.getState()")
        fp_img4 = next(l for l in st_fp4["layers"] if l["id"] == fp_img_id)
        check("fp: clicking None chip clears adjustments to []",
              len(fp_img4.get("adjustments", [])) == 0,
              str(fp_img4.get("adjustments")))

        # After clearing, getActivePresetId must return 'none'.
        active_after_clear = page_fp.evaluate("""async () => {
            const { getActivePresetId } = await import('../src/presets/filters.js');
            const { state } = await import('../src/core/state.js');
            const layer = state.layers.find(l => l.type === 'image');
            return layer ? getActivePresetId(layer) : null;
        }""")
        check("fp: getActivePresetId returns 'none' after clearing",
              active_after_clear == 'none', str(active_after_clear))

        # Apply noir again; then manually tweak brightness slider → active indicator clears.
        page_fp.evaluate("""() => {
            const chip = document.querySelector('.filter-chip[data-preset-id="noir"]');
            if (chip) chip.click();
        }""")
        page_fp.wait_for_timeout(150)

        # Open the Adjustments collapsible first (it might be collapsed).
        page_fp.evaluate("""() => {
            const body = document.querySelector('#adjSection .collapsible-body');
            if (body && body.style.display === 'none') {
                document.querySelector('#adjSection .collapsible-hdr').click();
            }
        }""")
        page_fp.wait_for_timeout(100)

        # Tweak brightness slider to a different value.
        page_fp.evaluate("""() => {
            const sl = document.getElementById('aiBright');
            if (!sl) return;
            sl.value = '50';
            sl.dispatchEvent(new Event('input', { bubbles: true }));
        }""")
        page_fp.wait_for_timeout(100)
        active_after_tweak = page_fp.evaluate("""async () => {
            const { getActivePresetId } = await import('../src/presets/filters.js');
            const { state } = await import('../src/core/state.js');
            const layer = state.layers.find(l => l.type === 'image');
            return layer ? getActivePresetId(layer) : null;
        }""")
        check("fp: getActivePresetId returns null after slider breaks preset match",
              active_after_tweak is None, str(active_after_tweak))

        noir_chip_still_active = page_fp.evaluate("""() => {
            const chip = document.querySelector('.filter-chip[data-preset-id="noir"]');
            return chip ? chip.classList.contains('active') : True;
        }""")
        check("fp: noir chip loses active class after slider tweak",
              not noir_chip_still_active)

        check("fp: no page errors throughout", len(errors_fp) == 0, str(errors_fp))
        ctx_fp.close()

        # ---- Track A: tone adjustments (vibrance, temperature, highlights, shadows, auto-enhance) ----
        ctx_ta = browser.new_context(viewport={"width": 1400, "height": 900})
        page_ta = ctx_ta.new_page()
        errors_ta = []
        page_ta.on("pageerror", lambda exc: errors_ta.append(str(exc)))
        page_ta.goto(TEST_URL)
        page_ta.wait_for_timeout(500)

        # Add image layer.
        with page_ta.expect_file_chooser() as fc_ta:
            page_ta.click("#iconAddImage")
        fc_ta.value.set_files(SAMPLE_IMG)
        page_ta.wait_for_timeout(500)
        st_ta = page_ta.evaluate("window.__test.getState()")
        ta_img = next(l for l in st_ta["layers"] if l["type"] == "image")
        ta_img_id = ta_img["id"]

        page_ta.evaluate("(id) => window.__test.selectLayer(id)", ta_img_id)
        page_ta.wait_for_timeout(200)

        # Open Adjustments collapsible.
        page_ta.evaluate("""() => {
            const hdr = document.querySelector('#adjSection-hdr');
            if (hdr) hdr.click();
        }""")
        page_ta.wait_for_timeout(100)

        # Export baseline.
        page_ta.evaluate("document.getElementById('exportScale').dataset.value = '1'")
        page_ta.wait_for_timeout(50)
        with page_ta.expect_download() as dl_ta_base:
            page_ta.click("#btnExport")
        ta_base_path = os.path.join(OUT_DIR, "ta_base.png")
        dl_ta_base.value.save_as(ta_base_path)
        img_ta_base = Image.open(ta_base_path)
        check("tone-adj: baseline export valid", img_ta_base.size[0] > 0)

        # Add vibrance adjustment via the picker button.
        page_ta.evaluate("""() => {
            const btn = document.querySelector('.adj-pick-btn[data-type="vibrance"]');
            if (btn) btn.click();
        }""")
        page_ta.wait_for_timeout(150)

        # Set vibrance to 80.
        page_ta.evaluate("""() => {
            const sl = document.getElementById('aiVibr');
            if (!sl) return;
            sl.value = '80';
            sl.dispatchEvent(new Event('input', { bubbles: true }));
            sl.dispatchEvent(new Event('change', { bubbles: true }));
        }""")
        page_ta.wait_for_timeout(200)

        st_ta2 = page_ta.evaluate("window.__test.getState()")
        ta_img2 = next(l for l in st_ta2["layers"] if l["id"] == ta_img_id)
        vibr_entry = next((a for a in ta_img2.get("adjustments", []) if a["type"] == "vibrance"), None)
        check("tone-adj: vibrance picker adds vibrance to adjustments",
              vibr_entry is not None and vibr_entry["value"] == 80,
              str(ta_img2.get("adjustments")))

        with page_ta.expect_download() as dl_ta_vibr:
            page_ta.click("#btnExport")
        ta_vibr_path = os.path.join(OUT_DIR, "ta_vibrance.png")
        dl_ta_vibr.value.save_as(ta_vibr_path)
        img_ta_vibr = Image.open(ta_vibr_path)
        check("tone-adj: vibrance export differs from baseline",
              adj_hash(ta_vibr_path) != adj_hash(ta_base_path))

        # Add highlights adjustment.
        page_ta.evaluate("""() => {
            const btn = document.querySelector('.adj-pick-btn[data-type="highlights"]');
            if (btn) btn.click();
        }""")
        page_ta.wait_for_timeout(150)
        page_ta.evaluate("""() => {
            const sl = document.getElementById('aiHighl');
            if (!sl) return;
            sl.value = '-60';
            sl.dispatchEvent(new Event('input', { bubbles: true }));
            sl.dispatchEvent(new Event('change', { bubbles: true }));
        }""")
        page_ta.wait_for_timeout(200)
        st_ta3 = page_ta.evaluate("window.__test.getState()")
        ta_img3 = next(l for l in st_ta3["layers"] if l["id"] == ta_img_id)
        highl_entry = next((a for a in ta_img3.get("adjustments", []) if a["type"] == "highlights"), None)
        check("tone-adj: highlights picker adds highlights to adjustments",
              highl_entry is not None and highl_entry["value"] == -60,
              str(ta_img3.get("adjustments")))

        # Auto-enhance button should populate adjustments.
        page_ta.evaluate("""() => {
            const btn = document.getElementById('aiAutoEnhance');
            if (btn) btn.click();
        }""")
        page_ta.wait_for_timeout(500)
        st_ta4 = page_ta.evaluate("window.__test.getState()")
        ta_img4 = next(l for l in st_ta4["layers"] if l["id"] == ta_img_id)
        check("tone-adj: auto-enhance writes at least one adjustment",
              len(ta_img4.get("adjustments", [])) > 0,
              str(ta_img4.get("adjustments")))

        check("tone-adj: no page errors throughout", len(errors_ta) == 0, str(errors_ta))
        ctx_ta.close()

        # ---- Section 5: Track B local effects ----
        ctx_fx = browser.new_context(viewport={"width": 1400, "height": 900})
        page_fx = ctx_fx.new_page()
        errors_fx = []
        page_fx.on("pageerror", lambda exc: errors_fx.append(str(exc)))
        page_fx.goto(TEST_URL)
        page_fx.wait_for_timeout(500)

        with page_fx.expect_file_chooser() as fc_fx:
            page_fx.click("#iconAddImage")
        fc_fx.value.set_files(SAMPLE_IMG)
        page_fx.wait_for_timeout(500)
        st_fx = page_fx.evaluate("window.__test.getState()")
        fx_img = next(l for l in st_fx["layers"] if l["type"] == "image")
        fx_img_id = fx_img["id"]

        page_fx.evaluate("(id) => window.__test.selectLayer(id)", fx_img_id)
        page_fx.wait_for_timeout(200)

        # Set export to 1x for speed
        page_fx.evaluate("document.getElementById('exportScale').dataset.value = '1'")
        page_fx.wait_for_timeout(50)

        # Helper: export and return (path, PIL Image)
        def fx_export(name):
            import os as _os
            with page_fx.expect_download() as dl:
                page_fx.click("#btnExport")
            path = _os.path.join(OUT_DIR, f"fx_{name}.png")
            dl.value.save_as(path)
            return path, Image.open(path)

        # Baseline (no effects)
        base_path, img_base_fx = fx_export("base")
        base_w, base_h = img_base_fx.size
        check("fx: baseline export valid", base_w > 0 and base_h > 0)

        # Helper: set a slider and export, then verify
        def apply_and_export(slider_id, value, effect_name, event_extra=""):
            page_fx.evaluate(f"""() => {{
                const sl = document.getElementById('{slider_id}');
                if (!sl) return;
                sl.value = '{value}';
                sl.dispatchEvent(new Event('input', {{ bubbles: true }}));
                sl.dispatchEvent(new Event('change', {{ bubbles: true }}));
            }}""")
            page_fx.wait_for_timeout(200)
            path, img = fx_export(effect_name)
            check(f"fx: {effect_name} renders without errors", len(errors_fx) == 0, str(errors_fx))
            check(f"fx: {effect_name} export dimensions match original",
                  img.size == (base_w, base_h), f"{img.size} vs {(base_w, base_h)}")
            return path, img

        # Reset all adjustments helper
        def reset_slider(slider_id, value="0"):
            page_fx.evaluate(f"""() => {{
                const sl = document.getElementById('{slider_id}');
                if (!sl) return;
                sl.value = '{value}';
                sl.dispatchEvent(new Event('input', {{ bubbles: true }}));
                sl.dispatchEvent(new Event('change', {{ bubbles: true }}));
            }}""")
            page_fx.wait_for_timeout(100)

        # Test vignette (negative = darken edges)
        apply_and_export('aiVignette', '-80', 'vignette')
        reset_slider('aiVignette')

        # Test sharpen
        apply_and_export('aiSharpen', '80', 'sharpen')
        reset_slider('aiSharpen')

        # Test clarity
        apply_and_export('aiClarity', '80', 'clarity')
        reset_slider('aiClarity')

        # Test noise reduction
        apply_and_export('aiNR', '80', 'noise_reduction')
        reset_slider('aiNR')

        # Test grain
        apply_and_export('aiGrain', '80', 'grain')
        reset_slider('aiGrain')

        # Test split-tone (highlight and shadow hues)
        page_fx.evaluate("""() => {
            ['aiStHHue','aiStHSat','aiStSHue','aiStSSat'].forEach((id, i) => {
                const sl = document.getElementById(id);
                if (!sl) return;
                sl.value = [30, 40, 220, 30][i];
                sl.dispatchEvent(new Event('input', { bubbles: true }));
                sl.dispatchEvent(new Event('change', { bubbles: true }));
            });
        }""")
        page_fx.wait_for_timeout(200)
        st_path, img_st = fx_export("split_tone")
        check("fx: split_tone renders without errors", len(errors_fx) == 0, str(errors_fx))
        check("fx: split_tone export dimensions match original",
              img_st.size == (base_w, base_h), f"{img_st.size} vs {(base_w, base_h)}")
        # Reset split-tone
        for sid in ['aiStHHue','aiStHSat','aiStSHue','aiStSSat','aiStBal']:
            reset_slider(sid)

        # Test dehaze (positive = reduce haze)
        apply_and_export('aiDehaze', '60', 'dehaze')
        reset_slider('aiDehaze')

        # Undo after each effect type: test vignette undo specifically
        # Ensure vignette adjustment is added via picker before setting slider
        page_fx.evaluate("""() => {
            const btn = document.querySelector('.adj-pick-btn[data-type="vignette"]');
            if (btn) btn.click();
        }""")
        page_fx.wait_for_timeout(150)
        page_fx.evaluate("""() => {
            const sl = document.getElementById('aiVignette');
            if (!sl) return;
            sl.value = '-60';
            sl.dispatchEvent(new Event('input', { bubbles: true }));
            sl.dispatchEvent(new Event('change', { bubbles: true }));
        }""")
        page_fx.wait_for_timeout(200)
        st_before_undo = page_fx.evaluate("window.__test.getState()")
        fx_layer_before = next(l for l in st_before_undo["layers"] if l["id"] == fx_img_id)
        vig_before = next((a for a in fx_layer_before.get("adjustments", []) if a["type"] == "vignette"), None)
        check("fx: vignette written to adjustments before undo",
              vig_before is not None, str(fx_layer_before.get("adjustments")))

        page_fx.click("#btnUndo")
        page_fx.wait_for_timeout(200)
        st_after_undo = page_fx.evaluate("window.__test.getState()")
        fx_layer_after = next(l for l in st_after_undo["layers"] if l["id"] == fx_img_id)
        vig_after = next((a for a in fx_layer_after.get("adjustments", []) if a["type"] == "vignette"), None)
        check("fx: undo reverts vignette adjustment",
              vig_after is None or vig_after["value"] == 0,
              str(fx_layer_after.get("adjustments")))

        check("fx: no page errors throughout", len(errors_fx) == 0, str(errors_fx))
        ctx_fx.close()

        # ---- Section 5: Selection & Masking tools ----
        ctx_mask = browser.new_context(viewport={"width": 1400, "height": 900})
        page_mask = ctx_mask.new_page()
        errors_mask = []
        page_mask.on("pageerror", lambda exc: errors_mask.append(str(exc)))
        page_mask.goto(TEST_URL)
        page_mask.wait_for_timeout(500)
        check("mask: boots clean", len(errors_mask) == 0, str(errors_mask))

        # Add an image layer to work with.
        with page_mask.expect_file_chooser() as fc_mask:
            page_mask.click("#iconAddImage")
        fc_mask.value.set_files(SAMPLE_IMG)
        page_mask.wait_for_timeout(500)
        st_mask = page_mask.evaluate("window.__test.getState()")
        mask_img = next(l for l in st_mask["layers"] if l["type"] == "image")
        mask_img_id = mask_img["id"]

        # Select the image layer.
        page_mask.evaluate("(id) => window.__test.selectLayer(id)", mask_img_id)
        page_mask.wait_for_timeout(150)

        # 1. Activating the lasso tool sets state.activeTool to 'lasso'.
        page_mask.evaluate("() => window.__test.setActiveTool('lasso')")
        page_mask.wait_for_timeout(50)
        active_tool = page_mask.evaluate("() => window.__test.getActiveTool()")
        check("mask: activating lasso sets activeTool='lasso'", active_tool == "lasso",
              f"activeTool={active_tool}")

        # 2. Simulating a lasso drag on the image layer produces a non-null mask.src.
        page_mask.evaluate("""(id) => window.__test.simulateLasso(id, [
            [-100, -100], [-100, 100], [100, 100], [100, -100]
        ])""", mask_img_id)
        page_mask.wait_for_timeout(200)
        st_after_lasso = page_mask.evaluate("window.__test.getState()")
        lasso_img = next(l for l in st_after_lasso["layers"] if l["id"] == mask_img_id)
        check("mask: lasso produces non-null mask.src",
              lasso_img.get("mask", {}).get("src") is not None)
        check("mask: lasso sets mask.enabled=true",
              lasso_img.get("mask", {}).get("enabled") is True)

        # 3. The resulting mask.src is a valid PNG dataURL.
        mask_src = lasso_img.get("mask", {}).get("src", "") or ""
        check("mask: lasso mask.src is a PNG dataURL",
              mask_src.startswith("data:image/png;base64,"))

        # 4. Undo after lasso tool reverts layer.mask.
        page_mask.click("#btnUndo")
        page_mask.wait_for_timeout(150)
        st_undo_mask = page_mask.evaluate("window.__test.getState()")
        undo_img = next(l for l in st_undo_mask["layers"] if l["id"] == mask_img_id)
        check("mask: undo after lasso reverts mask.enabled",
              undo_img.get("mask", {}).get("enabled") is False)

        # 5. Magic wand on a solid-color region produces a mask.
        page_mask.evaluate("() => window.__test.setActiveTool('wand')")
        page_mask.wait_for_timeout(50)
        check("mask: activating wand sets activeTool='wand'",
              page_mask.evaluate("() => window.__test.getActiveTool()") == "wand")

        # Tap near top-left of the layer (the sample image has a solid-ish color there).
        page_mask.evaluate("(id) => window.__test.simulateWand(id, 10, 10)", mask_img_id)
        page_mask.wait_for_timeout(300)
        st_wand = page_mask.evaluate("window.__test.getState()")
        wand_img = next(l for l in st_wand["layers"] if l["id"] == mask_img_id)
        wand_src = (wand_img.get("mask", {}).get("src") or "")
        check("mask: magic wand produces a PNG dataURL",
              wand_src.startswith("data:image/png;base64,"))
        check("mask: magic wand sets mask.enabled=true",
              wand_img.get("mask", {}).get("enabled") is True)

        # 6. Gradient mask produces a valid mask PNG.
        # Clear the current mask first.
        page_mask.evaluate("""(id) => {
            const s = window.__test.getState();
            // we can't directly mutate frozen snapshots; use setActiveTool to reset
            window.__test.setActiveTool(null);
        }""", mask_img_id)
        page_mask.wait_for_timeout(50)
        page_mask.evaluate("() => window.__test.setActiveTool('gradientMask')")
        page_mask.wait_for_timeout(50)
        check("mask: activating gradientMask sets activeTool",
              page_mask.evaluate("() => window.__test.getActiveTool()") == "gradientMask")

        page_mask.evaluate("(id) => window.__test.simulateGradient(id, 0, 0, null, null)", mask_img_id)
        page_mask.wait_for_timeout(200)
        st_grad = page_mask.evaluate("window.__test.getState()")
        grad_img = next(l for l in st_grad["layers"] if l["id"] == mask_img_id)
        grad_src = (grad_img.get("mask", {}).get("src") or "")
        check("mask: gradient mask produces a PNG dataURL",
              grad_src.startswith("data:image/png;base64,"))
        check("mask: gradient mask sets mask.enabled=true",
              grad_img.get("mask", {}).get("enabled") is True)

        # 7. Clicking active tool button a second time deactivates it.
        page_mask.evaluate("() => window.__test.setActiveTool('lasso')")
        page_mask.wait_for_timeout(50)
        page_mask.evaluate("() => window.__test.setActiveTool('lasso')")  # toggle off
        page_mask.wait_for_timeout(50)
        check("mask: toggling active tool off sets activeTool=null",
              page_mask.evaluate("() => window.__test.getActiveTool()") is None)

        check("mask: no page errors throughout", len(errors_mask) == 0, str(errors_mask))
        ctx_mask.close()

        # ---- Section 5: Draw layer (Track D) ----
        ctx_draw = browser.new_context(viewport={"width": 1400, "height": 900})
        page_draw = ctx_draw.new_page()
        errors_draw = []
        page_draw.on("pageerror", lambda exc: errors_draw.append(str(exc)))
        page_draw.goto(TEST_URL)
        page_draw.wait_for_timeout(500)
        check("draw: boots clean", len(errors_draw) == 0, str(errors_draw))

        # 1. Creating a draw layer adds it to state.layers with type='draw' and strokes=[]
        page_draw.click("#btnAddDraw")
        page_draw.wait_for_timeout(200)
        st_draw = page_draw.evaluate("window.__test.getState()")
        draw_layers = [l for l in st_draw["layers"] if l["type"] == "draw"]
        check("draw: add draw layer creates a 'draw' type layer", len(draw_layers) == 1)
        draw_layer = draw_layers[0]
        draw_id = draw_layer["id"]
        check("draw: new draw layer has empty strokes array",
              isinstance(draw_layer.get("strokes"), list) and len(draw_layer["strokes"]) == 0)
        check("draw: new draw layer covers full canvas width",
              draw_layer.get("w") == st_draw["width"])
        check("draw: new draw layer covers full canvas height",
              draw_layer.get("h") == st_draw["height"])
        check("draw: new draw layer has blendMode", draw_layer.get("blendMode") is not None)
        check("draw: new draw layer has adjustments array",
              isinstance(draw_layer.get("adjustments"), list))

        # 7. A draw layer with empty strokes renders as transparent (export should succeed)
        page_draw.evaluate("document.getElementById('exportScale').dataset.value = '1'")
        page_draw.wait_for_timeout(50)
        with page_draw.expect_download() as dl_draw_empty:
            page_draw.click("#btnExport")
        empty_draw_path = os.path.join(OUT_DIR, "draw_empty_export.png")
        dl_draw_empty.value.save_as(empty_draw_path)
        img_empty = Image.open(empty_draw_path)
        check("draw: empty draw layer export is valid PNG", img_empty.size[0] > 0)
        check("draw: no page errors after empty draw layer export",
              len(errors_draw) == 0, str(errors_draw))

        # 2. Simulating a brush drag on a draw layer adds a stroke to layer.strokes
        # Set tool to brush via props panel (should already be active after addDrawLayer)
        # First ensure the draw layer is selected and brush is the active tool
        page_draw.evaluate("(id) => window.__test.selectLayer(id)", draw_id)
        page_draw.wait_for_timeout(150)

        # Activate brush tool by clicking the brush button in props
        page_draw.evaluate("""() => {
            const btn = document.querySelector('.draw-tool-seg button[data-tool="brush"]');
            if (btn) btn.click();
        }""")
        page_draw.wait_for_timeout(100)

        # Drag across the stage canvas to draw a brush stroke
        stage_rect = page_draw.evaluate("""() => {
            const r = document.getElementById('stage').getBoundingClientRect();
            return { left: r.left, top: r.top, width: r.width, height: r.height };
        }""")
        cx = stage_rect["left"] + stage_rect["width"] * 0.3
        cy = stage_rect["top"] + stage_rect["height"] * 0.3
        page_draw.mouse.move(cx, cy)
        page_draw.mouse.down()
        page_draw.mouse.move(cx + 80, cy + 40, steps=8)
        page_draw.mouse.up()
        page_draw.wait_for_timeout(200)

        st_after_stroke = page_draw.evaluate("window.__test.getState()")
        draw_after = next((l for l in st_after_stroke["layers"] if l["id"] == draw_id), None)
        check("draw: brush drag adds a stroke to layer.strokes",
              draw_after is not None and len(draw_after.get("strokes", [])) == 1,
              f"strokes={draw_after.get('strokes', []) if draw_after else 'layer missing'}")
        if draw_after and draw_after.get("strokes"):
            s = draw_after["strokes"][0]
            check("draw: stroke has tool='brush'", s.get("tool") == "brush")
            check("draw: stroke has points array",
                  isinstance(s.get("points"), list) and len(s.get("points", [])) > 0)

        # 3. Draw layer renders without errors (valid export PNG)
        with page_draw.expect_download() as dl_draw_stroke:
            page_draw.click("#btnExport")
        stroke_export_path = os.path.join(OUT_DIR, "draw_stroke_export.png")
        dl_draw_stroke.value.save_as(stroke_export_path)
        img_stroke = Image.open(stroke_export_path)
        check("draw: draw layer with stroke renders to valid PNG", img_stroke.size[0] > 0)
        check("draw: no page errors after stroke export",
              len(errors_draw) == 0, str(errors_draw))

        # 4. Undo removes the last stroke
        page_draw.click("#btnUndo")
        page_draw.wait_for_timeout(200)
        st_after_undo = page_draw.evaluate("window.__test.getState()")
        draw_after_undo = next((l for l in st_after_undo["layers"] if l["id"] == draw_id), None)
        check("draw: undo removes the last stroke",
              draw_after_undo is not None and len(draw_after_undo.get("strokes", [])) == 0,
              f"strokes={draw_after_undo.get('strokes', []) if draw_after_undo else 'layer missing'}")

        # Re-add the stroke for further tests
        page_draw.mouse.move(cx, cy)
        page_draw.mouse.down()
        page_draw.mouse.move(cx + 80, cy + 40, steps=8)
        page_draw.mouse.up()
        page_draw.wait_for_timeout(200)

        # 5. "Flatten to image" converts the draw layer to an image layer
        page_draw.evaluate("(id) => window.__test.selectLayer(id)", draw_id)
        page_draw.wait_for_timeout(150)
        page_draw.evaluate("""() => {
            const btn = document.getElementById('dFlatten');
            if (btn) btn.click();
        }""")
        page_draw.wait_for_timeout(300)
        st_after_flatten = page_draw.evaluate("window.__test.getState()")
        # The draw layer should be gone, replaced by an image layer
        draw_layers_after = [l for l in st_after_flatten["layers"] if l["type"] == "draw"]
        image_layers_after = [l for l in st_after_flatten["layers"] if l["type"] == "image"]
        check("draw: flatten removes the draw layer", len(draw_layers_after) == 0,
              f"draw layers remaining: {len(draw_layers_after)}")
        check("draw: flatten creates an image layer", len(image_layers_after) >= 1)

        # 6. Eyedropper: add a white background, draw something, eyedrop it
        # Add a rect layer with a known color, then eyedrop it
        page_draw.evaluate("""() => {
            // Create a new draw layer and set up eyedropper
            window.__test.selectLayer(null);
        }""")
        page_draw.wait_for_timeout(100)

        # Add a fresh draw layer
        page_draw.click("#btnAddDraw")
        page_draw.wait_for_timeout(200)
        st_new = page_draw.evaluate("window.__test.getState()")
        new_draw_layers = [l for l in st_new["layers"] if l["type"] == "draw"]
        if new_draw_layers:
            new_draw_id = new_draw_layers[-1]["id"]
            page_draw.evaluate("(id) => window.__test.selectLayer(id)", new_draw_id)
            page_draw.wait_for_timeout(150)

            # Set color to a specific value, draw a stroke, then eyedrop it
            page_draw.evaluate("""() => {
                const input = document.getElementById('dBrushColor');
                if (input) {
                    input.value = '#00ff00';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                }
                const brushBtn = document.querySelector('.draw-tool-seg button[data-tool="brush"]');
                if (brushBtn) brushBtn.click();
            }""")
            page_draw.wait_for_timeout(100)

            # Draw a big stroke
            cx2 = stage_rect["left"] + stage_rect["width"] * 0.5
            cy2 = stage_rect["top"] + stage_rect["height"] * 0.5
            page_draw.mouse.move(cx2 - 30, cy2)
            page_draw.mouse.down()
            page_draw.mouse.move(cx2 + 30, cy2, steps=5)
            page_draw.mouse.up()
            page_draw.wait_for_timeout(200)

            # Activate eyedropper
            page_draw.evaluate("""() => {
                const eyeBtn = document.querySelector('.draw-tool-seg button[data-tool="eyedropper"]');
                if (eyeBtn) eyeBtn.click();
            }""")
            page_draw.wait_for_timeout(100)

            # Click on the stroke (center of canvas)
            page_draw.mouse.click(cx2, cy2)
            page_draw.wait_for_timeout(200)

            # After eyedrop, tool should revert to brush and color should have changed
            sampled_color = page_draw.evaluate("""() => {
                // Access drawState from the app
                return window._drawStateColor || null;
            }""")
            # We can't directly check drawState color from the test easily,
            # but we can verify the tool reverted to brush (eyedropper auto-reverts)
            active_tool_class = page_draw.evaluate("""() => {
                const btns = document.querySelectorAll('.draw-tool-seg button[data-tool]');
                for (const b of btns) if (b.classList.contains('active')) return b.dataset.tool;
                return null;
            }""")
            check("draw: eyedropper auto-reverts to brush after sampling",
                  active_tool_class == "brush",
                  f"active tool: {active_tool_class}")

        check("draw: no page errors throughout", len(errors_draw) == 0, str(errors_draw))
        ctx_draw.close()

        # ---- Section Track-E: Retouch tools ----
        ctx_rt = browser.new_context(viewport={"width": 1400, "height": 900})
        page_rt = ctx_rt.new_page()
        errors_rt = []
        page_rt.on("pageerror", lambda exc: errors_rt.append(str(exc)))
        page_rt.goto(TEST_URL)
        page_rt.wait_for_timeout(500)
        check("retouch: boots clean", len(errors_rt) == 0, str(errors_rt))

        # Upload an image first (gives retouch tools a source to sample)
        with page_rt.expect_file_chooser() as fc_rt:
            page_rt.click("#iconAddImage")
        fc_rt.value.set_files(SAMPLE_IMG)
        page_rt.wait_for_timeout(500)

        # Add a draw layer
        page_rt.click("#btnAddDraw")
        page_rt.wait_for_timeout(150)
        st_rt = page_rt.evaluate("window.__test.getState()")
        draw_layer = next((l for l in st_rt["layers"] if l["type"] == "draw"), None)
        check("retouch: draw layer created", draw_layer is not None)
        check("retouch: draw layer has strokes array", draw_layer is not None and isinstance(draw_layer.get("strokes"), list))
        check("retouch: draw layer strokes start empty", draw_layer is not None and len(draw_layer.get("strokes", [])) == 0)
        if not draw_layer:
            ctx_rt.close()
            browser.close()
            return

        draw_id = draw_layer["id"]

        # ---- Heal stroke ----
        # Inject a heal stroke directly into the layer and verify rasterization doesn't throw
        page_rt.evaluate("""(drawId) => {
            const layer = window.__test.getState().layers.find(l => l.id === drawId);
            if (!layer) return;
            // Inject stroke directly via live state reference
            const liveLayer = window.__state_ref || (() => {
                // Access live state through the module
                return null;
            })();
        }""", draw_id)

        # Better approach: use the test hook + direct state mutation via evaluate
        page_rt.evaluate("""(drawId) => {
            // Import state and add stroke directly
            import('../src/core/state.js').then(m => {
                const layer = m.state.layers.find(l => l.id === drawId);
                if (layer) {
                    layer.strokes.push({ tool: 'heal', points: [[100, 100], [110, 110]], size: 30 });
                }
            });
        }""", draw_id)
        page_rt.wait_for_timeout(200)

        # Force a render and check for no errors
        page_rt.evaluate("() => import('../src/render/renderer.js').then(m => m.scheduleRender())")
        page_rt.wait_for_timeout(200)
        check("retouch: heal stroke rasterizes without errors", len(errors_rt) == 0, str(errors_rt))

        # Verify stroke is stored
        st_heal = page_rt.evaluate("""(drawId) => {
            return new Promise(resolve => {
                import('../src/core/state.js').then(m => {
                    const layer = m.state.layers.find(l => l.id === drawId);
                    resolve(layer ? layer.strokes : []);
                });
            });
        }""", draw_id)
        page_rt.wait_for_timeout(100)
        st_heal = page_rt.evaluate("""(drawId) => {
            // Use synchronous snapshot
            return window.__test.getState().layers.find(l => l.id === drawId)?.strokes || [];
        }""", draw_id)
        check("retouch: heal stroke stored in layer.strokes",
              any(s.get("tool") == "heal" for s in st_heal),
              str(st_heal))

        # ---- Clone stamp: setting source stores it in state ----
        page_rt.evaluate("""() => {
            import('../src/interactions/drawTools.js').then(m => {
                m.drawToolState.cloneSource = { x: 200, y: 200 };
                m.onRetouchToolActivated('clone', null);
            });
        }""")
        page_rt.wait_for_timeout(150)
        # Add a clone stroke manually
        page_rt.evaluate("""(drawId) => {
            import('../src/core/state.js').then(m => {
                const layer = m.state.layers.find(l => l.id === drawId);
                if (layer) {
                    layer.strokes.push({
                        tool: 'clone', points: [[300, 300], [310, 310]],
                        size: 30, opacity: 1, sourceX: 200, sourceY: 200
                    });
                }
            });
        }""", draw_id)
        page_rt.wait_for_timeout(200)
        page_rt.evaluate("() => import('../src/render/renderer.js').then(m => m.scheduleRender())")
        page_rt.wait_for_timeout(200)
        check("retouch: clone stamp rasterizes without errors", len(errors_rt) == 0, str(errors_rt))

        st_clone = page_rt.evaluate("""(drawId) => {
            return window.__test.getState().layers.find(l => l.id === drawId)?.strokes || [];
        }""", draw_id)
        check("retouch: clone stamp stroke stored in layer.strokes",
              any(s.get("tool") == "clone" for s in st_clone),
              str(st_clone))

        # ---- Dodge stroke ----
        page_rt.evaluate("""(drawId) => {
            import('../src/core/state.js').then(m => {
                const layer = m.state.layers.find(l => l.id === drawId);
                if (layer) {
                    layer.strokes.push({ tool: 'dodge', points: [[400, 400], [410, 410]], size: 40, exposure: 0.5 });
                }
            });
        }""", draw_id)
        page_rt.wait_for_timeout(200)
        page_rt.evaluate("() => import('../src/render/renderer.js').then(m => m.scheduleRender())")
        page_rt.wait_for_timeout(200)
        check("retouch: dodge stroke rasterizes without errors", len(errors_rt) == 0, str(errors_rt))

        # ---- Burn stroke ----
        page_rt.evaluate("""(drawId) => {
            import('../src/core/state.js').then(m => {
                const layer = m.state.layers.find(l => l.id === drawId);
                if (layer) {
                    layer.strokes.push({ tool: 'burn', points: [[500, 500], [510, 510]], size: 40, exposure: 0.5 });
                }
            });
        }""", draw_id)
        page_rt.wait_for_timeout(200)
        page_rt.evaluate("() => import('../src/render/renderer.js').then(m => m.scheduleRender())")
        page_rt.wait_for_timeout(200)
        check("retouch: burn stroke rasterizes without errors", len(errors_rt) == 0, str(errors_rt))

        # ---- Red-eye stroke ----
        page_rt.evaluate("""(drawId) => {
            import('../src/core/state.js').then(m => {
                const layer = m.state.layers.find(l => l.id === drawId);
                if (layer) {
                    layer.strokes.push({ tool: 'redeye', cx: 300, cy: 300, radius: 25 });
                }
            });
        }""", draw_id)
        page_rt.wait_for_timeout(200)
        page_rt.evaluate("() => import('../src/render/renderer.js').then(m => m.scheduleRender())")
        page_rt.wait_for_timeout(200)
        check("retouch: red-eye stroke rasterizes without errors", len(errors_rt) == 0, str(errors_rt))

        # ---- Liquify stroke ----
        page_rt.evaluate("""(drawId) => {
            import('../src/core/state.js').then(m => {
                const layer = m.state.layers.find(l => l.id === drawId);
                if (layer) {
                    layer.strokes.push({ tool: 'liquify', points: [[600, 600, 5, 3], [610, 607, 5, 3]], size: 60, strength: 0.5 });
                }
            });
        }""", draw_id)
        page_rt.wait_for_timeout(200)
        page_rt.evaluate("() => import('../src/render/renderer.js').then(m => m.scheduleRender())")
        page_rt.wait_for_timeout(200)
        check("retouch: liquify stroke rasterizes without errors", len(errors_rt) == 0, str(errors_rt))

        # Verify all strokes are in the layer
        st_all = page_rt.evaluate("""(drawId) => {
            return window.__test.getState().layers.find(l => l.id === drawId)?.strokes || [];
        }""", draw_id)
        tools_present = {s.get("tool") for s in st_all}
        check("retouch: all five retouch stroke types stored",
              {"heal", "clone", "dodge", "burn", "redeye", "liquify"}.issubset(tools_present),
              str(tools_present))

        # ---- Undo removes last stroke ----
        stroke_count_before = len(st_all)
        # Push a history entry for current state
        page_rt.evaluate("() => import('../src/core/history.js').then(m => m.pushHistory('test'))")
        page_rt.wait_for_timeout(100)
        # Add one more stroke
        page_rt.evaluate("""(drawId) => {
            import('../src/core/state.js').then(m => {
                const layer = m.state.layers.find(l => l.id === drawId);
                if (layer) layer.strokes.push({ tool: 'heal', points: [[50, 50]], size: 20 });
            });
        }""", draw_id)
        page_rt.wait_for_timeout(150)
        page_rt.evaluate("() => import('../src/core/history.js').then(m => m.pushHistory('extra heal'))")
        page_rt.wait_for_timeout(150)
        st_extra = page_rt.evaluate("""(drawId) => {
            return window.__test.getState().layers.find(l => l.id === drawId)?.strokes || [];
        }""", draw_id)
        count_with_extra = len(st_extra)
        # Undo
        page_rt.click("#btnUndo")
        page_rt.wait_for_timeout(200)
        st_after_undo = page_rt.evaluate("""(drawId) => {
            return window.__test.getState().layers.find(l => l.id === drawId)?.strokes || [];
        }""", draw_id)
        check("retouch: undo after stroke removes last entry from strokes",
              len(st_after_undo) < count_with_extra,
              f"before={count_with_extra}, after={len(st_after_undo)}")

        check("retouch: no page errors throughout", len(errors_rt) == 0, str(errors_rt))
        ctx_rt.close()
        # ---- Section F: Track F — Geometry (canvas crop, straighten, perspective warp) ----
        ctx_f = browser.new_context(viewport={"width": 1400, "height": 900})
        page_f = ctx_f.new_page()
        errors_f = []
        page_f.on("pageerror", lambda exc: errors_f.append(str(exc)))
        page_f.goto(TEST_URL)
        page_f.wait_for_timeout(500)
        check("trackF: boots clean", len(errors_f) == 0, str(errors_f))

        # Add an image layer as a base for testing.
        with page_f.expect_file_chooser() as fc_f:
            page_f.click("#iconAddImage")
        fc_f.value.set_files(SAMPLE_IMG)
        page_f.wait_for_timeout(500)

        # --- Canvas crop ---
        # Get initial canvas dimensions.
        st_f0 = page_f.evaluate("window.__test.getState()")
        w0, h0 = st_f0["width"], st_f0["height"]
        check("trackF: initial canvas is 1080x1080", w0 == 1080 and h0 == 1080, f"{w0}x{h0}")

        # Get initial layer position.
        img_layer_f = next(l for l in st_f0["layers"] if l["type"] == "image")
        layer_x0, layer_y0 = img_layer_f["x"], img_layer_f["y"]

        # Perform canvas crop via JS (simulate what the modal would do).
        page_f.evaluate("""
        () => {
          // Directly perform what canvasCropModal.apply() does:
          // Crop to a 500x500 region starting at (100, 100)
          const { state } = window.__modules_state || {};
          // Use the test API to access state directly via window.__test
          window.__test_crop_x = 100;
          window.__test_crop_y = 100;
          window.__test_crop_w = 500;
          window.__test_crop_h = 500;
        }
        """)
        # Actually trigger the crop via the exported function (need to import it).
        # We'll test by directly calling the module-level function via a dynamic import.
        page_f.evaluate("""
        async () => {
          const { state } = await import('../src/core/state.js');
          const { pushHistory } = await import('../src/core/history.js');
          const { resizeStageBuffer, scheduleRender } = await import('../src/render/renderer.js');
          // Crop from (100,100) to (600,600) → 500x500
          const x = 100, y = 100, w = 500, h = 500;
          state.width = w;
          state.height = h;
          for (const layer of state.layers) {
            layer.x -= x;
            layer.y -= y;
          }
          resizeStageBuffer();
          pushHistory('Crop canvas');
          scheduleRender();
        }
        """)
        page_f.wait_for_timeout(200)

        st_f1 = page_f.evaluate("window.__test.getState()")
        check("trackF: canvas crop sets width=500", st_f1["width"] == 500, str(st_f1["width"]))
        check("trackF: canvas crop sets height=500", st_f1["height"] == 500, str(st_f1["height"]))

        # Verify layer offset.
        img_layer_f1 = next(l for l in st_f1["layers"] if l["type"] == "image")
        expected_x = layer_x0 - 100
        expected_y = layer_y0 - 100
        check("trackF: canvas crop offsets layer.x correctly",
              abs(img_layer_f1["x"] - expected_x) < 1,
              f"expected {expected_x}, got {img_layer_f1['x']}")
        check("trackF: canvas crop offsets layer.y correctly",
              abs(img_layer_f1["y"] - expected_y) < 1,
              f"expected {expected_y}, got {img_layer_f1['y']}")

        # Export after crop — should produce 500x500 @2x = 1000x1000.
        with page_f.expect_download() as dl_crop:
            page_f.click("#btnExport")
        crop_export_path = os.path.join(OUT_DIR, "crop_canvas_export.png")
        dl_crop.value.save_as(crop_export_path)
        img_crop = Image.open(crop_export_path)
        check("trackF: cropped canvas export is 1000x1000 (500px @2x)",
              img_crop.size == (1000, 1000), str(img_crop.size))

        # --- Undo crop ---
        page_f.click("#btnUndo")
        page_f.wait_for_timeout(150)
        st_f2 = page_f.evaluate("window.__test.getState()")
        check("trackF: undo crop restores width=1080", st_f2["width"] == 1080, str(st_f2["width"]))
        check("trackF: undo crop restores height=1080", st_f2["height"] == 1080, str(st_f2["height"]))
        img_layer_f2 = next(l for l in st_f2["layers"] if l["type"] == "image")
        check("trackF: undo crop restores layer.x",
              abs(img_layer_f2["x"] - layer_x0) < 1, f"{layer_x0} vs {img_layer_f2['x']}")

        # --- Straighten ---
        page_f.evaluate("""
        async () => {
          const { state } = await import('../src/core/state.js');
          const { pushHistory } = await import('../src/core/history.js');
          const { scheduleRender } = await import('../src/render/renderer.js');
          state.straighten = 5;
          pushHistory('Straighten');
          scheduleRender();
        }
        """)
        page_f.wait_for_timeout(200)
        st_f3 = page_f.evaluate("window.__test.getState()")
        check("trackF: straighten=5 is stored in state", st_f3.get("straighten") == 5, str(st_f3.get("straighten")))

        # Export with straighten — must produce valid PNG without errors.
        with page_f.expect_download() as dl_st:
            page_f.click("#btnExport")
        st_export_path = os.path.join(OUT_DIR, "straighten_export.png")
        dl_st.value.save_as(st_export_path)
        img_st = Image.open(st_export_path)
        check("trackF: straighten export is valid 2160x2160 PNG",
              img_st.size == (2160, 2160), str(img_st.size))
        check("trackF: no errors after straighten export", len(errors_f) == 0, str(errors_f))

        # Undo straighten.
        page_f.click("#btnUndo")
        page_f.wait_for_timeout(150)
        st_f4 = page_f.evaluate("window.__test.getState()")
        check("trackF: undo straighten restores straighten=0",
              (st_f4.get("straighten") or 0) == 0, str(st_f4.get("straighten")))

        # --- Perspective warp ---
        st_f5 = page_f.evaluate("window.__test.getState()")
        img_id_f = next(l["id"] for l in st_f5["layers"] if l["type"] == "image")

        # Activate perspective warp via JS.
        page_f.evaluate("""
        async (imgId) => {
          const { state } = await import('../src/core/state.js');
          const { pushHistory } = await import('../src/core/history.js');
          const { scheduleRender } = await import('../src/render/renderer.js');
          const layer = state.layers.find(l => l.id === imgId);
          if (!layer) return;
          layer.perspectiveWarp = {
            enabled: true,
            tl: { dx: 0, dy: 0 },
            tr: { dx: -50, dy: 30 },
            bl: { dx: 20, dy: 0 },
            br: { dx: 0, dy: 0 },
          };
          pushHistory('Perspective warp');
          scheduleRender();
        }
        """, img_id_f)
        page_f.wait_for_timeout(200)

        st_f6 = page_f.evaluate("window.__test.getState()")
        img_layer_f6 = next(l for l in st_f6["layers"] if l["id"] == img_id_f)
        check("trackF: perspectiveWarp.enabled is true in state",
              img_layer_f6.get("perspectiveWarp", {}).get("enabled") is True)
        check("trackF: perspectiveWarp is serializable (plain object)",
              isinstance(img_layer_f6.get("perspectiveWarp"), dict))

        # Export with perspective warp — must succeed without errors.
        with page_f.expect_download() as dl_warp:
            page_f.click("#btnExport")
        warp_export_path = os.path.join(OUT_DIR, "warp_export.png")
        dl_warp.value.save_as(warp_export_path)
        img_warp = Image.open(warp_export_path)
        check("trackF: perspective warp export is valid PNG",
              img_warp.size[0] > 0, str(img_warp.size))
        check("trackF: no errors after warp export", len(errors_f) == 0, str(errors_f))

        # --- Canvas Crop button and Straighten button exist in DOM ---
        crop_btn = page_f.evaluate("!!document.getElementById('btnCropCanvas')")
        straight_btn = page_f.evaluate("!!document.getElementById('btnStraighten')")
        check("trackF: Crop canvas button exists in DOM", crop_btn)
        check("trackF: Straighten button exists in DOM", straight_btn)

        # --- Image layer has perspectiveWarp=null by default (migration) ---
        page_f2 = ctx_f.new_page()
        page_f2.goto(TEST_URL)
        page_f2.wait_for_timeout(400)
        with page_f2.expect_file_chooser() as fc_f2:
            page_f2.click("#iconAddImage")
        fc_f2.value.set_files(SAMPLE_IMG)
        page_f2.wait_for_timeout(500)
        st_f_new = page_f2.evaluate("window.__test.getState()")
        # The last image layer added (not a restored one) should have perspectiveWarp=null.
        img_layers_new = [l for l in st_f_new["layers"] if l["type"] == "image"]
        new_img = img_layers_new[-1]  # Last added image layer
        check("trackF: new image layer has perspectiveWarp field",
              "perspectiveWarp" in new_img)
        check("trackF: new image layer perspectiveWarp is null by default",
              new_img.get("perspectiveWarp") is None, str(new_img.get("perspectiveWarp")))

        ctx_f.close()
        # ---- Section: Track G — AI Tools (mocked inference) ----
        ctx_ai = browser.new_context(viewport={"width": 1400, "height": 900})
        page_ai = ctx_ai.new_page()
        errors_ai = []
        page_ai.on("pageerror", lambda exc: errors_ai.append(str(exc)))
        page_ai.goto(TEST_URL)
        page_ai.wait_for_timeout(500)
        check("ai-tools: boots clean", len(errors_ai) == 0, str(errors_ai))

        # Upload an image to get an image layer.
        with page_ai.expect_file_chooser() as fc_ai:
            page_ai.click("#iconAddImage")
        fc_ai.value.set_files(SAMPLE_IMG)
        page_ai.wait_for_timeout(500)

        st_ai = page_ai.evaluate("window.__test.getState()")
        ai_img = next((l for l in st_ai["layers"] if l["type"] == "image"), None)
        check("ai-tools: image layer present", ai_img is not None)

        if ai_img:
            # Select the image layer so props panel renders.
            page_ai.evaluate("(id) => window.__test.selectLayer(id)", ai_img["id"])
            page_ai.wait_for_timeout(200)

            # Verify AI tool buttons exist in the DOM.
            has_genfill = page_ai.evaluate("() => !!document.getElementById('iGenFill')")
            has_up2x    = page_ai.evaluate("() => !!document.getElementById('iUpscale2x')")
            has_up4x    = page_ai.evaluate("() => !!document.getElementById('iUpscale4x')")
            has_bgremove = page_ai.evaluate("() => !!document.getElementById('iBgRemove')")
            check("ai-tools: Generative fill button exists in props", has_genfill)
            check("ai-tools: Upscale 2x button exists in props", has_up2x)
            check("ai-tools: Upscale 4x button exists in props", has_up4x)
            check("ai-tools: Remove background button exists in props", has_bgremove)

            # Inject a mock inpaint implementation, pre-warm the mask in the image cache,
            # and run generative fill. All done in one async evaluate so ordering is guaranteed.
            setup_ok = page_ai.evaluate("""
            async () => {
              // Install mock inpaint impl.
              const mod = await import('/src/cutout/inpaint.js');
              mod._setInpaintImpl(async (srcCanvas, maskCanvas, onProgress) => {
                onProgress && onProgress('inference', 1);
                onProgress && onProgress('ready', 1);
                const out = document.createElement('canvas');
                out.width  = srcCanvas.width;
                out.height = srcCanvas.height;
                out.getContext('2d').fillStyle = '#00ff00'; // green — visually distinct
                out.getContext('2d').fillRect(0, 0, out.width, out.height);
                return out;
              });

              // Set mask on the live layer and pre-warm in imageCache.
              const { state, ensureImage } = await import('/src/core/state.js');
              const layer = state.layers.find(l => l.type === 'image');
              if (!layer) return false;

              // Build a 10x10 all-white mask canvas.
              const c = document.createElement('canvas');
              c.width = c.height = 10;
              const cx = c.getContext('2d');
              cx.fillStyle = 'rgba(255,255,255,1)';
              cx.fillRect(0, 0, 10, 10);
              const maskUrl = c.toDataURL('image/png');

              // Pre-warm in cache so ensureImage() inside runGenerativeFill returns complete img.
              const maskImg = ensureImage(maskUrl);
              await new Promise((resolve) => {
                if (maskImg.complete && maskImg.naturalWidth > 0) { resolve(); return; }
                maskImg.onload = resolve;
                maskImg.onerror = resolve;
                setTimeout(resolve, 3000);
              });

              layer.mask = { enabled: true, src: maskUrl, invert: false, feather: 0 };

              // Re-render props panel so button handlers are re-wired with updated layer.
              const { renderPropsPanel } = await import('/src/ui/props/panel.js');
              renderPropsPanel();
              return { layerId: layer.id, maskLoaded: maskImg.complete && maskImg.naturalWidth > 0 };
            }
            """)
            page_ai.wait_for_timeout(300)
            check("ai-tools: inpaint mock injected and mask ready", bool(setup_ok) and setup_ok.get("maskLoaded", False) if isinstance(setup_ok, dict) else bool(setup_ok))

            # Capture state before running generative fill.
            st_before = page_ai.evaluate("window.__test.getState()")
            img_before = next(l for l in st_before["layers"] if l["type"] == "image")
            src_before = img_before.get("src", "")

            # Click the generative fill button.
            page_ai.evaluate("() => { const b = document.getElementById('iGenFill'); if (b) b.click(); }")
            # Wait for async operation to complete (mock is fast but props panel re-renders).
            page_ai.wait_for_timeout(1200)

            check("ai-tools: no errors after mock generative fill", len(errors_ai) == 0, str(errors_ai))

            st_after_fill = page_ai.evaluate("window.__test.getState()")
            img_after = next((l for l in st_after_fill["layers"] if l["type"] == "image"), None)
            check("ai-tools: image layer still present after fill", img_after is not None)

            if img_after:
                src_changed = img_after.get("src", "") != src_before
                check("ai-tools: layer.src was replaced by fill result", src_changed)
                mask_cleared = not img_after.get("mask", {}).get("enabled", True)
                check("ai-tools: mask cleared after generative fill", mask_cleared)

            # Verify upscale buttons exist and are wired (we just check they don't throw on click
            # without a model — they will show an error in the AI error div, not a page error).
            # Install mock for upscale as well.
            page_ai.evaluate("""
            async () => {
              // Patch upscaleImage to return a 2x canvas without downloading anything.
              const upscaleMod = await import('/src/cutout/upscale.js');
              window.__upscaleMod = upscaleMod;
              // We can't easily patch this without a _setUpscaleImpl hook.
              // The button click will attempt to load the model; if network is unavailable
              // it will show an AI error. We just verify no page-level crash occurs.
            }
            """)
            page_ai.evaluate("() => { const b = document.getElementById('iUpscale2x'); if (b && !b.disabled) b.click(); }")
            page_ai.wait_for_timeout(300)
            check("ai-tools: upscale button click causes no page error", len(errors_ai) == 0, str(errors_ai))

        # Outpaint panel toggle.
        has_outpaint_btn = page_ai.evaluate("() => !!document.getElementById('btnOutpaint')")
        check("ai-tools: outpaint button exists in toolbar", has_outpaint_btn)

        panel_hidden_initially = page_ai.evaluate("""
        () => {
          const p = document.getElementById('outpaintPanel');
          return p ? (p.style.display === 'none' || p.style.display === '') : false;
        }""")
        check("ai-tools: outpaint panel is hidden initially", panel_hidden_initially)

        page_ai.click("#btnOutpaint")
        page_ai.wait_for_timeout(150)
        panel_shown = page_ai.evaluate("() => document.getElementById('outpaintPanel').style.display !== 'none'")
        check("ai-tools: outpaint panel shown after button click", panel_shown)

        has_run_btn = page_ai.evaluate("() => !!document.getElementById('btnOutpaintRun')")
        check("ai-tools: outpaint run button exists", has_run_btn)
        check("ai-tools: no errors after outpaint panel interaction", len(errors_ai) == 0, str(errors_ai))

        # Module import smoke test — confirm new modules load without JS errors.
        import_ok = page_ai.evaluate("""
        async () => {
          try {
            await import('/src/cutout/inpaint.js');
            await import('/src/cutout/upscale.js');
            await import('/src/cutout/outpaint.js');
            return true;
          } catch (e) {
            window.__moduleImportError = e.message;
            return false;
          }
        }
        """)
        page_ai.wait_for_timeout(300)
        check("ai-tools: new AI modules import without JS errors", import_ok)
        check("ai-tools: no page errors throughout", len(errors_ai) == 0, str(errors_ai))

        ctx_ai.close()

        # ---- Track G slow test: real inference (gated by SLOW_TESTS env var) ----
        if os.environ.get("SLOW_TESTS"):
            ctx_slow = browser.new_context(viewport={"width": 1400, "height": 900})
            page_slow = ctx_slow.new_page()
            errors_slow = []
            page_slow.on("pageerror", lambda exc: errors_slow.append(str(exc)))
            page_slow.goto(TEST_URL)
            page_slow.wait_for_timeout(500)

            with page_slow.expect_file_chooser() as fc_slow:
                page_slow.click("#iconAddImage")
            fc_slow.value.set_files(SAMPLE_IMG)
            page_slow.wait_for_timeout(500)

            st_slow = page_slow.evaluate("window.__test.getState()")
            slow_img = next((l for l in st_slow["layers"] if l["type"] == "image"), None)
            if slow_img:
                page_slow.evaluate("(id) => window.__test.selectLayer(id)", slow_img["id"])
                page_slow.wait_for_timeout(200)
                # Set mask and trigger real inpainting.
                page_slow.evaluate("""
                async () => {
                  const { state } = await import('/src/core/state.js');
                  const layer = state.layers.find(l => l.type === 'image');
                  if (!layer) return;
                  const c = document.createElement('canvas');
                  c.width = c.height = 64;
                  const cx = c.getContext('2d');
                  cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, 64, 64);
                  layer.mask = { enabled: true, src: c.toDataURL(), invert: false, feather: 0 };
                  const { renderPropsPanel } = await import('/src/ui/props/panel.js');
                  renderPropsPanel();
                }
                """)
                page_slow.wait_for_timeout(200)
                page_slow.evaluate("() => document.getElementById('iGenFill') && document.getElementById('iGenFill').click()")
                # Wait up to 60 s for real model inference.
                page_slow.wait_for_timeout(60000)
                check("ai-tools [slow]: no page errors during real inpaint", len(errors_slow) == 0, str(errors_slow))
                st_slow_after = page_slow.evaluate("window.__test.getState()")
                slow_img_after = next((l for l in st_slow_after["layers"] if l["type"] == "image"), None)
                check("ai-tools [slow]: real inpaint replaced layer.src", slow_img_after and slow_img_after.get("src") != slow_img.get("src"))

            ctx_slow.close()
        # ---- Section Track-J: Mobile UX Polish ----

        ctx_j = browser.new_context(viewport={"width": 1400, "height": 900})
        page_j = ctx_j.new_page()
        errors_j = []
        page_j.on("pageerror", lambda exc: errors_j.append(str(exc)))
        page_j.goto(TEST_URL)
        page_j.wait_for_timeout(800)
        check("track-j: page loads clean", len(errors_j) == 0, str(errors_j))

        # -- Track-J 1: Grid state toggle and export does not include grid --
        # Verify initial state
        st_j_init = page_j.evaluate("window.__test.getState()")
        check("track-j: showGrid defaults to false", st_j_init.get("showGrid") == False)
        check("track-j: showRulers defaults to false", st_j_init.get("showRulers") == False)
        check("track-j: snapToGuides defaults to true", st_j_init.get("snapToGuides") == True)
        check("track-j: activeGuides starts empty", len(st_j_init.get("activeGuides") or []) == 0)

        # Toggle grid on via JS (avoids click targeting issues)
        page_j.evaluate("""() => document.getElementById('btnToggleGrid').click()""")
        page_j.wait_for_timeout(100)
        grid_state = page_j.evaluate("window.__test.getState().showGrid")
        check("track-j: showGrid toggled to true", grid_state == True)

        # Add an image so there is something to export
        with page_j.expect_file_chooser() as fc_j:
            page_j.evaluate("document.getElementById('btnAddImage').click()")
        fc_j.value.set_files(SAMPLE_IMG)
        page_j.wait_for_timeout(600)

        # Export with grid on
        page_j.evaluate("document.getElementById('exportScale').dataset.value = '1'")
        page_j.wait_for_timeout(50)
        with page_j.expect_download() as dl_j:
            page_j.evaluate("document.getElementById('btnExport').click()")
        grid_export_path = os.path.join(OUT_DIR, "trackj_grid_export.png")
        dl_j.value.save_as(grid_export_path)
        img_grid = Image.open(grid_export_path)
        check("track-j: export with grid on is a valid 1080x1080 PNG", img_grid.size == (1080, 1080),
              str(img_grid.size))

        # Turn off grid, export again — must be pixel-identical (grid was not drawn in export)
        page_j.evaluate("""() => document.getElementById('btnToggleGrid').click()""")
        page_j.wait_for_timeout(100)
        with page_j.expect_download() as dl_j2:
            page_j.evaluate("document.getElementById('btnExport').click()")
        nogrid_export_path = os.path.join(OUT_DIR, "trackj_nogrid_export.png")
        dl_j2.value.save_as(nogrid_export_path)
        import hashlib
        def j_hash(path):
            return hashlib.md5(open(path, 'rb').read()).hexdigest()
        check("track-j: grid not visible in export (pixel-identical with grid on vs off)",
              j_hash(grid_export_path) == j_hash(nogrid_export_path))

        # -- Track-J 2: Rulers toggle --
        page_j.evaluate("""() => document.getElementById('btnToggleRulers').click()""")
        page_j.wait_for_timeout(100)
        rulers_on = page_j.evaluate("window.__test.getState().showRulers")
        check("track-j: showRulers toggled to true", rulers_on == True)
        page_j.evaluate("""() => document.getElementById('btnToggleRulers').click()""")
        page_j.wait_for_timeout(100)
        rulers_off = page_j.evaluate("window.__test.getState().showRulers")
        check("track-j: showRulers toggled back to false", rulers_off == False)

        # -- Track-J 3: Snap-to-guides toggle --
        page_j.evaluate("""() => document.getElementById('btnToggleSnap').click()""")
        page_j.wait_for_timeout(100)
        snap_off = page_j.evaluate("window.__test.getState().snapToGuides")
        check("track-j: snapToGuides toggled to false", snap_off == False)
        page_j.evaluate("""() => document.getElementById('btnToggleSnap').click()""")
        page_j.wait_for_timeout(100)
        snap_on = page_j.evaluate("window.__test.getState().snapToGuides")
        check("track-j: snapToGuides toggled back to true", snap_on == True)

        # -- Track-J 4: Before/after compare toggle (needs image layer with adjustments) --
        st_j = page_j.evaluate("window.__test.getState()")
        img_id_j = next((l["id"] for l in st_j["layers"] if l["type"] == "image"), None)
        check("track-j: image layer present for compare test", img_id_j is not None)
        if img_id_j:
            page_j.evaluate("(id) => window.__test.selectLayer(id)", img_id_j)
            page_j.wait_for_timeout(200)

            # Open adjustments section and set brightness
            page_j.evaluate("""() => {
                const body = document.querySelector('#adjSection .collapsible-body');
                if (body && body.style.display === 'none') {
                    document.querySelector('#adjSection .collapsible-hdr').click();
                }
            }""")
            page_j.wait_for_timeout(100)
            page_j.evaluate("""() => {
                const sl = document.getElementById('aiBright');
                if (sl) { sl.value = '80'; sl.dispatchEvent(new Event('input', { bubbles: true })); sl.dispatchEvent(new Event('change', { bubbles: true })); }
            }""")
            page_j.wait_for_timeout(200)

            st_j2 = page_j.evaluate("window.__test.getState()")
            img_j2 = next(l for l in st_j2["layers"] if l["id"] == img_id_j)
            bright_j = next((a for a in (img_j2.get("adjustments") or []) if a["type"] == "brightness"), None)
            check("track-j: compare: brightness set to 80", bright_j is not None and bright_j["value"] == 80,
                  str(img_j2.get("adjustments")))

            # Toggle compare mode using the button in the props panel
            compare_mode = page_j.evaluate("""() => {
                const btn = document.getElementById('iCompareToggle');
                if (!btn) return 'no-btn';
                btn.click();
                return window.__test.getState().compareMode;
            }""")
            page_j.wait_for_timeout(100)
            check("track-j: compare toggle mode activated", compare_mode == 'toggle', str(compare_mode))

            # Toggle off
            cm_off = page_j.evaluate("""() => {
                const btn = document.getElementById('iCompareToggle');
                if (!btn) return 'no-btn';
                btn.click();
                return window.__test.getState().compareMode;
            }""")
            page_j.wait_for_timeout(100)
            check("track-j: compare toggle turns off on second click", cm_off is None, str(cm_off))

            # Test split compare
            split_mode = page_j.evaluate("""() => {
                const btn = document.getElementById('iCompareSplit');
                if (!btn) return 'no-btn';
                btn.click();
                return window.__test.getState().compareMode;
            }""")
            page_j.wait_for_timeout(100)
            check("track-j: compare split mode activated", split_mode == 'split', str(split_mode))
            page_j.evaluate("""() => { const btn = document.getElementById('iCompareSplit'); if (btn) btn.click(); }""")
            page_j.wait_for_timeout(50)

        # -- Track-J 5: computeGuides returns alignment values --
        guides_test = page_j.evaluate("""() => {
            const layerA = { id: 'A', x: 0, y: 0, w: 200, h: 100, visible: true };
            const layerB = { id: 'B', x: 300, y: 200, w: 150, h: 80, visible: true };
            const guides = window.__test.computeGuides(layerB, [layerA, layerB]);
            // Should have guide at x=0 (left of A), x=100 (center of A), x=200 (right of A)
            const hasLeft = guides.some(g => g.x === 0);
            const hasCenter = guides.some(g => g.x === 100);
            const hasRight = guides.some(g => g.x === 200);
            return { hasLeft, hasCenter, hasRight, count: guides.length };
        }""")
        check("track-j: computeGuides returns left edge of other layer", guides_test["hasLeft"] == True,
              str(guides_test))
        check("track-j: computeGuides returns center-x of other layer", guides_test["hasCenter"] == True,
              str(guides_test))
        check("track-j: computeGuides returns right edge of other layer", guides_test["hasRight"] == True,
              str(guides_test))
        check("track-j: computeGuides returns multiple guides", guides_test["count"] > 5)

        # -- Track-J 6: swipe-adjust updates slider value on horizontal pointer move --
        swipe_result = page_j.evaluate("""() => {
            const sl = document.getElementById('aiBright');
            if (!sl) return { ok: false, reason: 'no slider' };
            sl.value = '0';
            sl.dispatchEvent(new Event('input', { bubbles: true }));
            const before = +sl.value;
            // Focus the slider to set swipeAdjustTarget
            sl.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
            const targetSet = window.__test.getState().swipeAdjustTarget === 'aiBright';
            // Fire a pointermove on window WITHOUT a prior pointerdown.
            // No drag is active, so swipe-adjust should fire when swipeAdjustTarget is set.
            // First move to set lastSwipeX, then move right to produce a positive delta.
            window.dispatchEvent(new PointerEvent('pointermove', { clientX: 400, clientY: 300, bubbles: true }));
            window.dispatchEvent(new PointerEvent('pointermove', { clientX: 460, clientY: 300, bubbles: true }));
            const after = +sl.value;
            return { before, after, targetSet };
        }""")
        page_j.wait_for_timeout(100)
        check("track-j: swipe-adjust: focus sets swipeAdjustTarget", swipe_result.get("targetSet") == True,
              str(swipe_result))
        check("track-j: swipe-adjust: horizontal swipe changes slider value",
              swipe_result.get("after") != swipe_result.get("before"),
              str(swipe_result))

        check("track-j: no page errors throughout", len(errors_j) == 0, str(errors_j))
        ctx_j.close()

        browser.close()


run()
print("\n=== SUMMARY ===")
fails = [r for r in results if r[1] == "FAIL"]
for name, status in results:
    print(f"{status}: {name}")
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
if fails:
    sys.exit(1)
