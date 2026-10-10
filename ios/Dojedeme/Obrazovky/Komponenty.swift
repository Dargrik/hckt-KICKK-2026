//  Komponenty.swift – sdílené prvky obrazovek podle design/BRAND.md (kap. 3 a 4).

import SwiftUI

extension Color {
    static let ink2 = Color("Ink2")
    static let ink3 = Color("Ink3")
}

/// Řádek s volbou „kam“: ikona, název a jedna věta.
struct VolbaRadek: View {
    let nazev: String
    let ikona: String
    let popis: String
    @ScaledMetric(relativeTo: .title2) private var velikostIkony: CGFloat = 30

    var body: some View {
        HStack(spacing: 16) {
            Image(systemName: ikona)
                .font(.title2)
                .foregroundStyle(Color.accentColor)
                .frame(width: velikostIkony)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(nazev).font(.headline)
                Text(popis).font(.callout).foregroundStyle(Color.ink2)
            }
        }
        .padding(.vertical, 6)
        .frame(minHeight: 44)
    }
}

/// Odznak „Přijímá nové pacienty“ (SuccessFg na SuccessBg).
struct PrijimaOdznak: View {
    var body: some View {
        Label("Přijímá nové pacienty", systemImage: "checkmark.circle")
            .font(.callout.weight(.semibold))
            .foregroundStyle(Color("SuccessFg"))
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(Color("SuccessBg"), in: RoundedRectangle(cornerRadius: 8))
    }
}

/// Řádek místa v seznamu: seřazeno podle spojení, proto nejdřív odjezd a doba cesty.
struct CilRadek: View {
    let cil: Cil

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let role = cil.role {
                Text(role).font(.callout.weight(.semibold)).foregroundStyle(Color.accentColor)
            }
            Text(cil.nazev).font(.headline)
            if let misto = cil.adresa ?? cil.obec {
                Text(misto).font(.callout).foregroundStyle(Color.ink2)
            }
            if let odjezd = cil.odjezd, let minut = cil.cesta_min, cil.dostupne != false {
                Text("Odjezd \(odjezd)" + (cil.prijezd.map { ", na místě \($0)" } ?? ""))
                    .font(.headline)
                    .monospacedDigit()
                Text("\(Format.doba(minut)), \(Format.prestupy(cil.prestupy ?? 0))")
                    .font(.callout)
                    .foregroundStyle(Color.ink2)
            } else if cil.dostupne == false {
                Text("V tento den sem spoj nejede.").font(.callout).foregroundStyle(Color.ink2)
            }
            if cil.nabira == true { PrijimaOdznak() }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

/// Karta spoje: odjezd největší, pak příjezd, doba, druh dopravy, přestupy a chůze.
struct SpojRadek: View {
    let spoj: Spoj

    private var druh: (nazev: String, ikona: String) { Format.druh(spoj.jizdy.first?.typ ?? "pesky") }
    private var podrobnosti: String {
        var casti = [Format.doba(spoj.minut), Format.prestupy(spoj.prestupy)]
        if spoj.peskyMinut > 0 { casti.append("\(Format.doba(spoj.peskyMinut)) pěšky") }
        return casti.joined(separator: ", ")
    }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline, spacing: 16) {
                Text(spoj.odjezd).font(.largeTitle.bold()).monospacedDigit()
                obsah
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(spoj.odjezd).font(.largeTitle.bold()).monospacedDigit()
                obsah
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(popisProCtecku)
    }

    private var obsah: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("příjezd \(spoj.prijezd)").font(.headline).monospacedDigit()
            Label(druh.nazev, systemImage: druh.ikona).font(.callout)
            Text(podrobnosti).font(.callout).foregroundStyle(Color.ink2)
            if let z = spoj.nastupniZastavka {
                Text("ze zastávky \(z)").font(.callout).foregroundStyle(Color.ink2)
            }
        }
    }

    private var popisProCtecku: String {
        var t = "Odjezd \(spoj.odjezd)"
        if let z = spoj.nastupniZastavka { t += " ze zastávky \(z)" }
        return t + ", příjezd \(spoj.prijezd), \(podrobnosti), \(druh.nazev)"
    }
}

/// Barevný pruh s ikonou: info (poslední spoj zpět), chyba (nevrátíte se), varování.
struct Pruh: View {
    enum Druh { case info, chyba, varovani, uspech }
    let druh: Druh
    let ikona: String
    let text: String

