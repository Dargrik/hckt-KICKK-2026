# Dojedeme pro iPhone

SwiftUI aplikace (iOS 17 a novější, jen iPhone, bez knihoven třetích stran). Mluví se serverem https://dojedeme.cz. Design a texty: `design/BRAND.md`.

## Co aplikace umí
- **Úvod:** co aplikace dělá, volba režimu (jednoduchý / standardní) a bydliště (hledání adresy nebo poloha).
- **Najít spoj** (standardní režim): Odkud, Kdy a Kam. Kam nabízí Moje místa, Můj lékař (hledání podle jména), Nemocnici, Úřad (podle působnosti obce), Pohotovost a Nového lékaře (jen lékaři, kteří přijímají nové pacienty). Místa jsou seřazená podle spojení, ne podle kilometrů.
- **Spojení:** spoje tam a zpět, nahoře vždy poslední spoj zpět; když se v ten den nedá vrátit, varování a Senior Expres.
- **Detail spoje:** časová osa s přestupy a zastávkami, Připomenout odjezd, Poslat blízkému a Poslat SMS seniorovi.
- **Jednoduchý režim:** větší písmo, velké dlaždice (Můj lékař, Moje místa, Zubař, Nemocnice, Úřad), Zavolat Senior Expres a Pomoc.
- **Pro blízké** (stejný systém jako web `/system`): přihlášení, přehled seniorů, přidání seniora, spárování čísla kódem, kartička, úprava a smazání.
- **Nastavení:** bydliště, jednoduchý režim, Moje místa a platnost jízdních řádů.

## Přeložení na Macu
1. Nainstalujte XcodeGen: `brew install xcodegen`.
2. Ve složce `ios`: `xcodegen generate`. Vznikne `Dojedeme.xcodeproj`.
3. Otevřete `Dojedeme.xcodeproj`, v **Signing & Capabilities** vyberte svůj Team (případně změňte bundle ID).
4. Vyberte iPhone (simulátor nebo připojený telefon) a spusťte (⌘R).
