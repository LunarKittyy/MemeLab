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

BASE_URL = "http://localhost:8731"
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

        browser.close()


run()
print("\n=== SUMMARY ===")
fails = [r for r in results if r[1] == "FAIL"]
for name, status in results:
    print(f"{status}: {name}")
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
if fails:
    sys.exit(1)