    private var barvy: (Color, Color) {
        switch druh {
        case .info: return (Color("InfoFg"), Color("InfoBg"))
        case .chyba: return (Color("ErrorFg"), Color("ErrorBg"))
        case .varovani: return (Color("WarningFg"), Color("WarningBg"))
        case .uspech: return (Color("SuccessFg"), Color("SuccessBg"))
        }
    }

    var body: some View {
        Label {
            Text(text).font(.headline)
        } icon: {
            Image(systemName: ikona)
        }
        .foregroundStyle(barvy.0)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(barvy.1, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .listRowInsets(EdgeInsets())              // v seznamu bez „krabice v krabici“
        .listRowBackground(Color.clear)
    }
}

/// Senior Expres: název, podmínky a velké tlačítko Zavolat s číslem jako textem.
struct SeniorExpresKarta: View {
    let sluzba: SeniorExpres

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(sluzba.nazev + (sluzba.obec.map { " \($0)" } ?? ""), systemImage: "car.side")
                .font(.title3.weight(.semibold))
            if let p = sluzba.provoz { Text("Jezdí: \(p)").font(.callout) }
            if let c = sluzba.cena { Text("Cena: \(c)").font(.callout) }
            if let p = sluzba.podminky { Text(p).font(.callout).foregroundStyle(Color.ink2) }
            if let t = sluzba.telefon, let url = Format.telURL(t) {
                Link(destination: url) {
                    Label("Zavolat \(Format.telefon(t))", systemImage: "phone.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .tint(Color("Signal"))
                .foregroundStyle(Color("OnSignal"))
            }
        }
        .padding(.vertical, 6)
    }
}

/// Načítání uvnitř seznamu.
struct Nacitani: View {
    var text = "Hledáme spoje…"
    var body: some View {
        HStack(spacing: 12) {
            ProgressView()
            Text(text).foregroundStyle(Color.ink2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 8)
    }
}

// MARK: - Karty hlavní obrazovky

/// Nadpis části obrazovky (pro VoiceOver nadpis).
struct NadpisSekce: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.title2.weight(.bold))
            .accessibilityAddTraits(.isHeader)
    }
}

/// Bílá karta se zaoblenými rohy na šedém pozadí (systemGroupedBackground).
struct Karta<Obsah: View>: View {
    let obsah: Obsah

    init(@ViewBuilder _ obsah: () -> Obsah) {
        self.obsah = obsah()
    }

    var body: some View {
        obsah
            .padding(.horizontal, 16)
            .padding(.vertical, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

/// Řádek karty Odkud / Kdy: ikona, popisek, hodnota a šipka.
struct RadekVolby: View {
    let ikona: String
    let nadpis: String
    let hodnota: String

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: ikona)
                .font(.title3)
                .foregroundStyle(Color.accentColor)
                .frame(width: 30)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(nadpis).font(.callout).foregroundStyle(Color.ink2)
                Text(hodnota).font(.headline).foregroundStyle(.primary)
            }
            Spacer(minLength: 8)
            Image(systemName: "chevron.right")
                .font(.callout.weight(.semibold))
                .foregroundStyle(Color.ink3)
                .accessibilityHidden(true)
        }
        .padding(.vertical, 12)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityHint("Klepnutím změníte")
    }
}

/// Velká volba „Kam pojedete?“ v mřížce.
struct VelkaVolba: View {
    let nazev: String
    let popis: String
    let ikona: String
    @ScaledMetric(relativeTo: .title) private var velikostIkony: CGFloat = 30

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: ikona)
                .font(.system(size: velikostIkony, weight: .semibold))
                .foregroundStyle(Color.accentColor)
                .accessibilityHidden(true)
                .padding(.bottom, 8)
            Text(nazev).font(.headline).foregroundStyle(.primary)
            Text(popis).font(.callout).foregroundStyle(Color.ink2)
        }
        .frame(maxWidth: .infinity, minHeight: 120, alignment: .topLeading)
        .padding(16)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// Uložené místo na hlavní obrazovce.
struct MojeMistoKarta: View {
    let misto: MojeMisto

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: "star.fill")
                .foregroundStyle(Color.accentColor)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(misto.nazev).font(.headline).foregroundStyle(.primary)
                if let o = misto.obec { Text(o).font(.callout).foregroundStyle(Color.ink2) }
            }
            Spacer(minLength: 8)
            Image(systemName: "chevron.right")
                .font(.callout.weight(.semibold))
                .foregroundStyle(Color.ink3)
                .accessibilityHidden(true)
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
