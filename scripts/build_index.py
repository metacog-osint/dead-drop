"""Builds site/index.html from the tool pages: each page's title, description and category line (.crumb)."""
import glob, html, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORDER = ["Orbits and space", "Launch", "RF and comms", "Geography and maps", "Images and files", "Time", "Reference"]
# Category lines on the pages, folded into the index headings.
ALIAS = {"Launch and trajectory": "Launch", "Geography and mapping": "Geography and maps", "Geospatial": "Geography and maps",
         "Imagery and files": "Images and files", "Maps": "Geography and maps", "Imagery": "Images and files"}

def read(path):
    s = open(path, encoding="utf-8").read()
    t = re.search(r"<title>(.*?) · Dead Drop Toolbox</title>", s)
    d = re.search(r'<meta name="description" content="([^"]*)"', s)
    c = re.search(r'<p class="crumb[^"]*">(.*?)</p>', s, re.S)
    if not (t and d and c):
        sys.exit("missing title, description or crumb: " + path)
    cat = html.unescape(re.sub(r"<[^>]+>", "", c.group(1))).split("·")[0].strip()
    cat = ALIAS.get(cat, cat)
    return {"file": os.path.basename(path), "title": html.unescape(t.group(1)), "desc": html.unescape(d.group(1)), "cat": cat}

tools = [read(p) for p in sorted(glob.glob(os.path.join(ROOT, "site", "tools", "*.html")))]
cats = sorted({t["cat"] for t in tools}, key=lambda c: (ORDER.index(c) if c in ORDER else len(ORDER), c))
parts = []
for c in cats:
    parts.append(f'  <h2 class="cat">{html.escape(c)}</h2>\n  <div class="cards">')
    for t in sorted((t for t in tools if t["cat"] == c), key=lambda t: t["title"]):
        parts.append(f'    <a class="card" href="tools/{t["file"]}"><strong>{html.escape(t["title"])}</strong>'
                     f'<span>{html.escape(t["desc"])}</span></a>')
    parts.append("  </div>")
page = open(os.path.join(ROOT, "scripts", "index.template.html"), encoding="utf-8").read()
page = page.replace("<!--COUNT-->", str(len(tools))).replace("<!--TOOLS-->", "\n".join(parts))
open(os.path.join(ROOT, "site", "index.html"), "w", encoding="utf-8", newline="\n").write(page)
print(len(tools), "tools in", len(cats), "categories:", ", ".join(cats))
