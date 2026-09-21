# Pizza Visi POS / administrace

Veřejné demo: https://poracanin.github.io/pizza-visi/admin/

Lokálně: `npm run dev`, poté http://localhost:4188/admin/. Lokální server i GitHub Pages přesměrují variantu bez koncového lomítka na `/admin/`.

## Rozhraní a původ

Adaptace dodaného `POS-prototype`: zachovává boční navigaci, čtyřsloupcový přehled objednávek, rozdělení podle kanálů, založení objednávky s katalogem a košíkem a potvrzovací dialog. Rozhraní používá tmavou, krémovou a měděnou paletu Pizza Visi a místní fonty a fotografie z webu. Loga Wolt, foodora a Bolt Food jsou převzata z prototypu, jejich zdroje uvádí `public/admin/assets/logos/README.md`. Původní prototyp v jiném projektu se neupravuje.

## Funkční demo

- Objednávky z webu, pokladny, Woltu, foodory a Bolt Food; filtry kanálů, potvrzení, příprava, výdej a historie. Objednávku před přípravou lze zrušit; po přípravě se neposouvá zpět a nelze automaticky vracet spotřebované suroviny.
- Nová objednávka s 24 pizzami ve dvou velikostech, nápoji a vínem, množstvím, kanálem, předáním a ukázkovou platbou. Ceny a fotografie se čtou ze stejného `public/data/site.json` jako veřejný web. Nápoje nepodléhají skladu surovin na pizzu.
- Sklady Rudná, Hostivice a Beroun jsou oddělené. Obsahují 32 surovin, minimální orientační zásoby, hledání, filtr nízkých zásob a přehled posledních 20 pohybů (úplné pohyby zůstávají uložené).
- Naskladnění v kg/g nebo l/ml s náhledem výsledného množství. Interní množství je vždy celé g nebo ml. Příjem musí být kladný.
- Receptury pro všech 24 pizz, zvlášť 30 a 40 cm; lze upravit množství a přidat nebo odebrat některou z 32 surovin. Hodnota 0 surovinu vyřadí. Receptury jsou společné všem pobočkám.
- Při přechodu do přípravy se sečtou potřebné suroviny všech položek, velikostí a počtů. Kontrola zásob proběhne před jakýmkoli odečtem. Nedostatek zablokuje celý přechod a vypíše chybějící množství.
- Odečet se provede jednou a uloží spolu s objednávkou a pohybem skladu. Opakované kliknutí, obnovení stránky ani další přechody sklad znovu nesníží. Historický odečet uchovává původní množství i po změně receptury.

## Gramáže a ukázková data

Gramáže a počáteční zásoby jsou **ukázkové**, nikoli ověřené normy pizzerie. Receptury je nutné nastavit podle skutečné kuchyně. Těsto se eviduje jako hotový polotovar; rozpad na mouku, vodu, droždí a další složky není součástí tohoto modelu.

Suroviny vycházejí z exportovaných popisů. Různé zápisy šunky, smetany a ventriciny jsou sjednocené. Chybný spojený text „mozarella balzamikový krém“ u Krémové byl přiřazen k balzamikovému krému; mozzarella zůstává samostatná. Před ostrým použitím musí kuchyně toto přiřazení i celý obsah receptur potvrdit.

Každá pobočka začíná sedmi smyšlenými objednávkami. Dvě už zahájily přípravu a jejich odečty jsou zahrnuté ve skladu i pohybech. Neobsahují zákaznické kontakty z původního prototypu. Vlastní objednávky používejte jen s ukázkovým označením.

## Ukládání a omezení

Jde o statické **veřejné demo bez přihlášení**. Není připojené k objednávkám veřejného webu, k platební bráně ani k API rozvozových platforem. Tlačítka žádné reálné objednávky nepotvrzují a žádné platby neprovádějí.

Jeden záznam `localStorage` pod klíčem `pizza-visi-pos-demo-v1` obsahuje zásoby, receptury, objednávky a pohyby. Zápis se provede až po úspěšné validaci celé operace. U moderních prohlížečů podporujících Web Locks se úpravy z různých oken stejného prohlížeče provádějí postupně nad aktuálními daty. Bez Web Locks používejte jedno okno. Změna receptury v jiném okně během editace vyvolá upozornění místo přepsání.

Data se nesdílejí mezi zařízeními či odlišnými adresami webu. Smazání dat prohlížeče odstraní demo stav. Nedostupné úložiště, chyba zápisu nebo poškozená uložená data jsou oznámeny; poškozená data se tiše nenahrazují. Pro skutečný provoz je potřeba serverová databáze, přihlášení a role, serverové transakce a audit a skutečné integrace.

## Ověření a nasazení

`npm test` zahrnuje pokrytí receptur, násobení množství a velikostí, nedostatek zásob, opakované zahájení, obnovu, oddělení poboček, naskladnění, změny norem, storno a nápoje. GitHub Actions po úspěšných testech a `npm run build` nasadí veřejný web i složku `admin/` společně.
