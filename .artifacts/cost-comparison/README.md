# Kalkulace systémů Pizza Visi

Výstup: `public/naklady-systemu.html`, samostatný soubor s vloženým JavaScriptem a fonty. Bez API volání; vstupy se ukládají pouze v localStorage.

Sestavení: `python3 .artifacts/cost-comparison/build.py`

Ověření výpočtů: `node --test .artifacts/cost-comparison/model.test.mjs`

## Výchozí pracovní předpoklady

- 3 pobočky; 30 objednávek denně na každé; 30 dní; zákaznická hodnota objednávky 350 Kč.
- 2 700 objednávek / 945 000 Kč za síť měsíčně. Nejde o skutečné statistiky Pizza Visi.
- Wolt 20 %, Foodora 20 %, Bolt 10 % všech objednávek. Modelová sazba každé služby 25 %, nikoli ověřená smluvní provize. Celkem 118 125 Kč/měsíc.
- Vlastní web 30 % objednávek, platba kartou online u všech; ostatní přímé kanály 20 %.
- Comgate Easy: v základním modelu 100 % běžné spotřebitelské EU karty; 1 % z 283 500 Kč = 2 835 Kč; jeden společný paušál 0 Kč, protože objem překračuje 100 000 Kč. Další typy karet lze změnit vstupem.
- Server 1 200 Kč za celou síť dle uživatele. Pro výpočet považován za částku bez DPH.
- 3× Dotykačka NEOMEZENĚ 1 990 Kč = 5 970 Kč bez DPH/měsíc. Konfigurátor bez terminálu ověřen 21. 9. 2026. Roční varianta 20 298 Kč/rok za licenci odpovídá 1 691,50 Kč/měsíc. Podmíněné minimum 1 385,50 Kč/měsíc vyžaduje terminálový obrat a roční předplatné.
- 3× kompletní 15,6″ pokladna s tiskárnou 17 990 Kč = 53 970 Kč bez DPH. Alternativně samotné pokladny 3×14 990 Kč = 44 970 Kč.
- Vlastní nové POS, vývoj/nasazení, obchodní paušál a další externí poplatky nemají vstupní cenu. Prázdná pole znamenají neznámou položku a brání zobrazení úplné nabídky.

Základní měsíční mezisoučty: dnešní model 124 095 Kč + neznámé náklady; vlastní infrastruktura a provize 122 160 Kč + neznámé náklady + cena práce a podpory. Tyto mezisoučty nejsou stejné rozsahem (dnešní platební poplatky neznáme), a proto jejich rozdíl není tvrzením o úspoře.

## Primární zdroje (21. 9. 2026)

- https://dotykacka.cz/e-shop/neomezene/
- https://dotykacka.cz/e-shop/dotykacka-kompletni-156/
- https://dotykacka.cz/cenik/
- https://www.comgate.eu/cs/ceniky-platebni-brany
- https://merchant.wolt.com/cs/cze/learning-center/wolt-merchant-fees-and-commissions
- https://join.foodora.cz/cs
- https://bolt.eu/en/support/articles/4402863195282/
- https://merchant.wolt.com/cs/cze/solution/integrations
- https://developers.deliveryhero.com/documentation/pos.html
- https://developer.bolt.eu/food/main/

API přístup a případné ceny nejsou potvrzené. Automatizované zpracování objednávek samo o sobě nemění provize. Comgate není počítán z objednávek platforem ani z plateb fyzickým terminálem.

## QA

Šest modelových testů: celkový objem a sdílený server, vyloučení platformových objednávek z brány, hranice pro jediný paušál Comgate, roční licence a karetní mix, klientský paušál bez dvojího serveru, neplatné podíly/sazby.

Prohlížeč: ověřen základ, přepnutí roční ceny, chybová zpráva pro více než 100 % kanálů, reset, vlastní nabídka (paušál 6 000 Kč, POS 10 000 Kč/kus, nasazení 100 000 Kč, externí náklady 500 Kč → klient 127 460 Kč/měsíc a 1 659 520 Kč první rok). Mobil 390 px: stránka bez horizontálního přesahu, tabulky samostatně posuvné.
