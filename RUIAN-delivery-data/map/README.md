# Podklady mapy rozvozu

Tento adresář obsahuje archivované odpovědi veřejné mapové služby [ČÚZK / RÚIAN](https://ags.cuzk.gov.cz/arcgis/rest/services/RUIAN/MapServer), stažené 5. 10. 2026. Do webového buildu patří pouze odvozený `public/data/delivery-areas.geojson`, nikoli tento zdrojový archiv.

Mapa zobrazuje 26 celých obcí z konfigurace `scripts/ruian-delivery-coverage.json` a sedm částí obce, celkem 33 oblastí. Rudná nově zahrnuje Dobříč (539180), Mezouň (531537) a Loděnice (531464). Zličín je jeden objekt s příslušností k Rudné i Hostivici. Popovice u Berouna jsou zahrnuty v celé obci Králův Dvůr. Z obce Vysoký Újezd jsou zahrnuty pouze části Vysoký Újezd a Kuchař; Kozolupy (část 71960, katastr 671967) jsou z rozvozu vyloučeny.

## Význam hranic

- Obce používají skutečné obecní hranice z vrstvy 12 (`Obec`), ověřené kódem, názvem a okresem.
- Části obce mají v RÚIAN definiční bod, nikoli plošnou hranici. Vrstva 11 a její body (`municipality-parts.geojson`) jsou archivovány pro ověření identity. Pro přehledovou mapu používáme katastrální území pod stejnou obcí z vrstvy 7 (`KatastralniUzemi`); mapování jmen a kódů je explicitně uvedeno v manifestu. Export ověřuje oficiální názvy a kódy částí, katastrů i nadřazených obcí (`part-parents.geojson`) a přítomnost definičního bodu uvnitř odpovídajícího katastru. Jde o orientační geografické zobrazení, ne o tvrzení, že množina adres části obce je určena polygonem katastru. [Oficiální popis prvků](https://isui.cuzk.gov.cz/help/topics/idh-topic1800.htm).
- Pět pražských částí používá stejnojmenné katastry. Část Vysoký Újezd (188441) odpovídá katastru **Vysoký Újezd u Berouna (788449)** a část Kuchař (76945) katastru **Kuchař (676942)**. Obě mají oficiálně nadřazenou obec Vysoký Újezd (531961), ale nemají zahrnovat celou obec s Kozolupy. Jejich identitu i rozdílný název katastru potvrzují archivované odpovědi veřejné služby, nikoli odhad podle textu názvu. Referenční soubor `excluded-parts.geojson` archivuje oficiální definiční bod Kozolup a regresní test ověřuje, že neleží v žádné oblasti rozvozu.
- Dostupnost rozvozu se nadále určuje z databáze adres RÚIAN podle přesné části obce a aktuální konfigurace. Mapa se pro ověření adres ani cenu rozvozu nepoužívá.
- Staré soubory KML s ručně vyznačenými oblastmi nejsou zdrojem této mapy.

## Reprodukce a aktualizace

`python3 scripts/export-delivery-map.py` provede export bez síťového připojení. Skript ověří SHA-256 zdrojů, úplnost požadovaných identifikátorů, jména a nadřazené obce/okresy, přiřazení poboček, uzavření polygonů a souřadnice. Při chybě zachová předchozí veřejný export. Testy: `python3 -m unittest discover -s tests -p 'test_export_delivery_map.py'`.

Manifest obsahuje úplné zdrojové dotazy, čas stažení, kontrolní součty a ověřené vazby částí na katastry. Při změně lokalit stáhněte odpovídající nové odpovědi a aktualizujte manifest. Oba polygonové zdroje musí pocházet ze stejného dne; export je nezkouší automaticky aktualizovat. Čas stažení není garantované datum platnosti jednotlivých hranic.

Server při exportu použil `outSR=4326`, `maxAllowableOffset=0.00005` stupně (přibližně 3,6–5,6 metru v této oblasti) a šest desetinných míst. Mapové hranice jsou proto generalizované; úzké okrajové rozdíly mohou být viditelné při velkém přiblížení. Export je vhodný pro přehled rozvozu, ne pro geodetické použití.

Data jsou poskytována pod [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), viz [podmínky otevřených dat ČÚZK](https://cuzk.gov.cz/Uvod/Produkty-a-sluzby/Otevrena-data/Otevrena-data-zakladni-informace.aspx). Veřejný export uvádí původ dat a provedené zjednodušení; uživatelská mapa musí zachovat odkaz na zdroj.
