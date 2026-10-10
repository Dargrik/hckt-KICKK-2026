# Data

Projekt stojí jen na otevřených a veřejných datech. Níže jsou všechny datové sady, které jsme použili, odkud jsou a k čemu nám posloužily. Výsledky výpočtů jsou ve složce `data/clean/` a ke stažení na [dojedeme.cz/mapa](https://dojedeme.cz/mapa).

## Otevřená data Karlovarského kraje (DATA ZÁPAD)

| Datová sada | Licence | Co obsahuje | K čemu jsme ji použili |
|---|---|---|---|
| [Autobusové zastávky v Karlovarském kraji](https://www.datazapad.cz/datasets/979283f4b7ec4b778b8eed7aab6917c3_0) | CC BY 4.0 | 1 840 stanovišť zastávek IDOK se souřadnicemi | kontrola poloh zastávek z jízdních řádů, zastávky obcí |
| [Nemocnice v Karlovarském kraji](https://www.datazapad.cz/datasets/03dbe5719ab64960ae70ee90af4790c6_3) | CC BY 4.0 | 5 nemocnic s adresou, telefonem a webem | cíle cest, spádové oblasti nemocnic |
| [Lékařská a lékárenská pohotovostní služba](https://www.datazapad.cz/datasets/72aa9de6abc94f949f3959e70e0d241d_0) | CC0 1.0 | 16 pohotovostí s ordinačními hodinami po dnech | pohotovost v sobotu, cíle cest |
| [Seznam obcí Karlovarského kraje](https://www.datazapad.cz/datasets/Kakraj::seznam-obcí-karlovarského-kraje) | CC0 1.0 | 134 obcí, hranice a kontakty na úřady | mapy, přiřazení míst k obcím, letáky |
| [Obce s rozšířenou působností](https://www.datazapad.cz/datasets/Kakraj::obce-s-rozšířenou-působností-karlovarského-kraje) | CC0 1.0 | 7 ORP a jejich obce | cesta na vlastní úřad |
| [Matriční úřady](https://www.datazapad.cz/datasets/Kakraj::matriční-úřady-karlovarského-kraje-) | CC0 1.0 | 44 matrik s úředními hodinami | cíle cest (úřady) |
| [Poskytovatelé sociálních služeb](https://www.datazapad.cz/datasets/8a71d71444f14acd8d43023ce9c3fb95_0) | CC0 1.0 | 220 sociálních služeb | služby, které pomáhají s dopravou |
| [Pobytové sociální služby pro seniory](https://www.datazapad.cz/datasets/0fc741fffbb44c31820304ec60cc2ff0_3) | CC0 1.0 | 44 pobytových služeb | doplnění sociálních služeb |

Staženo 9. 10. 2026.

## Další zdroje

| Datová sada | Vydavatel | Licence | Verze | K čemu jsme ji použili |
|---|---|---|---|---|
| [Jízdní řády CIS JŘ](https://portal.cisjr.cz/pub/) převedené do GTFS projektem [JrUtil](https://gitlab.com/dvdkon/jrutil) ([data.jr.ggu.cz](https://data.jr.ggu.cz/results/latest/)) | Ministerstvo dopravy, Správa železnic | volné užití | 8. 10. 2026, na serveru se aktualizují každou noc | všechny autobusy a vlaky kraje: vyhledávač spojů a výpočet dostupnosti |
| [NRPZS – místa poskytování zdravotních služeb](https://data.gov.cz/zdroj/datové-sady/00024341/aa4c99d9f1480cca59807389cf88d4dc) | ÚZIS ČR | CC BY 4.0 | 1. 10. 2026 | 616 ambulantních míst v kraji (praktici, zubaři, gynekologové, oční…) |
| [Volné kapacity poskytovatelů zdravotních služeb](https://www.kr-karlovarsky.cz/temata/zdravotnictvi/informace-pro-obcany/informace-o-volnych-kapacitach-poskytovatelu-zdravotnich-sluzeb-v-karlovarskem-kraji) | Krajský úřad Karlovarského kraje | neuvedena | 11. 4. 2022 | lékaři, kteří přijímají nové pacienty (19 záznamů, napárovaných na NRPZS) |
| [ČSÚ – věkové složení obyvatel obcí (OBY02E, OBY02F)](https://data.csu.gov.cz/opendata/sady/OBY02F/distribuce/csv) | Český statistický úřad | volné užití | k 31. 12. 2025 | obyvatelé a senioři 65+ v každé obci |
| [RÚIAN – adresní místa](https://vdp.cuzk.gov.cz/vdp/ruian/vymennyformat) | ČÚZK | CC BY 4.0 | k 30. 9. 2026 | 55 762 adres domů: kde lidé bydlí, hledání adresy na webu |
| [Senior Expres – dotační program](https://kr-karlovarsky.cz/dotace/senior-expres) | Krajský úřad Karlovarského kraje | neuvedena | 2022–2026 | obce s krajskou dotací na vůz |
| Senior Expres v obcích (vlastní sběr) | weby obcí, zdroj u každého údaje | fakta z veřejných webů | ověřeno 10. 10. 2026 | telefony, podmínky a ceny ve všech 134 obcích (`data/clean/senior_expres_obce.csv`) |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | přispěvatelé OpenStreetMap | ODbL | – | podkladová mapa na webu |

## Naše výstupy (`data/clean/`)

| Soubor | Obsah |
|---|---|
| `h3_dostupnost.csv`, `.geojson` (`_so`, `_ne` pro víkend) | 1 837 obydlených šestiúhelníků H3: doba mimo domov k praktikovi, zubaři, do nemocnice a na úřad |
| `dostupnost_souhrn_obci.csv`, `dostupnost_obci.csv` | dostupnost každé ze 134 obcí, hodnocení dobrá až kritická |
| `spadove_oblasti.geojson`, `spadove_oblasti_obce.csv` | spádové oblasti nemocnic podle vzdálenosti a podle spojů |
| `pohotovost_vikend.csv` | kdo se v sobotu dopoledne dostane na pohotovost a zpátky |
| `senior_expres_obce.csv` | ověřený seznam Senior Expresů ve všech obcích |
| `senior_expres_mezery.csv` | obce se špatnou dostupností bez Senior Expresu |
| `cile_kk.csv`, `lekari_kk.csv` | sjednocená tabulka cílů cest (lékaři, nemocnice, úřady, pohotovosti) |
| `balicek/` | data pro offline režim aplikace a hledání adres |

Doba mimo domov = chůze na zastávku (nejvýš 1 km), cesta tam podle jízdních řádů, 45 minut na místě a první spoj zpět. Počítáno pro úterý 13. 10. 2026 s odjezdem 6–9 h (víkend 17.–18. 10. 2026, odjezd 6–12 h).

## Co ve zdrojích chybí nebo nesedí
- Jízdní řády IDOK nejsou zveřejněné ve strojovém formátu (GTFS), jen v PDF. Používáme celostátní CIS JŘ.
- Seznam lékařů, kteří přijímají nové pacienty, je z 11. 4. 2022 a má jen 19 záznamů bez identifikátorů. Většina se od té doby změnila.
- Senior Expresy nejsou v žádné datové sadě, sbírali jsme je z webů obcí.
- Sada nemocnic nemá stálý identifikátor nemocnice (jen pořadové číslo, IČO provozovatele a kód adresy sídla firmy).
- V seznamu obcí je IČO uložené jako desetinné číslo bez úvodní nuly a obec Oloví má jako adresu úřadu „Hory 42“.
