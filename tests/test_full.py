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


def run():
    make_sample_image()
    with sync_playwright() as p:
        browser = p.chromium.launch()

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

        browser.close()


run()
print("\n=== SUMMARY ===")
fails = [r for r in results if r[1] == "FAIL"]
for name, status in results:
    print(f"{status}: {name}")
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
if fails:
    sys.exit(1)
