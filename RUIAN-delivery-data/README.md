# RÚIAN adresy podle rozvozových lokalit Pizza Visi

Veřejný soubor `public/data/ruian-addresses.json` vzniká z **celých oficiálních obecních CSV**, nikoli z původního polygonového výběru nebo z jeho omezené databáze SQLite. Seznam lokalit určuje `scripts/ruian-delivery-coverage.json`. Původní složka `RUIAN-data-20260930-213506` zůstává beze změn.

## Pokrytí

- **Rudná:** celé obce Rudná, Nučice (Praha-západ), Chrášťany (Praha-západ), Drahelčice, Úhonice, Tachlovice, Jinočany, Zbuzany a Vysoký Újezd (Beroun); pražské části Zličín a Třebonice.
- **Hostivice:** celé obce Hostivice, Jeneč, Hostouň (Kladno), Dobrovíz, Kněževes (Praha-západ), Středokluky, Svárov (Kladno), Chýně a Červený Újezd (Praha-západ); pražské části Zličín, Řepy, Ruzyně a Sobín.
- **Beroun:** celé obce Beroun, Králův Dvůr, Vráž (Beroun), Hýskov, Tetín (Beroun) a Trubín. **Popovice jsou část obce Králův Dvůr, kód 72966**, a jsou tedy již zahrnuté. Žádná samostatná obec Popovice z jiného okresu se nepřidává.

Praha se filtruje podle **kódu části obce** (sloupec `Kód části obce`): Zličín `400351`, Třebonice `490211`, Řepy `400483`, Ruzyně `400394`, Sobín `193259`. Městské části a městské obvody se k vymezení nepoužívají. Celé ostatní obce zahrnují všechny své části a všechna adresní místa, včetně míst bez souřadnic. Nevyjmenované lokality z dřívějších polygonů se neexportují.

## Zdroje a licence

Poskytovatel: **Český úřad zeměměřický a katastrální (ČÚZK), RÚIAN**. [Oficiální stažení adresních míst](https://nahlizenidokn.cuzk.gov.cz/StahniAdresniMistaRUIAN.aspx), [struktura CSV](https://vdp.cuzk.gov.cz/vymenny_format/csv/ad-csv-struktura.pdf), [licence CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

Všech 25 obecních adresních zdrojů zachovává jediný skutečný snímek **2026-08-31**. Devatenáct archivů se znovu používá ze složky `RUIAN-data-20260930-213506/zdrojove`. Šest zdrojů pro Berounsko bylo staženo z oficiálních adres ČÚZK dne **2026-10-05** do této složky `sources/`:

| Kód obce | Obec | Adresních míst |
| --- | --- | ---: |
| 531057 | Beroun | 4 084 |
| 531243 | Hýskov | 911 |
| 531839 | Tetín | 379 |
| 531944 | Vráž | 816 |
| 533106 | Trubín | 236 |
| 533203 | Králův Dvůr včetně Popovic | 2 587 |

`source-manifest.json` uvádí pro každý použitý soubor původní URL, cestu v projektu, skutečný čas stažení, HTTP `Last-Modified`, datum snímku, název CSV, kontrolní součty SHA-256 archivu i CSV a počet všech zdrojových řádků. Dříve stažené číselníky `UI_OBEC.zip` a `UI_CAST_OBCE.zip` ověřují názvy, okresy a nadřazené obce. Jejich původní datum stažení 2026-09-30 je zachováno a jejich neznámé datum snímku zůstává `null`; nevydávají se za srpnová adresní data.

Úprava dat spočívá ve výběru vyjmenovaných lokalit a ve formátování adres. Veřejný export obsahuje jen ID adresního místa, adresní popisek, příslušnost k pobočkám a PSČ. Neobsahuje vlastnické údaje ani údaje objednávek.

## Opakovatelný export a ověření

Z kořene projektu, bez přístupu k síti a bez dodatečných balíčků:

```sh
python3 scripts/export-ruian.py
python3 -m unittest discover -s tests -p 'test_export_ruian.py'
```

Volitelné parametry exportéru: `--manifest`, `--coverage`, `--output`. Cesty ke zdrojům uvnitř manifestu jsou relativní vůči kořeni projektu. Původní parametr `--database` se již nepoužívá.

Exportér ověřuje všechny zdroje před nahrazením veřejného souboru: kontrolní součty, úplnost řádků, shodu kódů/názvů/okresů, vazby částí obcí, datum a jméno souboru, unikátní ID adres a neprázdnost každé požadované lokality. Chybějící nebo pozměněný zdroj export zastaví. Smíšená data snímků schéma verze 1 nepodporuje; export skončí chybou a ponechá předchozí veřejný soubor. CSV jsou Windows-1250 se středníkem, export je UTF-8. Řádky jsou stabilně řazeny číselně podle ID adresního místa.

Výsledek: **25 125 unikátních adres**, z toho Rudná **6 959**, Hostivice **9 701**, Beroun **9 013**. Celkem **548 adres ve Zličíně** patří Rudné i Hostivicím, a proto se v součtu poboček započítají dvakrát. Bity jsou `rudna: 1`, `hostivice: 2`, `beroun: 4`; překryv Zličína má masku `3`.
