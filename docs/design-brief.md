# Pizza Visi — směr návrhu

## Aktuální vzhled hlavního webu · 22. 9. 2026

Na přání uživatele je zákaznický web nově černý, bílý a červený. Pozadí `#050506`, povrchy `#101113`, text `#f6f6f7`, sekundární text `#a7a8b0`, červený textový akcent `#ff4d5d`, plná tlačítka `#df2034` s bílým textem a hover `#c9192b`. Vzhled dokončuje `public/theme.css`: dvouřádkový úvodní nadpis, karty se zaoblením 12–18 px, tlačítka 9–12 px, zaoblené filtry a decentní červené podbarvení. Fotografie poboček, italské linky a existující objednávkový proces zůstávají. Platí pouze pro hlavní web a jeho objednávkové dialogy; administrace, rozvoz, mapy a nabídky mají samostatné styly.

Pozdější úprava podle dodané reference: místo jednolitého pozadí je pod hlavním webem tmavá kamenná textura s rukolou, žampiony a pepřem u okrajů. Stávající červená paleta zůstává. Podrobnosti a prompt jsou v `docs/background-texture.md`.

Níže je původní návrhový podklad, jeho barevné a geometrické hodnoty jsou pro hlavní web nahrazené aktuálním směrem výše.

## Původní reference

Prohlédnuté reference: `Snímek obrazovky 2026-09-20 v 20.54.55.png` (tištěné menu) a `Snímek obrazovky 2026-09-20 v 20.55.01.png` (vývěsní štít). Fotografie poboček: `Rudna.png`, `hostivice.png`, `Beroun.png`. Referencemi jsou fotografie fyzických tiskovin a označení provozovny; rozmístění webu a všechny interakce jsou nově navržené.

Pozorováno: antracitové plochy, světlé výrazné úzké nadpisy, měděný akcent v názvu VISI, linka v italských barvách a obrysové kresby pizzy/surovin. Písmo je vysoké a bezpatkové; přesný font z rastru nelze potvrdit. Pro realizaci bylo zvoleno Bebas Neue a Work Sans, dostupné také mezi písmy původního webu.

| Role/token | Zvolená hodnota | Použití | Původ |
|---|---|---|---|
| Pozadí | `#24262a` | Základní plocha a dialogy | Návrh blízký fotografiím |
| Tmavá plocha | `#1d1f22` | Menu, patička, oddělení sekcí | Návrh |
| Světlý text | `#f3ece2` | Hlavní text a titulky | Návrh podle teplé bílé z reference |
| Měděná | `#d2a087` | VISI, důraz v titulcích a tlačítka | Návrh podle akcentu v referenci |
| Italské detaily | Tlumená zelená, krémová, červená | Tříbarevné linky | Pozorováno, odstíny zvolené |
| Nadpisy | Bebas Neue | Hlavní sdělení, názvy a ceny | Návrh |
| Běžný text | Work Sans | Popisy, ovládání, kontakty | Návrh |
| Šířka obsahu | 1200 px maximum | Centrování a odsazení | Návrh |
| Zaoblení | 2–7 px | Nenápadné zakončení tlačítek a karet | Návrh |

## Navržená struktura a chování

Při první návštěvě se otevře nativní modální dialog se třemi fotografickými kartami. Pobočku lze zvolit, dialog zavřít i ovládat klávesnicí. Volba zůstává v lokálním úložišti a je dostupná v horní navigaci. Následuje velký úvod s pizzou a přechodem do menu, 69 položek v kategoriích, příběh, rozvoz se zvolenou pobočkou, kontakty všech poboček a patička.

Menu má přepínání velikostí 30/40 cm, hledání bez diakritiky, filtrování základu a pálivosti. Detail jídla pokračuje k telefonickému objednání konkrétní pobočky. Web neslibuje odeslání online objednávky. Na telefonu se karty výběru pobočky skládají pod sebe, hlavní navigace se schová pod tlačítko a pizza menu má dva sloupce. Dialogy mají omezenou výšku, vnitřní posun a ovládání Escape; stránka pod nimi neposouvá obsah. Respektuje se omezený pohyb systému.

## Samostatné zadání pro další úpravy

> Vytvoř moderní český web Pizza Visi se třemi pobočkami Rudná, Hostivice a Beroun. Při první návštěvě otevři modální výběr pobočky se skutečnými fotografiemi provozoven, adresou a otevírací dobou. Výběr pamatuj a umožni jeho změnu v navigaci. Použij jako zvolené realizační hodnoty antracit `#24262a`, tmavší plochy `#1d1f22`, teplý text `#f3ece2` a měděný akcent `#d2a087`. Vysoké úzké nadpisy sázej v Bebas Neue a běžný text ve Work Sans. Zachovej italskou linku, nenápadné kresby surovin a výraznou fotografii pizzy. Omez zaoblení na 2–7 px a maximální šířku na 1200 px. Po úvodu zobraz jídelní lístek, příběh, rozvoz, tři pobočky a patičku. Čerpej z `public/data/site.json`; používej pouze skutečné ceny a kontakty. Zpřístupni všechny položky menu, dvě velikosti pizzy, hledání, filtr základu/pálivosti a detaily jídel. Objednání musí otevřít jasnou nabídku telefonického kontaktu na zvolenou pobočku, bez předstírání funkčního backendu. Mobilní rozvržení navrhni jako adaptaci: svislé karty poboček, kompaktní navigace, dvě karty pizzy na řádek. Ověř klávesnici, fokus a Escape v dialogu, zachování pobočky po obnovení, správný telefon po změně pobočky, ceny 30/40 cm a chybějící přetékání na 390px displeji.
