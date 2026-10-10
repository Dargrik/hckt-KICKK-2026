# BRAND.md – Dojedeme

> Pravidla pro aplikaci (SwiftUI) a web (HTML/CSS) jsou závazná. Když si nejste jistí, zvolte větší písmo, větší cíl a víc textu u ikony.

## 1. Značka v 5 větách

1. Název je **Dojedeme** (vždy takto, s velkým D; v SMS a doméně `dojedeme`, odesílatel SMS `DOJEDEME`), claim „K lékaři a zase domů.“
2. Slouží seniorům a lidem bez auta v Karlovarském kraji, kteří hledají spoj veřejné dopravy k lékaři, do nemocnice nebo na úřad – tam i zpátky.
3. Druhou skupinou je rodina a pečovatelé, kteří seniorovi vše nastaví; třetí jsou obce a kraj, které potřebují mapu dostupnosti a leták na nástěnku.
4. Osobnost: spolehlivá, klidná, vlídná, místní a věcná – vyká, mluví krátce a vždy uvádí zdroj a datum údaje.
5. Vizuál stojí na tmavé zeleni Smrk, jantarové tečce domova a písmu navrženém pro slabozraké; žádná lázeňská klišé ani nemocniční sterilita.

## 2. Design tokeny

Zdroj pravdy. Barvy mají světlou a tmavou hodnotu; `contrastPairs` jsou spočítané poměry WCAG (cíl 7:1 pro text, 3:1 pro ikony a obrysy).

