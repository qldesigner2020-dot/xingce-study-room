"""Build a tiny, outline-free Unicode map for searchable system-font PDFs.

This contains no visible typeface: the browser draws the visible text using its
installed serif font. Empty glyphs keep a Unicode text layer for copy/search/AI.
Requires fonttools; the generated map is shipped with the exporter, not fetched
as a font download. Noto Serif SC metrics preserve the existing pagination.
"""
import base64
import io
import json
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parents[1]
source = (root / "client/assets/vendor/pdf-fonts.js").read_text(encoding="utf-8")
fonts = json.loads(source[source.index("{"):source.rindex("};") + 1])
original = TTFont(io.BytesIO(base64.b64decode(fonts["Exam-Regular.woff"])))
cmap = original.getBestCmap()
points = set(range(32, 0xE000)) | set(range(0xF900, 0xFFFE)) | set(range(0x1F000,0x1FB00)) | set(range(0x1D400,0x1D800)) | set(cmap)
points.discard(0)
assert len(points) < 65534
order = [".notdef"] + ["u" + str(cp) for cp in sorted(points)]
fb = FontBuilder(1000, isTTF=True)
fb.setupGlyphOrder(order)
fb.setupCharacterMap({cp: "u" + str(cp) for cp in points})
empty = TTGlyphPen(None).glyph()
fb.setupGlyf({name: empty for name in order})
metrics = {".notdef": (1000, 0)}
metrics.update({"u" + str(cp): (original["hmtx"][cmap[cp]][0] if cp in cmap else 1000, 0) for cp in points})
fb.setupHorizontalMetrics(metrics)
fb.setupHorizontalHeader(ascent=1151, descent=-286)
fb.setupNameTable({"familyName": "PDFTextMap", "styleName": "Regular", "uniqueFontIdentifier": "PDFTextMap1",
                   "fullName": "PDFTextMap", "psName": "PDFTextMap", "version": "Version 1.0"})
fb.setupOS2(sTypoAscender=880, sTypoDescender=-120, usWinAscent=1151, usWinDescent=286)
fb.setupPost(keepGlyphNames=False)
fb.setupMaxp()
fb.font.recalcBBoxes = False
fb.font['head'].xMin, fb.font['head'].yMin = 0, -120
fb.font['head'].xMax, fb.font['head'].yMax = 1000, 880
fb.font.flavor = "woff"
output = io.BytesIO(); fb.save(output)
encoded = {"regular": base64.b64encode(output.getvalue()).decode("ascii")}
for name in fb.font['name'].names:
    if name.nameID in [1,4,6]: name.string = 'PDFTextMapBold'.encode(name.getEncoding())
    elif name.nameID == 2: name.string = 'Bold'.encode(name.getEncoding())
fb.font['OS/2'].usWeightClass = 700
bold = io.BytesIO(); fb.save(bold)
encoded['bold'] = base64.b64encode(bold.getvalue()).decode('ascii')
target = root / "client/assets/pdf-text-layer.js"
target.write_text("/* Outline-free Unicode text map; no visible font. Metrics: Noto Serif SC, SIL OFL 1.1. */\nwindow.QB_PDF_TEXT_LAYER="
                  + json.dumps(encoded) + ";\n", encoding="utf-8")
print("Unicode characters", len(points), "map bytes", len(output.getvalue())+len(bold.getvalue()), "script bytes", target.stat().st_size)
