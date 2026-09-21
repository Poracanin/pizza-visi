# Pizza Visi POS / administrace

Veřejné demo: https://poracanin.github.io/pizza-visi/admin/

Lokálně: `npm run dev`, poté http://localhost:4188/admin/. Lokální server i GitHub Pages přesměrují variantu bez koncového lomítka na `/admin/`.

## Rozhraní a původ

Adaptace dodaného `POS-prototype`: zachovává boční navigaci, čtyřsloupcový přehled objednávek, rozdělení podle kanálů, založení objednávky s katalogem a košíkem a potvrzovací dialog. Rozhraní používá tmavou, krémovou a měděnou paletu Pizza Visi a místní fonty a fotografie z webu. Loga Wolt, foodora a Bolt Food jsou převzata z prototypu, jejich zdroje uvádí `public/admin/assets/logos/README.md`. Původní prototyp v jiném projektu se neupravuje.

Rozhraní je přizpůsobené 15″ tabletu: kompaktní hlavička, čtyři samostatně posuvné sloupce objednávek, karty celé barevné podle zdroje, větší text a dotykové ovládání. Filtry kanálů jsou pod přehledem.

## Funkční demo

- Objednávky z webu, pokladny, Woltu, foodory a Bolt Food; filtry kanálů, potvrzení, příprava, výdej a historie. Objednávku před přípravou lze zrušit; po přípravě se neposouvá zpět a nelze automaticky vracet spotřebované suroviny.
- Nová objednávka s 24 pizzami pouze ve velikosti 30 cm, nápoji a vínem, množstvím, kanálem, předáním a ukázkovou platbou. Ceny a fotografie se čtou ze stejného `public/data/site.json` jako veřejný web. Nápoje nepodléhají skladu surovin na pizzu.
- Sklady Rudná, Hostivice a Beroun jsou oddělené. Obsahují 32 surovin. Kompaktní tabulka zobrazuje použitelné množství, minimum, poslední příjem, nejbližší datum spotřeby a stav. Filtry umí nízké zásoby, spotřebu do 3 dnů, prošlé a nedatované zásoby. Souhrny jsou pod tabulkou, historie posledních 20 pohybů v rozbalovací sekci (úplné pohyby zůstávají uložené).
- Naskladnění v kg/g nebo l/ml s náhledem výsledného množství. Interní množství je vždy celé g nebo ml. Příjem musí být kladný. Každý příjem vytváří šarži s datem příjmu a povinným datem spotřeby. Datum příjmu nesmí být v budoucnosti a spotřeba nesmí předcházet příjmu. Označení šarže lze vyplnit nebo se přidělí automaticky.
- Receptury 30 cm jsou jedna editovatelná tabulka: řádky tvoří 24 pizz, sloupce 32 surovin. Název pizzy a záhlaví zůstávají při posunu viditelné; lze hledat pizzu i sloupec. Hodnota 0 nebo prázdné pole surovinu vyřadí. Změny více buněk se ukládají společně, chybná hodnota či souběžná změna stejné buňky zablokuje celé uložení. Receptury jsou společné všem pobočkám.
- Při přechodu do přípravy se sečtou potřebné suroviny všech položek a počtů. Kontrola zásob proběhne před jakýmkoli odečtem. Nedostatek zablokuje celý přechod a vypíše chybějící množství.
- Výdej ze šarží probíhá podle nejbližšího data spotřeby (FEFO). Šarže lze použít do konce uvedeného dne v časovém pásmu Europe/Prague; prošlé a nedatované šarže se do dostupných zásob nepočítají. Jeden výdej může čerpat z více šarží. Historie uchovává množství a identifikaci použitých šarží.
- U šarží lze doplnit nebo opravit datum a označení, případně vyřadit celý zbytek s uvedením důvodu. Každá oprava a vyřazení vytváří záznam v historii. Již provedené výdeje zůstávají zachované.
- Odečet se provede jednou a uloží spolu s objednávkou a pohybem skladu. Opakované kliknutí, obnovení stránky ani další přechody sklad znovu nesníží. Historický odečet uchovává původní množství i po změně receptury.

## Gramáže a ukázková data

Gramáže a počáteční zásoby jsou **ukázkové**, nikoli ověřené normy pizzerie. Receptury je nutné nastavit podle skutečné kuchyně. Těsto se eviduje jako hotový polotovar; rozpad na mouku, vodu, droždí a další složky není součástí tohoto modelu.

Suroviny vycházejí z exportovaných popisů. Různé zápisy šunky, smetany a ventriciny jsou sjednocené. Chybný spojený text „mozarella balzamikový krém“ u Krémové byl přiřazen k balzamikovému krému; mozzarella zůstává samostatná. Před ostrým použitím musí kuchyně toto přiřazení i celý obsah receptur potvrdit.

Počáteční demo šarže mají ukázkové datum spotřeby 14 dní od založení dema; nejde o doporučenou trvanlivost surovin.

Každá pobočka začíná sedmi smyšlenými objednávkami. Dvě už zahájily přípravu a jejich odečty jsou zahrnuté ve skladu i pohybech. Neobsahují zákaznické kontakty z původního prototypu. Vlastní objednávky používejte jen s ukázkovým označením.

## Ukládání a omezení

Jde o statické **veřejné demo bez přihlášení**. Není připojené k objednávkám veřejného webu, k platební bráně ani k API rozvozových platforem. Tlačítka žádné reálné objednávky nepotvrzují a žádné platby neprovádějí.

Jeden záznam `localStorage` pod klíčem `pizza-visi-pos-demo-v1` obsahuje zásoby, šarže, receptury, objednávky a pohyby ve formátu verze 2. Klíč úložiště zůstává stejný kvůli převodu předchozích dat. Zápis se provede až po úspěšné validaci celé operace. U moderních prohlížečů podporujících Web Locks se úpravy z různých oken stejného prohlížeče provádějí postupně nad aktuálními daty. Bez Web Locks používejte jedno okno. Změna receptury v jiném okně během editace vyvolá upozornění místo přepsání.

Při převodu verze 1 se zachová skutečný uložený stav zásob i historické odečty. Protože stará evidence neznala trvanlivost, převedené zásoby mají nevyplněná data, jsou označené „Doplnit datum“ a vyžadují doplnění v přehledu šarží před použitím. Čekající demo objednávky 40 cm se převedou na 30 cm a přepočítají; již zahájené či historické objednávky se nepřepisují. Nová administrativní objednávka může obsahovat pouze pizzu 30 cm. Veřejný zákaznický web zatím zůstává beze změny.

Data se nesdílejí mezi zařízeními či odlišnými adresami webu. Smazání dat prohlížeče odstraní demo stav. Nedostupné úložiště, chyba zápisu nebo poškozená uložená data jsou oznámeny; poškozená data se tiše nenahrazují. Pro skutečný provoz je potřeba serverová databáze, přihlášení a role, serverové transakce a audit a skutečné integrace.

## Ověření a nasazení

`npm test` zahrnuje pokrytí receptur 30 cm, násobení množství, nedostatek zásob, opakované zahájení, obnovu, oddělení poboček, naskladnění, FEFO, blokaci prošlých a nedatovaných šarží, přechod přes pražskou půlnoc, opravy dat příjmu, vyřazení, atomické změny norem, souběžné konflikty, migraci předchozího formátu, storno a nápoje. GitHub Actions po úspěšných testech a `npm run build` nasadí veřejný web i složku `admin/` společně.