```json
{
  "color": {
    "bg": {"light": "#FFFFFF", "dark": "#0E1513"},
    "bg-subtle": {"light": "#F4F7F5", "dark": "#17201D"},
    "bg-sunken": {"light": "#E9EEEB", "dark": "#222C28"},
    "ink": {"light": "#111A17", "dark": "#EEF3F1"},
    "ink-2": {"light": "#3E4A45", "dark": "#C2CDC8"},
    "ink-3": {"light": "#4C5853", "dark": "#A3AFAA"},
    "border": {"light": "#C9D2CE", "dark": "#3A4642"},
    "border-strong": {"light": "#66726D", "dark": "#8C9893"},
    "primary": {"light": "#14574A", "dark": "#86D6C1"},
    "primary-press": {"light": "#0D4238", "dark": "#A6E3D3"},
    "primary-tint": {"light": "#E3F1EC", "dark": "#14302A"},
    "on-primary": {"light": "#FFFFFF", "dark": "#04241D"},
    "signal": {"light": "#F2B53A", "dark": "#F5C35E"},
    "on-signal": {"light": "#111A17", "dark": "#1A1200"},
    "signal-tint": {"light": "#FDF2D8", "dark": "#2C2209"},
    "success": {"light": "#175628", "dark": "#93D8A0"},
    "success-bg": {"light": "#E6F3E8", "dark": "#132719"},
    "warning": {"light": "#5E3B00", "dark": "#F7CB72"},
    "warning-icon": {"light": "#7A4D00", "dark": "#F7CB72"},
    "warning-bg": {"light": "#FDF0D2", "dark": "#2B2108"},
    "error": {"light": "#8C1616", "dark": "#FFA39B"},
    "error-bg": {"light": "#FBE8E6", "dark": "#301614"},
    "info": {"light": "#174A86", "dark": "#A5C8F3"},
    "info-bg": {"light": "#E6EEF8", "dark": "#121F30"},
    "focus": {"light": "#174A86", "dark": "#A5C8F3"},
    "map-1": {"light": "#FBE7A1", "dark": "#FBE7A1"},
    "map-2": {"light": "#D9C56E", "dark": "#D9C56E"},
    "map-3": {"light": "#9DA577", "dark": "#9DA577"},
    "map-4": {"light": "#5E8480", "dark": "#5E8480"},
    "map-5": {"light": "#33607C", "dark": "#33607C"},
    "map-6": {"light": "#1D3557", "dark": "#1D3557"},
    "map-none": {"light": "#8A8F8D", "dark": "#8A8F8D"}
  },
  "contrastPairs": [
    {"text": "ink", "background": "bg", "min": 7, "light": 17.74, "dark": 16.49},
    {"text": "ink", "background": "bg-subtle", "min": 7, "light": 16.44, "dark": 14.85},
    {"text": "ink", "background": "bg-sunken", "min": 7, "light": 15.11, "dark": 12.84},
    {"text": "ink", "background": "primary-tint", "min": 7, "light": 15.25, "dark": 12.6},
    {"text": "ink", "background": "signal-tint", "min": 7, "light": 15.94, "dark": 13.98},
    {"text": "ink-2", "background": "bg", "min": 7, "light": 9.25, "dark": 11.33},
    {"text": "ink-2", "background": "bg-subtle", "min": 7, "light": 8.58, "dark": 10.2},
    {"text": "ink-3", "background": "bg", "min": 7, "light": 7.43, "dark": 8.16},
    {"text": "primary", "background": "bg", "min": 7, "light": 8.43, "dark": 10.92},
    {"text": "primary", "background": "bg-subtle", "min": 7, "light": 7.81, "dark": 9.84},
    {"text": "primary", "background": "primary-tint", "min": 7, "light": 7.25, "dark": 8.35},
    {"text": "on-primary", "background": "primary", "min": 7, "light": 8.43, "dark": 9.73},
    {"text": "on-signal", "background": "signal", "min": 7, "light": 9.67, "dark": 11.37},
    {"text": "success", "background": "success-bg", "min": 7, "light": 7.65, "dark": 9.44},
    {"text": "success", "background": "bg", "min": 7, "light": 8.76, "dark": 11.07},
    {"text": "warning", "background": "warning-bg", "min": 7, "light": 8.84, "dark": 10.38},
    {"text": "warning-icon", "background": "warning-bg", "min": 3, "light": 6.43, "dark": 10.38},
    {"text": "error", "background": "error-bg", "min": 7, "light": 7.94, "dark": 8.77},
    {"text": "error", "background": "bg", "min": 7, "light": 9.37, "dark": 9.66},
    {"text": "info", "background": "info-bg", "min": 7, "light": 7.61, "dark": 9.61},
    {"text": "info", "background": "bg", "min": 7, "light": 8.9, "dark": 10.71},
    {"text": "border-strong", "background": "bg", "min": 3, "light": 5.01, "dark": 6.19},
    {"text": "focus", "background": "bg", "min": 3, "light": 8.9, "dark": 10.71},
    {"text": "focus", "background": "bg-subtle", "min": 3, "light": 8.25, "dark": 9.64}
  ],
  "mapLabelInk": {"map-1": "#111A17", "map-2": "#111A17", "map-3": "#111A17", "map-4": "#111A17", "map-5": "#FFFFFF", "map-6": "#FFFFFF"},
  "type": {
    "web": {
      "display": {"size": "56px", "lineHeight": "60px", "weight": 800, "family": "sans"},
      "h1": {"size": "44px", "lineHeight": "50px", "weight": 800, "family": "sans"},
      "h2": {"size": "34px", "lineHeight": "40px", "weight": 700, "family": "sans"},
      "h3": {"size": "26px", "lineHeight": "32px", "weight": 700, "family": "sans"},
      "lead": {"size": "22px", "lineHeight": "34px", "weight": 400, "family": "sans"},
      "body": {"size": "20px", "lineHeight": "32px", "weight": 400, "family": "sans"},
      "body-s": {"size": "18px", "lineHeight": "28px", "weight": 400, "family": "sans"},
      "label": {"size": "18px", "lineHeight": "24px", "weight": 700, "family": "sans"},
      "time": {"size": "32px", "lineHeight": "36px", "weight": 700, "family": "mono"},
      "sms": {"size": "22px", "lineHeight": "32px", "weight": 400, "family": "mono"}
    },
    "ios": {
      "largeTitle": {"pointSizeAtLarge": 34, "weight": "bold"},
      "title": {"pointSizeAtLarge": 28, "weight": "bold"},
      "title2": {"pointSizeAtLarge": 22, "weight": "semibold"},
      "title3": {"pointSizeAtLarge": 20, "weight": "semibold"},
      "headline": {"pointSizeAtLarge": 17, "weight": "semibold"},
      "body": {"pointSizeAtLarge": 17, "weight": "regular"},
      "callout": {"pointSizeAtLarge": 16, "weight": "regular"},
      "subheadline": {"pointSizeAtLarge": 15, "weight": "regular"},
      "footnote": {"pointSizeAtLarge": 13, "weight": "regular"}
    },
    "iosSimpleModeMinimum": "xxLarge (body 21 pt)",
    "fontWeb": {"sans": "Atkinson Hyperlegible Next", "mono": "Atkinson Hyperlegible Mono"}
  },
  "space": {"space-1": "4px", "space-2": "8px", "space-3": "12px", "space-4": "16px", "space-5": "24px", "space-6": "32px", "space-7": "48px", "space-8": "64px", "space-9": "96px"},
  "radius": {"radius-s": "8px", "radius-m": "14px", "radius-l": "22px", "radius-xl": "32px", "radius-pill": "999px"},
  "shadow": {"shadow-1": {"light": "0 1px 2px rgba(17,26,23,0.08), 0 2px 8px rgba(17,26,23,0.06)", "dark": "none"}, "shadow-2": {"light": "0 8px 32px rgba(17,26,23,0.14)", "dark": "0 8px 32px rgba(0,0,0,0.5)"}},
  "materials": {"iosBars": "Liquid Glass (systémový, nepřebarvovat)", "iosSheets": "Liquid Glass, detents [.medium, .large]", "reduceTransparency": "systém sám nahradí neprůhlednou plochou; vlastní plochy -> bg-subtle"},
  "touch": {"touch-min": "44px", "touch-web": "48px", "touch-simple": "60px", "tile-simple": "132px"}
}
```

