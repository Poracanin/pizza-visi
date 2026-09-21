# Pizza Visi

Responzivní web podle fotografií značky. Tmavé pozadí, krémová a měděná typografie, fotografie pizz a úvodní modální výběr pobočky Rudná, Hostivice nebo Beroun.

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
- [Cenová nabídka](https://poracanin.github.io/pizza-visi/cenova-nabidka.html), včetně [cen po pobočkách a platebních podmínek](https://poracanin.github.io/pizza-visi/cenova-nabidka.html#branches)
- [Mapa rozvozu](https://poracanin.github.io/pizza-visi/mapa-rozvozu.html)
- [Srovnání nákladů systémů](https://poracanin.github.io/pizza-visi/naklady-systemu.html)
- [Prezentace navrženého systému](https://poracanin.github.io/pizza-visi/prezentace-systemu.html)

Cenová nabídka má upravitelné ceny, rozpočet po pobočkách, 20% zálohu pouze z realizace, plnou úhradu zařízení před objednáním a jednorázovou integraci EET 2.0 zdarma. Uložené změny cen platí v konkrétním prohlížeči; pro předání upravené varianty použijte tlačítko **Stáhnout vyplněné HTML**. Výchozí nabídku lze znovu sestavit příkazem `python3 .artifacts/cenova-nabidka/build.py`.

Zdrojové podklady, generátory a kontroly jsou v `.artifacts/`; tiskové výstupy prezentace jsou v [`output/pdf/`](output/pdf/). GitHub Pages zveřejňuje pouze obsah `public/` zkopírovaný při buildu do `dist/`.

Workflow `.github/workflows/pages.yml` po každém pushi do `main` spustí testy, sestaví web a nasadí obsah `dist/` do kořene této adresy. Lze ho spustit i ručně v záložce Actions. V Settings → Pages musí být jako zdroj nastaveno **GitHub Actions**. Kořen repozitáře se nepublikuje; archiv podkladů a zdrojové skripty nejsou součástí nasazeného webu. Relativní cesty k souborům podporují umístění pod `/pizza-visi/`.

## Co funguje

Administrace / POS je dostupná na **https://poracanin.github.io/pizza-visi/admin/** (lokálně `/admin/`). Obsahuje objednávky podle kanálů včetně Woltu, samostatné sklady tří poboček, příjmy po šaržích s trvanlivostí a tabulku receptur 30 cm. Rozhraní je upravené pro tablet; při zahájení přípravy odečte suroviny jednou, ze šarží s nejbližší spotřebou. Jde o veřejné demo bez přihlášení a živých integrací, s ukládáním v prohlížeči a ukázkovými gramážemi. Podrobnosti: [docs/admin.md](docs/admin.md).

- Kompaktní úvodní modal: nahoře tři pobočky s fotografiemi, pod nimi doručovací adresa bez přepínání. Zapamatování pobočky a možnost změny.
- Kompaktní hero se ztlumenou fotografií vybrané pobočky v pozadí.
- V modalu lze zadat doručovací adresu: po potvrzení „Doručit sem“ demo automaticky vybere pobočku podle názvu města nebo rozvozové lokality a zavře modal. Překryvy nabídnou ruční volbu, neznámá lokalita se nepotvrdí. Nejde o geokódování ani ověření dostupnosti rozvozu; adresa se neodesílá na server a neukládá do úložiště prohlížeče.
- Aktuální kontakty a rozvoz podle pobočky, odkazy na mapy a telefon.
- 69 položek původního menu, 24 pizz, ceny 30/40 cm, kategorie, hledání a filtrování.
- Kompletní demo objednávky: velikost pizzy, suroviny navíc, mozzarellové okraje, omáčky, množství a poznámka.
- Košík s úpravou a odebráním položek, slučováním stejných konfigurací, nápojem navíc a automatickým součtem krabic a rozvozu. Nejvýše 20 kusů jedné konfigurace. Volby menu se obnoví i po reloadu; osobní údaje a poznámky se neukládají.
- Pokladna pro doručení nebo vyzvednutí, kontrola kontaktů a lokality, tlačítko pro vyplnění demo údajů.
- Simulovaná karta: úspěch, zamítnutí, opakování i návrat ke změně platby; alternativa hotově při převzetí. Po dokončení se vyprázdní košík a zobrazí demo potvrzení s ručně posouvatelným průběhem přípravy a doručení/vyzvednutí.
- Žádná platební brána ani backend nejsou připojené. Skutečné karetní údaje se nezadávají, nic se neúčtuje a objednávka ani kontakt se nikam neodesílají.
- Mobilní rozvržení, klávesnicová navigace kategorií, nativní dialogy a omezení animací podle nastavení systému.
- Všechny fotografie, fonty a data jsou lokální; prohlížení nevyžaduje externí služby. Mapy, sociální sítě a telefon se otevírají až na výslovné kliknutí.

## Soubory

- `public/index.html`, `public/style.css`, `public/app.js`: rozhraní a chování.
- `public/ordering.js`, `public/ordering.css`: konfigurátor, košík, pokladna a platební demo.
- `public/cart-model.js`: normalizace košíku, slučování položek, přísady, ceny a bezpečné obnovení uložených voleb.
- `public/data/site.json`: pobočky, kontakty a menu pro web.
- `public/assets/`: fotografie a místní fonty.
- `public/texture.css`, `public/assets/textures/`: jemná textura dřeva a mouky v pozadí.
- `podklady-pizzavisi/`: původní export webu; při buildu se nepřenáší do produkce.
- `docs/design-brief.md`: vizuální specifikace podle referencí.
- `docs/background-texture.md`: původ a zadání vytvořené textury.
- `tests/`: ceny, vyhledávání, fotografie, pobočkové kontakty a demo přiřazování lokalit; výpočty košíku, obnovování, slučování a limity počtů.

Původní PDF s alergeny nesouhlasí s aktuálním menu. Proto nový web odkazuje s dotazy na alergeny přímo na pobočky; starší informace nevydává za aktuální. Nedělní otevírací dobu zdroj neuvádí. Ceny, kontakty a časy odpovídají exportu z 20. 9. 2026 a před ostrým spuštěním je má klient potvrdit. Publikovaná verze slouží jako demo bez skutečných objednávek a plateb.
