# Pizza Visi

Responzivní web podle fotografií značky. Tmavá textura, červená a světlá typografie a fotografie pizz. Pobočka se určí podle doručovací adresy při dokončení objednávky; úvodní modal se nezobrazuje.

## Spuštění

Vyžaduje Node.js 20 nebo novější. Nemá žádné npm závislosti.

```sh
npm run dev
```

Náhled: http://localhost:4188. Jiný port: `npm run dev -- --port 4190`.

```sh
npm test
npm run build
npm run preview
```

`dist/` je samostatný statický web vhodný k nasazení na statický hosting. Server poskytuje pouze webové soubory z `public/`, případně `dist/`; archiv podkladů nezveřejňuje. Náhled a dev server nelze provozovat současně na stejném portu.

## GitHub Pages

Veřejný demo web: https://poracanin.github.io/pizza-visi/.

Přímé odkazy na vytvořené části projektu:

- [Web Pizza Visi](https://poracanin.github.io/pizza-visi/)
- [Administrace / POS — demo](https://poracanin.github.io/pizza-visi/admin/)
- [Mobilní rozvoz pro kurýry — demo](https://poracanin.github.io/pizza-visi/rozvoz.html)
- [Cenová nabídka](https://poracanin.github.io/pizza-visi/cenova-nabidka.html), včetně [cen po pobočkách a platebních podmínek](https://poracanin.github.io/pizza-visi/cenova-nabidka.html#branches)
- [Mapa rozvozu](https://poracanin.github.io/pizza-visi/mapa-rozvozu.html)
- [Srovnání nákladů systémů](https://poracanin.github.io/pizza-visi/naklady-systemu.html)
- [Prezentace navrženého systému](https://poracanin.github.io/pizza-visi/prezentace-systemu.html)

Cenová nabídka má upravitelné ceny, rozpočet po pobočkách, 20% zálohu pouze z realizace, plnou úhradu zařízení před objednáním a jednorázovou integraci EET 2.0 zdarma. Uložené změny cen platí v konkrétním prohlížeči; pro předání upravené varianty použijte tlačítko **Stáhnout vyplněné HTML**. Výchozí nabídku lze znovu sestavit příkazem `python3 .artifacts/cenova-nabidka/build.py`.

Zdrojové podklady, generátory a kontroly jsou v `.artifacts/`; tiskové výstupy prezentace jsou v [`output/pdf/`](output/pdf/). GitHub Pages zveřejňuje pouze obsah `public/` zkopírovaný při buildu do `dist/`.

Workflow `.github/workflows/pages.yml` po každém pushi do `main` spustí testy, sestaví web a nasadí obsah `dist/` do kořene této adresy. Lze ho spustit i ručně v záložce Actions. V Settings → Pages musí být jako zdroj nastaveno **GitHub Actions**. Kořen repozitáře se nepublikuje; archiv podkladů a zdrojové skripty nejsou součástí nasazeného webu. Relativní cesty k souborům podporují umístění pod `/pizza-visi/`.

## Co funguje

Mobilní stránka **[rozvoz.html](https://poracanin.github.io/pizza-visi/rozvoz.html)** navazuje na administraci: tři pobočky, tři kurýři, pořadí zastávek, převzetí připravené objednávky, navigace a volání, potvrzení úhrady a doručení, hlášení problému, historie a denní přehled hotovosti. Na počítači si zachovává mobilní šířku. Nastavení kurýra přepíná oddělenou ukázkovou trasu a objednávky přiřazené v administraci. Sdílení funguje ve stejném prohlížeči a na stejném originu; bez backendu se data nesdílejí mezi zařízeními. Podrobnosti: [docs/courier.md](docs/courier.md).

Administrace / POS je dostupná na **https://poracanin.github.io/pizza-visi/admin/** (lokálně `/admin/`). Obsahuje objednávky podle kanálů včetně Woltu, samostatné sklady tří poboček, příjmy po šaržích s trvanlivostí a tabulku receptur 30 cm. Rozhraní je upravené pro tablet; při zahájení přípravy odečte suroviny jednou, ze šarží s nejbližší spotřebou. Jde o veřejné demo bez přihlášení a živých integrací, s ukládáním v prohlížeči a ukázkovými gramážemi. Podrobnosti: [docs/admin.md](docs/admin.md).

- Výběr převzetí je pouze v objednávce. Doručení vyžaduje kanonickou adresu RÚIAN a automaticky přiřadí obsluhující pobočku. Vyzvednutí nabídne tři fotografické karty poboček přímo ve formuláři, bez adresního pole i bez modalu. Pod zvolenou pobočkou se ukáže adresa, vložená mapa OpenStreetMap s bodem provozovny a odkaz na navigaci. Souřadnice veřejných provozoven v `site.json` odpovídají stávajícím bodům v kurýrní mapě. Samotná stará preference pobočky již neurčuje rozvoz.
- Kompaktní úvodní posuvník (268 px na mobilu, 300 px na počítači): první snímek s pizzou, dále fotografie Rudné, Hostivic a Berouna. Snímky se střídají po 5,5 sekundách, přepínají se tečkami uprostřed, klávesnicí i tahem. Ruční ovládání pozastaví automatiku; respektuje se omezení animací, neaktivní karta a viditelnost sekce. Ovladač přehrávání je přístupný čtečce a při zaměření klávesnicí. Logo má proužek v barvách italské vlajky. Hlavička se po odrolování zmenší o třetinu; při návratu nahoru se vrátí na původní výšku. Připnuté menu sleduje aktuální výšku hlavičky.
- Zaškrtnutí „Zapamatovat pro příště“ ukládá způsob převzetí, pobočku a případné RÚIAN ID do localStorage na nejvýše 180 dní od posledního použití. Adresa se po návratu znovu ověří proti adresáři; text adresy ani kontaktní údaje se do této preference neukládají. Zapamatování i změna adresy jsou dostupné přímo v objednávce. Bez zaškrtnutí je adresa pouze pro aktuální návštěvu.
- Lišta „Cookies a uložené volby“ se otevře po skutečném rolování stránky, ne nad košíkem ani při programovém skoku na menu. Nabízí Přijmout / Jen nezbytné; druhá volba odstraní zapamatovanou adresu, ale zachová aktuální návštěvu a košík. Nastavení jde znovu otevřít v patičce. Web nepřidává analytické ani reklamní cookies; využívá lokální úložiště pro košík a povolené volby.
- Aktuální kontakty a rozvoz podle pobočky, odkazy na mapy a telefon.
- Veřejné menu: všech 24 pizz, 11 nápojů a 12 vín/prosecc se zobrazuje rovnou. Výchozí dlaždice lze přepnout na kompaktní řádky; volba se zachová mezi kategoriemi. Suroviny navíc, okraje a omáčky se vybírají u konkrétní pizzy. Kategorie a filtry s přepínačem zobrazení tvoří dva kompaktní řádky připnuté pod hlavičkou. Vyhledávací pole je odstraněné; na úzkých telefonech mají přepínače zobrazení pouze SVG ikony s přístupnými názvy.
- Celá karta pizzy otevírá samostatnou stránku úprav: velikost, suroviny navíc, mozzarellové okraje, omáčky, množství a poznámka. Velikost se volí až zde; rychlé přidání z menu vloží základní 30cm pizzu. Karty uvádějí cenu „od“ a dostupné průměry bez přepínače.
- Košík s úpravou a odebráním položek, slučováním stejných konfigurací, nápojem navíc a automatickým součtem krabic a rozvozu. Nejvýše 20 kusů jedné konfigurace. Volby menu se obnoví i po reloadu; osobní údaje a poznámky se neukládají.
- Přidání do košíku potvrdí kompaktní zpráva uprostřed obrazovky se zeleným okrajem a fotografií produktu; funguje i nad otevřeným košíkem a respektuje omezení animací.
- Samostatná stránka objednávky s doručením nebo vyzvednutím, kontakty a úplným přehledem bez vnitřního posuvníku. U delší objednávky roluje celá stránka. Způsob převzetí se vybírá až zde. Košík má tři fotografické nabídky nápojů a ukotvené tlačítko pro pokračování; na mobilu zůstává dostupné také potvrzení objednávky.
- Doručení vyžaduje výběr kanonické adresy RÚIAN. Změna textu výběr zneplatní. Veřejná projekce obsahuje 16 856 adres pro oblasti Rudné a Hostivic ze snímku 31. 8. 2026; Beroun nemá v dodaném výběru pokrytí a umožňuje vyzvednutí. SQLite zůstává neveřejný.
- Potvrzení uloží objednávku do stejného lokálního úložiště jako administrace (`pizza-visi-pos-demo-v1`), včetně 30/40 cm, příplatků, poznámek a adresního snímku. Úspěch se zobrazí až po uložení. Opakování stejného požadavku nevytváří duplikát. Nová čísla používají `VISI-RUD-…`, `VISI-HOST-…` nebo `VISI-BER-…`; staré záznamy `VISI-…` zůstávají čitelné. Prefix pobočky je zachován také v administraci a rozvozu.
- Objednávky, kontakt a adresa jsou dostupné v administraci ve stejném prohlížeči a na stejném originu. Neodesílají se restauraci ani mezi zařízeními. Ostrý backend není připojený.
- Apple Pay, Google Pay a karta jsou připravené v rozhraní, ale bez platební brány zůstávají neaktivní. Aktivní je hotovost při převzetí; žádná online úhrada se nesimuluje ani neoznačuje jako zaplacená.
- Objednávky 40 cm a s příplatky se v administraci zobrazí beze změn. Protože skladové receptury existují pouze pro základní 30cm pizzy, administrace u chybějících receptur nepředstírá automatický odečet surovin.
- Mobilní rozvržení, klávesnicová navigace kategorií, nativní dialogy a omezení animací podle nastavení systému.
- Ikony jsou lokální SVG z knihovny Lucide, včetně hvězdiček a symbolu průměru. Zdroj a licence jsou v `public/assets/icons/lucide/`; příkaz `node scripts/sync-icons.mjs` znovu sestaví inline sadu v HTML. Nezávisí na emoji fontech prohlížeče.
- Všechny fotografie, fonty a data jsou lokální; prohlížení nevyžaduje externí služby. Mapy, sociální sítě a telefon se otevírají až na výslovné kliknutí.

## Soubory

- `public/index.html`, `public/style.css`, `public/app.js`: rozhraní a chování.
- `public/hero-carousel.js`, `public/hero-carousel.css`: automatický i ručně ovládaný posuvník; `public/menu-controls.css`: připnuté kategorie a kompaktní ovládání menu.
- `public/compact-header.css`: zmenšení hlavičky po odrolování, včetně mobilu a objednávky.
- `public/pickup-map.js`: mapa vybrané pobočky s místní knihovnou Leaflet a podkladem OpenStreetMap; změna pobočky odpojí předchozí mapu a její události.
- `public/ordering.js`, `public/ordering.css`, `public/checkout-page.css`: konfigurátor, košík a samostatná stránka objednávky; `public/storefront-orders.js`: zápis do lokální administrace.
- `public/cart-model.js`: normalizace košíku, slučování položek, přísady, ceny a bezpečné obnovení uložených voleb.
- `public/data/site.json`: pobočky, kontakty a menu pro web.
- `public/assets/`: fotografie a místní fonty.
- `public/texture.css`, `public/assets/textures/`: jemná textura dřeva a mouky v pozadí.
- `podklady-pizzavisi/`: původní export webu; při buildu se nepřenáší do produkce.
- `docs/design-brief.md`: vizuální specifikace podle referencí.
- `docs/background-texture.md`: původ a zadání vytvořené textury.
- `tests/`: ceny, vyhledávání, fotografie, pobočkové kontakty a demo přiřazování lokalit; výpočty košíku, obnovování, slučování a limity počtů.

Původní PDF s alergeny nesouhlasí s aktuálním menu. Proto nový web odkazuje s dotazy na alergeny přímo na pobočky; starší informace nevydává za aktuální. Nedělní otevírací dobu zdroj neuvádí. Ceny, kontakty a časy odpovídají exportu z 20. 9. 2026 a před ostrým spuštěním je má klient potvrdit. Publikovaná verze slouží jako demo bez skutečných objednávek a plateb.