## 3. Mapování tokenů

### 3.1 SwiftUI

**Pozadí a hlavní text: systémové sémantické barvy.** Brandové barvy jen jako Color assety v `Assets.xcassets/Colors/`, každý s variantou Any / Dark a High Contrast.

| Token | SwiftUI | Poznámka |
|---|---|---|
| `bg` | `Color(.systemBackground)` / `.systemGroupedBackground` v seznamech | systémové |
| `bg-subtle` | `Color(.secondarySystemGroupedBackground)` | buňky seznamu |
| `ink` | `Color(.label)` / `.primary` | systémové |
| `ink-2` | `Color("Ink2")` | **Nepoužívejte `.secondary` ani `secondaryLabel` pro text** – mají jen ~3,5:1. |
| `ink-3` | `Color("Ink3")` | jen zdroje dat na `bg` |
| `primary` | `Color.accentColor` = asset `AccentColor` (#14574A / #86D6C1; HC #0D4238 / #A6E3D3) | `.tint(.accentColor)` na kořeni |
| `primary-tint` | `Color("PrimaryTint")` | karta „Další spoj“, dlaždice |
| `signal` / `on-signal` | `Color("Signal")` / `Color("OnSignal")` | jen tlačítko Senior Expres a Pomoc |
| `success`, `success-bg` | `Color("SuccessFg")`, `Color("SuccessBg")` | odznak „Přijímá“ |
| `warning`, `warning-icon`, `warning-bg` | `Color("WarningFg")`, `Color("WarningIcon")`, `Color("WarningBg")` | stáří dat |
| `error`, `error-bg` | `Color("ErrorFg")`, `Color("ErrorBg")` | nevrátíte se |
| `info`, `info-bg` | `Color("InfoFg")`, `Color("InfoBg")` | poslední spoj zpět |
| `map-1`…`map-6`, `map-none` | `Color("Map1")`…`Color("Map6")`, `Color("MapNone")` | stejné v obou režimech |

**Písmo:** jen `Font.TextStyle`, nikdy `.system(size:)` bez `relativeTo:`.

| Prvek | Styl |
|---|---|
| Název obrazovky | `.navigationTitle` + `.navigationBarTitleDisplayMode(.large)` |
| Čas odjezdu v řádku | `.font(.largeTitle.bold()).monospacedDigit()` |
| Čas v kartě „Další spoj“ | `.font(.title.bold()).monospacedDigit()` |
| Nadpis karty / dlaždice | `.title3.weight(.semibold)` / `.title2.weight(.semibold)` |
| Jméno lékaře, zastávka | `.headline` |
| Běžný text | `.body` |
| Doba cesty, přestupy | `.callout` + `Color("Ink2")` |
| Zdroj dat | `.footnote` + `Color("Ink3")` – nikdy nic důležitého |

**Jednoduchý režim = písmo o 2 stupně větší:**

```swift
@Environment(\.dynamicTypeSize) private var systemSize
var body: some View {
    SimpleHomeView()
        .dynamicTypeSize(systemSize < .xxLarge ? .xxLarge : systemSize)
}
```

**SF Symbols:**

| Kategorie | SF Symbol | Phosphor (web, Bold) |
|---|---|---|
| Praktický lékař | `stethoscope` | `stethoscope` |
| Zubař | `mouth` | `tooth` |
| Nemocnice | `cross.case` | `hospital` |
| Pohotovost | `staroflife` | `first-aid` |
| Úřad | `building.columns` | `bank` |
| Jiný cíl | `magnifyingglass` | `magnifying-glass` |
| Autobus | `bus` | `bus` |
| Vlak | `train.side.front.car` | `train` |
| Pěšky | `figure.walk` | `person-simple-walk` |
| Přestup | `arrow.triangle.swap` | `arrows-left-right` |
| Senior Expres | `car.side` | `taxi` |
| Zavolat | `phone.fill` | `phone` |
| Upozornění | `exclamationmark.triangle` | `warning` |
| Stáří dat | `calendar.badge.exclamationmark` | `calendar-x` |
| Pomoc | `questionmark.circle` | `question` |
| Domů / Lékaři / Mapa / Nastavení (taby) | `house` / `stethoscope` / `map` / `gearshape` | – |

Velikost symbolů: v řádcích `.imageScale(.large)`, v dlaždicích `@ScaledMetric(relativeTo: .title) var tileIcon = 44`.

**Dotykové cíle:** `@ScaledMetric var minTarget: CGFloat = 44` (standard), `60` v jednoduchém režimu; `.frame(minHeight: minTarget)` + `.contentShape(Rectangle())`.

### 3.2 CSS

Proměnné `--color-*`, `--space-*`, `--radius-*`, `--text-*`. Komponenty nikdy nepoužívají hex přímo.

```css
/* Dojedeme – CSS proměnné (generováno z tokens.py) */
:root {
  color-scheme: light;
  --color-bg: #FFFFFF;
  --color-bg-subtle: #F4F7F5;
  --color-bg-sunken: #E9EEEB;
  --color-ink: #111A17;
  --color-ink-2: #3E4A45;
  --color-ink-3: #4C5853;
  --color-border: #C9D2CE;
  --color-border-strong: #66726D;
  --color-primary: #14574A;
  --color-primary-press: #0D4238;
  --color-primary-tint: #E3F1EC;
  --color-on-primary: #FFFFFF;
  --color-signal: #F2B53A;
  --color-on-signal: #111A17;
  --color-signal-tint: #FDF2D8;
  --color-success: #175628;
  --color-success-bg: #E6F3E8;
  --color-warning: #5E3B00;
  --color-warning-icon: #7A4D00;
  --color-warning-bg: #FDF0D2;
  --color-error: #8C1616;
  --color-error-bg: #FBE8E6;
  --color-info: #174A86;
  --color-info-bg: #E6EEF8;
  --color-focus: #174A86;
  --color-map-1: #FBE7A1;
  --color-map-2: #D9C56E;
  --color-map-3: #9DA577;
  --color-map-4: #5E8480;
  --color-map-5: #33607C;
  --color-map-6: #1D3557;
  --color-map-none: #8A8F8D;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --space-8: 64px;
  --space-9: 96px;
  --radius-s: 8px;
  --radius-m: 14px;
  --radius-l: 22px;
  --radius-xl: 32px;
  --radius-pill: 999px;
  --touch-min: 44px;
  --touch-web: 48px;
  --touch-simple: 60px;
  --tile-simple: 132px;
  --shadow-1: 0 1px 2px rgba(17,26,23,0.08), 0 2px 8px rgba(17,26,23,0.06);
  --shadow-2: 0 8px 32px rgba(17,26,23,0.14);
  --font-sans: "Atkinson Hyperlegible Next", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: "Atkinson Hyperlegible Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --text-display: 800 56px/60px var(--font-sans);
  --text-h1: 800 44px/50px var(--font-sans);
  --text-h2: 700 34px/40px var(--font-sans);
  --text-h3: 700 26px/32px var(--font-sans);
  --text-lead: 400 22px/34px var(--font-sans);
  --text-body: 400 20px/32px var(--font-sans);
  --text-body-s: 400 18px/28px var(--font-sans);
  --text-label: 700 18px/24px var(--font-sans);
  --text-time: 700 32px/36px var(--font-mono);
  --text-sms: 400 22px/32px var(--font-mono);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --color-bg: #0E1513;
    --color-bg-subtle: #17201D;
    --color-bg-sunken: #222C28;
    --color-ink: #EEF3F1;
    --color-ink-2: #C2CDC8;
    --color-ink-3: #A3AFAA;
    --color-border: #3A4642;
    --color-border-strong: #8C9893;
    --color-primary: #86D6C1;
    --color-primary-press: #A6E3D3;
    --color-primary-tint: #14302A;
    --color-on-primary: #04241D;
    --color-signal: #F5C35E;
    --color-on-signal: #1A1200;
    --color-signal-tint: #2C2209;
    --color-success: #93D8A0;
    --color-success-bg: #132719;
    --color-warning: #F7CB72;
    --color-warning-icon: #F7CB72;
    --color-warning-bg: #2B2108;
    --color-error: #FFA39B;
    --color-error-bg: #301614;
    --color-info: #A5C8F3;
    --color-info-bg: #121F30;
    --color-focus: #A5C8F3;
    --shadow-1: none;
    --shadow-2: 0 8px 32px rgba(0,0,0,0.5);
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --color-bg: #0E1513;
  --color-bg-subtle: #17201D;
  --color-bg-sunken: #222C28;
  --color-ink: #EEF3F1;
  --color-ink-2: #C2CDC8;
  --color-ink-3: #A3AFAA;
  --color-border: #3A4642;
  --color-border-strong: #8C9893;
  --color-primary: #86D6C1;
  --color-primary-press: #A6E3D3;
  --color-primary-tint: #14302A;
  --color-on-primary: #04241D;
  --color-signal: #F5C35E;
  --color-on-signal: #1A1200;
  --color-signal-tint: #2C2209;
  --color-success: #93D8A0;
  --color-success-bg: #132719;
  --color-warning: #F7CB72;
  --color-warning-icon: #F7CB72;
  --color-warning-bg: #2B2108;
  --color-error: #FFA39B;
  --color-error-bg: #301614;
  --color-info: #A5C8F3;
  --color-info-bg: #121F30;
  --color-focus: #A5C8F3;
  --shadow-1: none;
  --shadow-2: 0 8px 32px rgba(0,0,0,0.5);
  color-scheme: dark;
}
@media (max-width: 720px) {
  :root {
    --text-display: 800 40px/44px var(--font-sans);
    --text-h1: 800 34px/40px var(--font-sans);
    --text-h2: 700 28px/34px var(--font-sans);
  }
}
```

## 4. Pravidla komponent

**Tlačítko**
- Jedno hlavní na obrazovku: iOS `.buttonStyle(.borderedProminent).controlSize(.large)`, web `background: var(--color-primary); color: var(--color-on-primary)`.
- Vedlejší: iOS `.bordered`, web obrys 2 px `--color-border-strong`, text `--color-primary`.
- Senior Expres / Pomoc: `signal` + `on-signal`, vždy ikona telefonu + text + číslo jako text vedle (`736 647 582`).
- Text je sloveso a cíl: „Najít spoj“, „Zavolat“, „Připomenout odjezd“. Nikdy „OK“, „Odeslat“, „Klikněte zde“.
- Min. výška: iOS 44 pt / 60 pt jednoduchý režim, web 48 px; fokus 3 px `--color-focus` + odsazení 2 px.

**Karta spoje (řádek)**
- Pořadí: odjezd (největší, tabulková čísla) → příjezd a doba cesty → ikona bus/vlak + slovo → přestupy slovy → minuty pěšky.
- Při AX velikostech `ViewThatFits { HStack… ; VStack… }`: údaje pod sebe, nic se neořezává (`.lineLimit(nil)`, žádné `.minimumScaleFactor`).
- VoiceOver: `.accessibilityElement(children: .combine)` a label „Odjezd 7:42 z Abertamy náměstí, příjezd 8:15, 33 minut, bez přestupu“.
- Celá karta otevírá Detail spoje posunem (`NavigationLink`).

**Odznak „Přijímá nové pacienty“**
- `Label("Přijímá nové pacienty", systemImage: "checkmark.circle")`, `SuccessFg` na `SuccessBg`, rádius 8.
- Nikdy samostatně: v seznamu i detailu vždy s upozorněním na stáří dat.
- „Nepřijímá“ je neutrální (`Ink2` na `bg-sunken`), ne červený.

**Upozornění na stáří dat**
- Text přesně: „Údaj ze seznamu Karlovarského kraje z 11. 4. 2022 – před návštěvou zavolejte.“
- Ikona `calendar.badge.exclamationmark` + text, `WarningFg` na `WarningBg`. Nelze zavřít. První řádek seznamu lékařů, v detailu lékaře pod jménem, na letáku a webu u každého seznamu lékařů.

**Poslední spoj zpět**
- Na obrazovce Spojení vždy nad seznamem: „Poslední spoj zpět dnes ve 14:35“ (`InfoFg` / `InfoBg`).
- Když se dnes nevrátí: `ErrorFg` / `ErrorBg`, ikona trojúhelníku, „Dnes se už zpátky nedostanete“ + nabídka jiného dne + karta Senior Expres.

**Prázdný stav**
- iOS `ContentUnavailableView(title, systemImage:, description:)` + 1–2 akce. Povinné: offline (`wifi.slash`), žádný spoj (`bus` + jiný den + Senior Expres), poloha nepovolena (`location.slash` + „Hledat z bydliště“ + „Otevřít Nastavení“).
- Vždy co se stalo, co to znamená, co udělat. Nikdy kód chyby.

**Mapa a legenda**
- MapKit `Map` + `MapPolygon` pro H3 hexagony (rozlišení 8), výplň `Map1`…`Map6`, obrys 1 pt `bg`; `MapNone` vždy se šrafováním (vlastní `MapPolygon` s overlay vzorem nebo tečkovaným obrysem 2 pt).
- Intervaly: do 15 / 15–30 / 30–45 / 45–60 / 60–90 / 90+ min / bez spoje. Legenda vždy viditelná pod mapou, s čísly.
- Přepínač cíle (Praktik / Zubař / Nemocnice) jako segmented `Picker`.
- Alternativa bez mapy: tlačítko „Seznam obcí“ (`List` seřazený od nejhorší dostupnosti) – pro VoiceOver i pro tisk.
- Sheet obce: `.presentationDetents([.medium, .large])`; obsahuje „vzdušnou čarou X km × hromadnou dopravou Y min a Z přestup(y)“, podíl 65+, spoje za den, Senior Expres ano/ne (ikona + slovo), tlačítko „Vytvořit leták na nástěnku“.

## 5. Texty

**Hlas a tón:** vykáme; krátké věty; nejdřív čas a místo; žádné anglicismy, technické termíny, vykřičníky, emoji, zdrobněliny; chyba = co se stalo + co udělat; u každého údaje zdroj a datum.

**Slovník**

| Používáme | Nepoužíváme |
|---|---|
| spoj | trip, connection, linka (když myslíme konkrétní jízdu) |
| odjezd, příjezd | departure, ETA |
| přestup | transfer, přesedání |
| zastávka | stop, stanice (u autobusu) |
| Senior Expres | senior taxi, seniortaxi, Senior express |
| praktický lékař | GP, obvoďák, všeobecný lékař |
| lékaři, kteří přijímají nové pacienty | volná kapacita, registrace |
| Zavolat | Vytočit, Call |
| Připomenout odjezd | Nastavit notifikaci |
| Poslat blízkému | Sdílet (v textu tlačítka) |
| bydliště | domovská lokace, home |
| jednoduchý režim | senior mód, easy mode |
| Pomoc | Support, Nápověda |

**Formáty**

| Co | Správně | Špatně |
|---|---|---|
| čas | `7:42`, „ve 14:35“ | 07:42, 7.42, 2:35 PM |
| délka | `38 min`, `1 h 15 min` | 38', 75 minut |
| cena | `25 Kč` (nezlomitelná mezera) | 25,- Kč, CZK 25 |
| telefon | `736 647 582`, `+420 736 647 582` | 736647582 (mimo SMS) |
| datum | `11. 4. 2022`, „zítra“, „v pondělí 12. 10.“ | 11.04.2022, 2022-04-11 |
| přestupy | bez přestupu / 1 přestup / 2 přestupy / 5 přestupů | 0 přestupů |
| spoje | 1 spoj / 3 spoje / 9 spojů denně | 9x denně |

**SMS**
- Jen znaky GSM-7, **bez diakritiky** (přepis: ě→e, š→s, č→c, ř→r, ž→z, ý→y, á→a, í→i, é→e, ů/ú→u, ť→t, ď→d, ň→n).
- **Max. 2 SMS** (306 znaků). Delší odpověď zkrátit: méně zpátečních časů, nikdy vynechat poslední spoj zpět.
- Pořadí: `Cil Mesto: den odj. H:MM Zastavka -> H:MM Cil. Zpet H:MM, H:MM. Senior Expres 736647582`
- Telefon bez mezer (aby šel vytočit), čas H:MM, povolené zkratky `odj.`, `nam.`, `zast.`. Žádné odkazy ani zkracovače URL.
- Instrukce pro seniora vždy: „Pošlete SMS s textem *11 na číslo +420 7xx xxx xxx. Nevytáčejte.“

## 6. Přístupnost – kontrolní seznam (tvrdá pravidla)

- [ ] Text ≥ 4,5:1 (standardní režim) a ≥ 7:1 (jednoduchý režim, web běžný text). Používat jen páry z `contrastPairs`.
- [ ] Barva nikdy nenese informaci sama: stav = ikona + text; mapa = světlost + čísla v legendě + šrafování.
- [ ] Dynamic Type až AX5 bez ořezu: žádné pevné výšky textových kontejnerů, `lineLimit(nil)`, rozvržení přechází z mřížky do seznamu.
- [ ] Dotykové cíle ≥ 44 pt, v jednoduchém režimu ≥ 60 pt; web ≥ 48 px.
- [ ] Podpora Increase Contrast (High Contrast varianty Color assetů), Bold Text (systémové písmo to umí samo – nepřepisovat váhu), Reduce Motion (žádné animace postupu, crossfade místo posunu), Reduce Transparency (vlastní skleněné plochy → `bg-subtle`).
- [ ] VoiceOver: každá ikona bez textu má `accessibilityLabel`; karta spoje je jeden prvek s celou větou; mapa má seznamovou alternativu; Live Activity hlásí „Vystupte na příští zastávce“.
- [ ] Žádné časové limity, žádné automaticky mizející hlášky s akcí.
- [ ] Gesta nejsou jediná cesta: každé swipe/long-press má i tlačítko.
- [ ] Ikony v jednoduchém režimu vždy s textem; jeden krok = jedna otázka.
- [ ] Web: WCAG 2.2 AA (text AAA), základ 20 px (min. 18 px), plná ovladatelnost klávesnicí, odkaz „Přeskočit na obsah“, viditelný fokus, `prefers-reduced-motion`, `prefers-color-scheme`, `lang="cs"`, alt texty u map a mockupů.

## 7. Dělej / Nedělej

1. **Dělej:** používej systémové komponenty (`TabView`, `NavigationStack`, `List(.insetGrouped)`, `Form`, `.sheet` s detenty). **Nedělej:** vlastní tab bar, hamburger menu, webové komponenty ve SwiftUI.
2. **Dělej:** akcent jen přes `.tint(.accentColor)`. **Nedělej:** přebarvovat Liquid Glass lišty a sheety.
3. **Dělej:** `Color("Ink2")` pro vedlejší text. **Nedělej:** `.secondary`, `.gray`, `secondaryLabel` pro text.
4. **Dělej:** u každého údaje o lékaři upozornění na rok 2022. **Nedělej:** schovat ho, zmenšit pod `.footnote` nebo dát jen barvou.
5. **Dělej:** vždy ukaž poslední spoj zpět. **Nedělej:** nabídnout spoj tam, když se týž den nedá vrátit, bez varování.
6. **Dělej:** řaď místa podle doby cesty, přestupů a počtu spojů. **Nedělej:** řadit nebo hodnotit podle kilometrů.
7. **Dělej:** čísla formátuj podle tabulky Formáty (nezlomitelné mezery). **Nedělej:** anglické formáty času a data.
8. **Dělej:** texty piš krátce, vykej, dávej sloveso na tlačítko. **Nedělej:** anglicismy (trip, stop, UX), vykřičníky, emoji.
9. **Dělej:** na webu `var(--color-…)`, `var(--space-…)`, `var(--radius-…)`. **Nedělej:** hex hodnoty v komponentách, písmo pod 18 px, kopírovat iOS komponenty do webu.
10. **Dělej:** SMS bez diakritiky do 306 znaků. **Nedělej:** odkazy, emoji nebo diakritiku v SMS – rozbijí kódování a zdvojnásobí cenu.

## 8. Assety

| Soubor | Co | Xcode | Web |
|---|---|---|---|
| `logo/dojedeme-logo-light.svg` | logo na světlém | `Assets.xcassets/Brand/Logo.imageset` (Any, Preserve Vector Data) | `/assets/logo/dojedeme-logo-light.svg` |
| `logo/dojedeme-logo-dark.svg` | logo na tmavém (podklad #0E1513 odstraňte pro průhlednost) | `Logo.imageset` (Dark) | `/assets/logo/dojedeme-logo-dark.svg` + `<picture>` s `prefers-color-scheme` |
| `logo/dojedeme-logo-mono-black.svg`, `-mono-white.svg` | jednobarevné | – | tisk, leták |
| `logo/dojedeme-mark-light.svg`, `-dark.svg`, `-mono.svg` | samotná značka | `Assets.xcassets/Brand/Mark.imageset` (Any/Dark) | `/assets/logo/` |
| `icon/AppIcon-background.svg` (+`-dark`) | vrstva pozadí 1024 | Icon Composer → `AppIcon.icon` (Group 1: Background) | – |
| `icon/AppIcon-route.svg` (+`-dark`) | vrstva trasa | `AppIcon.icon` (Layer „route“, Glass: specular on, shadow soft) | – |
| `icon/AppIcon-home.svg` (+`-dark`) | vrstva domov | `AppIcon.icon` (Layer „home“, Glass: translucency off) | – |
| `icon/AppIcon-1024.png` (+`-dark`) | plochá ikona | záloha pro starší Xcode / App Store Connect | – |
| `web/favicon.svg` | favicon se světlou/tmavou verzí | – | `/favicon.svg` |
| `web/apple-touch-icon.png` | 180 × 180 | – | `/apple-touch-icon.png` |
| `fonts/AtkinsonHyperlegibleNext-Variable.woff2`, `…Mono-Variable.woff2` | písmo webu (OFL) | – (iOS používá SF Pro) | `/assets/fonts/`, `@font-face` s `font-display: swap` |
| `tokens/tokens.css` | CSS proměnné | – | `/assets/css/tokens.css` (načíst jako první) |
| `tokens/tokens.design-system.json` | tokeny pro nástroje | zdroj pro generování Color assetů | – |
| `web/hexmap-ukazka.svg` | ukázková mapa (vymyšlená data) | – | jen pro prezentaci, ve výsledku generovat z dat |

Ilustrace: zatím žádné soubory. Pokud vzniknou, kreslit z tvarů loga (linky tras, tečky zastávek, siluety kopců), barvy `primary`, `signal`, `primary-tint`, bez postav; ukládat do `Assets.xcassets/Illustrations/` a `/assets/img/`.
