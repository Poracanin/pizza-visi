from pathlib import Path
import re, base64
here = Path(__file__).resolve().parent
root = here.parents[1]
fonts = (root / 'public/fonts.css').read_text()
fonts = re.sub(r'url\(\./assets/fonts/([^\)]+)\)', lambda m: 'url(data:font/woff2;base64,' + base64.b64encode((root/'public/assets/fonts'/m[1]).read_bytes()).decode() + ')', fonts)
model = (here / 'model.mjs').read_text().replace('export const ', 'const ').replace('export function ', 'function ')
html = (here / 'template.html').read_text().replace('/* EMBED_FONTS */', fonts).replace('/* EMBED_MODEL */', model)
(root/'public/naklady-systemu.html').write_text(html)
print('Vytvořeno public/naklady-systemu.html — samostatné HTML')
