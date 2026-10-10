# Dojedeme – K lékaři a zase domů

Dojedeme pomáhá seniorům a lidem bez auta v Karlovarském kraji dostat se **veřejnou dopravou k lékaři, do nemocnice, na pohotovost a na úřad, a zase domů**. Dostupnost neměříme v kilometrech, ale v čase, který člověk stráví mimo domov: cesta tam, čas u lékaře a první spoj zpátky. Senior bez chytrého telefonu dostane spoj **obyčejnou SMS** (pošle `*11`), rodina mu službu nastaví na webu. Kraji a obcím dáváme mapy a data o tom, kde dostupnost chybí.

**Vyzkoušejte:** https://dojedeme.cz

## Co projekt umí
| Část | Kde na webu | Co dělá |
|---|---|---|
| Najít spoj | [/aplikace](https://dojedeme.cz/aplikace) | spoj tam i poslední spoj zpátky, lékaře a nemocnice řadí podle spojení, ne podle km; Senior Expres v obci |
| SMS služba | [/pro-blizke](https://dojedeme.cz/pro-blizke) | `*11` = spoj na předvolbu 11, `*11 zitra`, `*0` = jedu domů, `*SEZNAM`, `*ZRUSIT`, `*STOP` |
| Systém pro blízké | [/system](https://dojedeme.cz/system) | účet blízkého, senioři, potvrzení čísla kódem ze seniorova telefonu, předvolby, poslání spoje SMS, termíny u lékaře (SMS den předem), kartička k telefonu |
| Letáky pro obce | [/pro-obce](https://dojedeme.cz/pro-obce) | PDF na nástěnku pro každou ze 134 obcí: lékaři v dosahu, kteří přijímají, spoje, Senior Expres, QR kód |
| Data a mapy | [/mapa](https://dojedeme.cz/mapa) | hexagonová mapa dostupnosti (pracovní den, sobota, neděle), obce blízko a přesto daleko, spádové oblasti nemocnic podle vzdálenosti a podle spojů, úřady, Senior Expres, pohotovost v sobotu, data ke stažení |
| iOS aplikace | `ios/` | Najít spoj, jednoduchý režim pro seniory, systém pro blízké (SwiftUI, iOS 17) |

## Hlavní zjištění
- **Každý devátý senior v kraji (7 261 lidí)** je kvůli lékaři přes 3 hodiny mimo domov, nebo se k lékaři veřejnou dopravou nedostane. V neděli je to 14 599 seniorů.
- **Kilometry klamou:** 18 obcí má praktického lékaře do 10 km vzdušnou čarou, a přesto návštěva zabere 3 hodiny a víc (Krásný Les: 4,7 km, 4 h 55 min).
- **Nemocnice:** 26 obcí má nejblíž jinou nemocnici, než do které se dostanou nejrychleji. Z Božího Daru je nemocnice v Karlových Varech o 8,5 km dál než ostrovská, a přesto jste z ní doma o 55 minut dřív.
- **Pohotovost v sobotu:** 9 100 seniorů (každý sedmý) se v sobotu dopoledne nedostane na pohotovost a zpátky. Z 21 obcí tam nejede nic.
- **Senior Expres** jezdí ve 47 obcích. Z 23 obcí s nejhorší dostupností ho 19 nemá (1 497 seniorů).
- Seznam lékařů, kteří přijímají nové pacienty, má kraj jen z 11. 4. 2022 (19 záznamů).

## Co je v repozitáři
| Část | Kde | Co obsahuje |
|---|---|---|
| Server a API | `backend/` | vyhledávač spojů (vlastní Connection Scan Algorithm nad jízdními řády kraje), API pro web a aplikaci, SMS služba s vyměnitelnou bránou, letáky PDF, účty blízkých |
| Web | `web/` | Najít spoj, SMS pro blízké, systém pro blízké, letáky pro obce, data a mapy (HTML, CSS, JavaScript, mapy Leaflet) |
| iOS aplikace | `ios/` | SwiftUI, iOS 17, projekt z XcodeGen (`ios/project.yml`) |
| Data | `data/clean/` | finální data a výsledky analýzy (CSV, GeoJSON), jízdní řády kraje a offline balíček; popis v [`DATA.md`](DATA.md) |
| Brand | `design/` | brand manual, barvy a typografie (tokeny), logo, ikona aplikace, písma |
| Prezentace | [`Dojedeme-prezentace.pdf`](Dojedeme-prezentace.pdf) | prezentace z hackathonu |

## Použitá data
Otevřená data Karlovarského kraje z [Katalogu otevřených dat DATA ZÁPAD](https://www.datazapad.cz/search?collection=dataset&layout=grid):
- [Autobusové zastávky v Karlovarském kraji](https://www.datazapad.cz/datasets/979283f4b7ec4b778b8eed7aab6917c3_0) – CC BY 4.0 (upraveno)
- [Nemocnice v Karlovarském kraji](https://www.datazapad.cz/datasets/03dbe5719ab64960ae70ee90af4790c6_3) – CC BY 4.0 (upraveno)
- [Lékařská a lékárenská pohotovostní služba v Karlovarském kraji](https://www.datazapad.cz/datasets/72aa9de6abc94f949f3959e70e0d241d_0) – CC0 1.0 (upraveno)
- [Seznam obcí Karlovarského kraje](https://www.datazapad.cz/datasets/Kakraj::seznam-obcí-karlovarského-kraje) – CC0 1.0 (upraveno)
- [Obce s rozšířenou působností Karlovarského kraje](https://www.datazapad.cz/datasets/Kakraj::obce-s-rozšířenou-působností-karlovarského-kraje) – CC0 1.0 (upraveno)
- [Matriční úřady Karlovarského kraje](https://www.datazapad.cz/datasets/Kakraj::matriční-úřady-karlovarského-kraje-) – CC0 1.0 (upraveno)
- [Poskytovatelé sociálních služeb v Karlovarském kraji](https://www.datazapad.cz/datasets/8a71d71444f14acd8d43023ce9c3fb95_0) – CC0 1.0 (upraveno)
- [Poskytovatelé pobytových sociálních služeb pro seniory v Karlovarském kraji](https://www.datazapad.cz/datasets/0fc741fffbb44c31820304ec60cc2ff0_3) – CC0 1.0 (upraveno)

Další veřejné zdroje:
- [Volné kapacity poskytovatelů zdravotních služeb v Karlovarském kraji (11. 4. 2022)](https://www.kr-karlovarsky.cz/temata/zdravotnictvi/informace-pro-obcany/informace-o-volnych-kapacitach-poskytovatelu-zdravotnich-sluzeb-v-karlovarskem-kraji) – Krajský úřad Karlovarského kraje, licence neuvedena (upraveno)
- [Senior Expres – dotační program kraje](https://kr-karlovarsky.cz/dotace/senior-expres) – Krajský úřad Karlovarského kraje, licence neuvedena; telefony a podmínky jsme ověřili na webech všech 134 obcí (`data/clean/senior_expres_obce.csv`, u každé obce zdroj)
- [NRPZS – místa poskytování zdravotních služeb](https://data.gov.cz/zdroj/datové-sady/00024341/aa4c99d9f1480cca59807389cf88d4dc) – ÚZIS ČR, CC BY 4.0 (upraveno)
- [Jízdní řády CIS JŘ](https://portal.cisjr.cz/pub/) – Ministerstvo dopravy, volné užití (upraveno); převod do GTFS projektem [JrUtil](https://gitlab.com/dvdkon/jrutil) (data.jr.ggu.cz)
- [ČSÚ – věkové složení obyvatel obcí (OBY02E, OBY02F)](https://data.csu.gov.cz/opendata/sady/OBY02F/distribuce/csv) – Český statistický úřad, volné užití (upraveno)
- [RÚIAN – adresní místa](https://vdp.cuzk.gov.cz/vdp/ruian/vymennyformat) – ČÚZK, CC BY 4.0 (upraveno)
- Podkladová mapa na webu: © přispěvatelé OpenStreetMap (ODbL)

Popis všech datových sad, odkazy, licence a naše výstupy jsou v [`DATA.md`](DATA.md).

## Výstupy pro kraj a obce
Ke stažení na [dojedeme.cz/mapa](https://dojedeme.cz/mapa) i v `data/clean/`:
- dostupnost po šestiúhelnících H3 (`h3_dostupnost.csv`, `.geojson`), po obcích (`dostupnost_souhrn_obci.csv`),
- spádové oblasti nemocnic podle vzdálenosti a podle spojů (`spadove_oblasti.geojson`),
- kde chybí Senior Expres (`senior_expres_mezery.csv`) a ověřený seznam Senior Expresů ve všech obcích (`senior_expres_obce.csv`),
- pohotovost v sobotu (`pohotovost_vikend.csv`),
- letáky pro všech 134 obcí (`/letaky/vsechny.zip` na webu).

## Použití AI
- **Claude (Anthropic) v nástroji Claude Code** jsme použili jako programátorského a analytického asistenta:
  - skripty pro zpracování dat a výpočet dostupnosti (Connection Scan Algorithm),
  - backend a frontend systému
- **Claude Design** vizuální identitu a brand manual.
- **Rozhodnutí dělal tým:** nápad a koncept, co a jak počítat (doba mimo domov místo vzdálenosti, pohotovost v sobotu), výběr a kontrola dat, testování (živý test SMS, aplikace na iPhonu), prezentace, analýza a rešerše.

Výsledky analýzy jsme kontrolovali proti zdrojovým datům.

## Spuštění
Potřebujete Python 3.12+. Data jsou v repozitáři hotová, nic se nemusí stahovat ani přepočítávat.

1. Python prostředí a závislosti:
```bash
python -m venv .venv
```
```bash
.venv/bin/pip install -r backend/requirements.txt
```
2. Server s API a webem na http://localhost:8000 (první start načte jízdní řády, trvá asi minutu):
```bash
.venv/bin/python -m uvicorn main:app --app-dir backend --port 8000
```
3. **(volitelné)** SMS brána a tokeny se nastavují v `.env`, vzor je v `.env.example`. Bez nich funguje web i API, jen se neposílají SMS. Klíče a hesla do repozitáře nepatří.
4. **iOS aplikace:** na Macu s Xcode vygenerujte projekt nástrojem [XcodeGen](https://github.com/yonaskolb/XcodeGen) a otevřete ho:
```bash
cd ios && xcodegen generate && open Dojedeme.xcodeproj
```
Aplikace volá API na https://dojedeme.cz.

## Tým
- Tobiáš Horváth
- Vojtěch Aloy

## Licence
Kód je pod licencí MIT (viz [`LICENSE`](LICENSE)), ostatní obsah (texty, data, výstupy analýzy) pod CC BY 4.0. Písma Source Sans 3 a Atkinson Hyperlegible jsou pod licencí SIL Open Font License (`design/fonts/`).

---
Projekt je prototyp vytvořený na Hackathonu otevřených dat Karlovarského kraje 2026 (9.–10. 10. 2026, Cheb). Nejde o oficiální službu Karlovarského kraje. Údaje o lékařích, kteří přijímají nové pacienty, pocházejí ze seznamu kraje z 11. 4. 2022, a proto je před návštěvou ověřte telefonem.
