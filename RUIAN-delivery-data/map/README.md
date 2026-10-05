# Podklady mapy rozvozu

Tento adresář obsahuje archivované odpovědi veřejné mapové služby [ČÚZK / RÚIAN](https://ags.cuzk.gov.cz/arcgis/rest/services/RUIAN/MapServer), stažené 5. 10. 2026. Do webového buildu patří pouze odvozený `public/data/delivery-areas.geojson`, nikoli tento zdrojový archiv.

Mapa zobrazuje 24 celých obcí z konfigurace `scripts/ruian-delivery-coverage.json` a pět pražských lokalit. Zličín je jeden objekt s příslušností k Rudné i Hostivici. Popovice u Berouna jsou zahrnuty v celé obci Králův Dvůr. Multipart geometrie Vysokého Újezdu je zachována, včetně oddělené části území.

## Význam hranic

- Obce používají skutečné obecní hranice z vrstvy 12 (`Obec`), ověřené kódem, názvem a okresem.
- Pražské části obce mají v RÚIAN definiční bod, nikoli plošnou hranici. Vrstva 11 a její body jsou archivovány pro ověření identity. Pro přehledovou mapu používáme stejnojmenné katastrální území pod obcí Praha z vrstvy 7 (`KatastralniUzemi`); mapování je explicitně uvedeno v manifestu. Jde o orientační geografické zobrazení, ne o tvrzení, že množina adres části obce je určena polygonem katastru. [Oficiální popis prvků](https://isui.cuzk.gov.cz/help/topics/idh-topic1800.htm).
- Dostupnost rozvozu se nadále určuje z databáze adres RÚIAN podle přesné části obce a aktuální konfigurace. Mapa se pro ověření adres ani cenu rozvozu nepoužívá.
- Staré soubory KML s ručně vyznačenými oblastmi nejsou zdrojem této mapy.

## Reprodukce a aktualizace

`python3 scripts/export-delivery-map.py` provede export bez síťového připojení. Skript ověří SHA-256 zdrojů, úplnost požadovaných identifikátorů, jména a nadřazené obce/okresy, přiřazení poboček, uzavření polygonů a souřadnice. Při chybě zachová předchozí veřejný export. Testy: `python3 -m unittest discover -s tests -p 'test_export_delivery_map.py'`.

Manifest obsahuje úplné zdrojové dotazy, čas stažení, kontrolní součty a ověřené vazby pražských částí na katastry. Při změně lokalit stáhněte odpovídající nové odpovědi a aktualizujte manifest. Oba polygonové zdroje musí pocházet ze stejného dne; export je nezkouší automaticky aktualizovat. Čas stažení není garantované datum platnosti jednotlivých hranic.

Server při exportu použil `outSR=4326`, `maxAllowableOffset=0.00005` stupně (přibližně 3,6–5,6 metru v této oblasti) a šest desetinných míst. Mapové hranice jsou proto generalizované; úzké okrajové rozdíly mohou být viditelné při velkém přiblížení. Export je vhodný pro přehled rozvozu, ne pro geodetické použití.

Data jsou poskytována pod [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), viz [podmínky otevřených dat ČÚZK](https://cuzk.gov.cz/Uvod/Produkty-a-sluzby/Otevrena-data/Otevrena-data-zakladni-informace.aspx). Veřejný export uvádí původ dat a provedené zjednodušení; uživatelská mapa musí zachovat odkaz na zdroj.
