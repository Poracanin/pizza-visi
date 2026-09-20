# Podklady Pizza Visi pro redesign

Zdroj: https://pizzavisi.cz/ · Staženo 20. 9. 2026.

## Kde začít

- **`obsah.json`** — hlavní podklad pro nový web: organizace, kontakty, tři pobočky, navigace, kompletní texty a sekce tří hlavních stránek, aktuální jídelní lístek, rozvoz, dokumenty a fotografie.
- **`fotky/`** — 139 obrazových souborů: 47 fotografií/obrázků včetně jejich dostupných rozměrových variant. Z toho 46 obrazových podkladů je odkazováno z hlavních stránek nebo jejich stylů; jeden patří do staršího katalogu.
- **`fotky.json`** — fotografie seskupené podle motivu; `recommended` vždy odkazuje na největší skutečně staženou variantu. Pro redesign vybírejte primárně z těchto souborů.
- **`menu.json`** — 69 aktuálních položek: 24 pizz, 12 vín/prosecc, 17 přísad, 1 druh plněných okrajů, 3 omáčky, 11 nápojů a krabice. Obsahuje původní názvy, složení, ceny a odkazy na lokální fotografie.
- **`organizace.json`** — provozovatel, IČO/DIČ, sociální sítě, pobočky Rudná/Hostivice/Beroun, telefony, otevírací doba a lokality rozvozu.

## Úplný archiv

| Cesta | Obsah |
| --- | --- |
| `stranky.json` | Texty, nadpisy, obsahové bloky, sekce, odkazy, metadata a JSON-LD z 91 veřejných stránek. |
| `media.json` | Všechny nalezené URL obrázků a dokumentů, jejich zdroje, místní cesty, rozměry, velikosti, SHA-256 a stav stažení. |
| `grafika/` | 33 souborů: loga, ikony, SVG, technické obrázky a prvky šablony. |
| `dokumenty/` | Původní PDF s alergeny. |
| `dokumenty.json` | Text PDF a 21 strukturovaných záznamů z dokumentu. |
| `zdroje/html/` | 91 původních HTML souborů. |
| `zdroje/css/` | Stažené styly, ze kterých byly dohledány i fotografie na pozadí. |
| `zdroje/sitemaps/` | Původní mapy webu. |
| `audit-stazeni.json` | Rozsah sběru, zdroje, ověření v prohlížeči a nedostupné soubory. |
| `kontrola.json` | Výsledky kontroly JSON, lokálních souborů, cen a vazeb. |

Všechny `local_path` a `source_html` v JSON jsou relativní k této složce. Názvy souborů mají krátký hash zdrojové URL, aby se nepřepisovaly stejně pojmenované soubory. Obsahově identické soubory jsou sdílené; původní URL zůstávají v manifestu.

`pages` v `obsah.json` obsahuje tři hlavní stránky. Celý archiv `stranky.json` rozlišuje `primary`, `menu_detail` a `supporting_or_legacy`. Poslední kategorie zahrnuje také veřejné šablony, stránkované kategorie a starší WooCommerce obsah; nepředstavuje automaticky aktuální nabídku. Aktuální nabídka v `menu.json` vychází výhradně ze stránky `/menu/`.

## Poznámky ze zdroje k ověření s klientem

1. **Alergeny:** odkazované PDF uvádí pouze 21 pizz. Obsahuje starší názvy Hawai, Fantazie a Krkovička místo současných Ananasová, Symfonie a Z komína; položky 22–24 chybějí. Dokument je zachován samostatně a jeho údaje nejsou automaticky přiřazeny aktuálním jídlům. Pole `allergens` proto zůstává `null`.
2. **Adresa:** kontakty uvádějí „Riegerova 527/50“, právní patička „Riegrova 527/50“. Obě původní podoby jsou zachovány.
3. **Neděle:** web uvádí Po–So 11–21; nedělní otevírací doba není uvedena a nebyla doplněna odhadem.
4. **Původní texty:** typografické a pravopisné zvláštnosti, SEO popisy a rok copyrightu jsou převzaty ze zdroje. Whitespace je při převodu do JSON sjednocen; přesný HTML originál je v archivu.

## Rozsah a dostupnost

Staženy byly všechny stránky z veřejných sitemap a navazující interní odkazy včetně stránkování kategorií. Byly zpracovány obrázky z HTML, `srcset`, metadat a stylů, PDF přílohy i dostupné původní rozměry obrázků. Na třech hlavních stránkách byly navíc porovnány skutečné obrázky a pozadí vykreslené v prohlížeči. Všechny jejich obrazové podklady jsou uložené.

Zdrojový server vrací 404 pro tři technické ikony šablony (`owl.video.play.png`, `sound_off.png`, `sound_on.png`) a 403 pro `templates/custom-css.php`. Jsou zaznamenány v auditu. Fotografie jídel, jejich originály, loga a obsahové fotografie byly staženy úspěšně.

Externí weby, sociální profily a mapové dlaždice se nearchivují. Mapy jsou zachovány původními adresami vložení. Archiv HTML slouží jako důkaz zdrojového obsahu, nikoli jako kompletní offline kopie fungujícího objednávkového systému. Soukromý obsah administrace a neodkazovaná knihovna médií nejsou součástí exportu.

## Skripty

- `../scripts/export_web.py` — sběr veřejného webu pomocí čtecích GET požadavků; vyžaduje Python, `lxml` a `Pillow`.
- `../scripts/organize_content.py` — sestavení hlavních JSON z místního archivu, vytěžení PDF a validace; navíc vyžaduje `pypdf`.

První skript využívá existující stažené soubory jako cache pro dokončení přerušeného běhu. Pro nový časový snímek použijte jinou výstupní složku. Druhý skript pracuje bez sítě.
