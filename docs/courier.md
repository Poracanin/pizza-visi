# Mobilní rozvoz Pizza Visi

Veřejně: https://poracanin.github.io/pizza-visi/rozvoz.html

Samostatná mobilní stránka `public/rozvoz.html` s lokálními fonty, tmavou, měděnou a krémovou paletou administrace. I na počítači zůstává široká nejvýše 460 px. Vychází z karet, adresy, kontaktu, navigace a potvrzení doručení v referenčním `pizza-bellizzi/admin/rozvoz.html`; nepřebírá jeho zákaznické kontakty, účet pro QR platby ani backend. Styl i data jsou Pizza Visi.

## Použití

- **Trasa:** vlastní objednávky z webu a pokladny, na cestě nebo na pobočce; detail položek, balného a dopravy, poznámka zákazníka. Nepřebírá kurýry Woltu, foodory a Boltu.
- Převzetí funguje jen pro připravenou objednávku přiřazenou danému kurýrovi a pobočce. Použije existující předání v POS, bez dalšího odečtu skladu.
- Skutečné doručení v rámci dema je samostatný záznam `courierDelivery` na objednávce. POS status `completed` nadále znamená předání kurýrovi; sám o sobě není doručením zákazníkovi.
- Hotovost a platba kartou vyžadují potvrzení úhrady; online demo už platbu nepřebírá. Žádné peníze se neúčtují a Comgate/terminál nejsou připojené.
- Problém s doručením zůstává na trase, dokud jej kurýr neoznačí jako vyřešený. Záznam neposílá oznámení na pobočku; k tomu je k dispozici skutečný telefonní odkaz pobočky.
- **Doručené:** historie pouze vybraného kurýra a pobočky.
- **Přehled:** dnešní hotovost, karta, online platby a hotovost ještě k vybrání. Den se počítá v Europe/Prague. Nejde o účetní uzávěrku.
- V profilu K1/K2/K3 je výběr pobočky, kurýra a zdroje dat.

## Dva zdroje dat

**Ukázková trasa** používá oddělený klíč `pizza-visi-courier-preview-v1`. Kurýr 1 má na každé pobočce dvě objednávky na cestě a jednu připravenou. Jména zákazníků jsou smyšlená, telefon zákazníka není vyplněný. Ukázkové cíle mají adresy veřejných míst; mapa další zastávky je vidět přímo v přehledu i detailu. Vložená OpenStreetMap mapa vyžaduje připojení k internetu a navigace otevře stejnou adresu v Google Maps. Starší ukázkové adresy se automaticky doplní bez změny stavu doručení, úhrad či skladu; vlastní upravené adresy se zachovají. Ukázku lze po potvrzení obnovit; neovlivní data POS.

**Rozvozy z administrace** používají `pizza-visi-pos-demo-v1`, stejný záznam jako POS. V administraci přiřaďte objednávku tlačítkem **Naplánovat rozvoz**. Zde zvolte stejnou pobočku a kurýra. Navigace se otevře do Google Maps až na kliknutí, telefon jen pro platné vyplněné číslo. Pokud při prvním otevření existují přiřazené rozvozy, aplikace je automaticky zobrazí; jinak nabídne samostatnou ukázku.

Zápisy používají stejný Web Lock jako administrace a načítají aktuální data před každou změnou. Otevřený detail kontroluje, zda se objednávka mezitím nezměnila. Změny jiných objednávek se zachovávají. Událost `storage` obnovuje jiná okna; při změně dat zavře otevřený detail. Bez Web Locks používejte jedno okno. Poškozený záznam aplikace ohlásí, nenahradí jej novou ukázkou.

Jde o veřejný prototyp bez ověřování identity. Přepnutí kurýra není přihlášení. Data se sdílejí pouze v jednom prohlížeči na stejném originu; pro propojení telefonu a POS v provozu je potřeba backend, přihlášení a serverová synchronizace. QR platba se bez potvrzeného účtu Pizza Visi nevytváří.

## Ověření

`tests/courier.test.mjs` ověřuje oddělení poboček a kurýrů, filtr externích platforem, obnovení uloženého stavu, životní cyklus převzetí a doručení, opakované akce bez dalšího odečtu skladu, potvrzení plateb, problémy s doručením a zamítnutí poškozených záznamů. UI se ověřuje na mobilních šířkách 390 a 320 px, včetně detailu a spodní navigace. Všechny prostředky a odkazy jsou relativní pro publikaci pod `/pizza-visi/`.

## Podklady pro ukázkové mapy

Použité adresy nejsou zákazníci ani skutečné zakázky. Tři body na pobočku vycházejí z veřejných adres městských institucí a adres pizzerií v `public/data/site.json`. Ověřeno 21. 9. 2026:

- Rudná: Masarykova 94/53 ([registr veřejné správy](https://portal.gov.cz/organy-verejne-moci-interni/mesto-rudna-4593)), Riegerova 527/50 (pobočka), 5. května 583 ([kontakty školy](https://zsrudna5kvetna.cz/kontakty/)).
- Hostivice: Husovo náměstí 13 ([dokument města](https://www.hostivice-mesto.cz/assets/File.ashx?id_dokumenty=446710&id_org=4583)), Husovo náměstí 1702 ([městská knihovna](https://www.mksh.cz/knihovna/o-knihovne/)), Husovo náměstí 60 (pobočka).
- Beroun: Pod Kaplankou 21 ([adresy města](https://www.mesto-beroun.cz/mesto-a-urad/)), Pivovarská 105/11 (pobočka).

Automatické vložení mapy platí pro tyto explicitně označené veřejné ukázkové body. Běžné objednávky z POS se automaticky na mapovou službu neodesílají.

Mapy používají lokálně přibalený Leaflet 1.9.4 se zachovanou licencí a dlaždice OpenStreetMap s atribucí. Souřadnice veřejných bodů jsou pevně uložené; web nevolá geokódovací API. Body poboček pocházejí z existující mapy rozvozu, ostatní z jednorázového dohledání přes Nominatim (cache v `.artifacts/courier-map/`).

Jednorázové geokódování dodrželo [pravidla Nominatim](https://operations.osmfoundation.org/policies/nominatim/): jediný klient, nejvýše jeden požadavek za sekundu, identifikovaný User-Agent a uložené výsledky. Nejde o běžící adresní vyhledávání v aplikaci.
