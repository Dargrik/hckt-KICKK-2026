//  KartySpojeni.swift – jednotný vzhled karet (karta, minCil, Paticka) a karty obrazovky spojení:
//  PruhZpet (poslední spoj zpátky domů), SpojKarta (jeden spoj), CilKarta (kam jedu).

import SwiftUI

// MARK: - Jednotný vzhled karet a dotykových cílů

extension View {
    /// Karta: odsazení 16, zaoblení 20, pozadí buňky seznamu na šedém pozadí obrazovky.
    func karta(_ pozadi: Color = Color(.secondarySystemGroupedBackground)) -> some View {
        padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(pozadi, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    /// Dotykový cíl: 44 pt, v jednoduchém režimu 60 pt (BRAND.md kap. 6).
    func minCil() -> some View { modifier(MinCil()) }
}

struct MinCil: ViewModifier {
    @Environment(Stav.self) private var stav
    @ScaledMetric private var zaklad: CGFloat = 44

    func body(content: Content) -> some View {
        content
            .frame(minHeight: stav.jednoduchy ? max(60, zaklad) : zaklad)
            .contentShape(Rectangle())
    }
}

/// Patička a popisek v seznamu čitelně (Ink2 a callout místo šedého footnote).
struct Paticka: View {
    let text: String
    var body: some View { Text(text).font(.callout).foregroundStyle(Color.ink2) }
}

// MARK: - Poslední spoj zpět

/// Hlavní sdělení obrazovky spojení: kdy jede poslední spoj zpátky domů (nebo že to v ten den nejde).
struct PruhZpet: View {
    let spojeni: Spojeni
    let kdy: Date

    var body: some View {
        if spojeni.jen_pesky {
            Pruh(druh: .info, ikona: "figure.walk", text: "Tam i zpátky dojdete pěšky.")
        } else if !spojeni.zpet_mozne {
            Pruh(druh: .chyba, ikona: "exclamationmark.triangle",
                 text: Calendar.current.isDateInToday(kdy) ? "Dnes se už zpátky nedostanete." : "V tento den se zpátky nedostanete.")
        } else if let p = spojeni.posledni_zpet {
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: "house.fill")
                    .font(.title2)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Poslední spoj zpátky domů \(Format.den(Format.datum(spojeni.datum) ?? kdy))")
                        .font(.headline)
                    Text(Format.vCase(p.odjezdSpoje))
                        .font(.largeTitle.bold())
                        .monospacedDigit()
                    if let z = p.nastupniZastavka {
                        Text("ze zastávky \(z)").font(.callout)
                    }
                }
                Spacer(minLength: 0)
            }
            .foregroundStyle(Color("InfoFg"))
            .karta(Color("InfoBg"))
            .accessibilityElement(children: .combine)
        }
    }
}

// MARK: - Spoj

/// Karta spoje: odjezd autobusu → příjezd velkým písmem, doba a přestupy, linky jako štítky.
struct SpojKarta: View {
    let spoj: Spoj
    var tam = true
    var prvni = false

    private var odchodText: String? {
        guard spoj.odjezd != spoj.odjezdSpoje else { return nil }
        return tam ? "Z domu vyjděte \(Format.vCase(spoj.odjezd))." : "Vyjděte \(Format.vCase(spoj.odjezd))."
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline) {
                    casy
                    Spacer(minLength: 8)
                    doba
                }
                VStack(alignment: .leading, spacing: 4) {
                    casy
                    doba
                }
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 6) { linky }
                VStack(alignment: .leading, spacing: 6) { linky }
            }
            if let z = spoj.nastupniZastavka {
                Text("ze zastávky \(z)").font(.callout).foregroundStyle(Color.ink2)
            }
            if let o = odchodText {
                Text(o).font(.callout).foregroundStyle(Color.ink2)
            }
        }
        .foregroundStyle(.primary)
        .karta(prvni ? Color("PrimaryTint") : Color(.secondarySystemGroupedBackground))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(popisProCtecku)
        .accessibilityHint("Ukáže celou cestu")
    }

    private var casy: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(spoj.odjezdSpoje).font(.largeTitle.bold())
            Image(systemName: "arrow.right").foregroundStyle(Color.ink2).accessibilityHidden(true)
            Text(spoj.prijezd).font(.title2.weight(.semibold)).foregroundStyle(Color.ink2)
        }
        .monospacedDigit()
    }

    private var doba: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(Format.doba(spoj.minut)).font(.headline)
            Text(Format.prestupy(spoj.prestupy)).font(.callout).foregroundStyle(Color.ink2)
        }
    }

    private var linky: some View {
        ForEach(Array(spoj.jizdy.enumerated()), id: \.offset) { _, u in
            Label(Format.druh(u.typ).nazev + (u.linka.map { " \($0)" } ?? ""), systemImage: Format.druh(u.typ).ikona)
                .font(.callout.weight(.semibold))
                .foregroundStyle(Color.accentColor)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(prvni ? Color(.systemBackground) : Color("PrimaryTint"), in: Capsule())
        }
    }

    private var popisProCtecku: String {
        var t = "\(Format.druh(spoj.jizdy.first?.typ ?? "bus").nazev) jede v \(spoj.odjezdSpoje)"
        if let z = spoj.nastupniZastavka { t += " ze zastávky \(z)" }
        t += ", příjezd \(spoj.prijezd), \(Format.doba(spoj.minut)), \(Format.prestupy(spoj.prestupy))"
        if let o = odchodText { t += ". \(o)" }
        return t
    }
}

// MARK: - Cíl

/// Karta cíle nahoře na obrazovce spojení: ikona, typ, název, adresa, Zavolat a otevírací doba (sbalená).
struct CilKarta: View {
    let cil: Cil

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: Format.ikonaCile(cil.typ))
                    .font(.title2)
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 48, height: 48)
                    .background(Color("PrimaryTint"), in: Circle())
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    if let t = cil.typ_nazev { Text(t).font(.callout).foregroundStyle(Color.ink2) }
                    Text(cil.nazev).font(.title3.weight(.semibold))
                    if let a = cil.adresa ?? cil.obec { Text(a).font(.callout).foregroundStyle(Color.ink2) }
                }
            }
            if cil.nabira == true { PrijimaOdznak() }
            if let t = cil.telefon?.first, let url = Format.telURL(t) {
                Link(destination: url) {
                    Label("Zavolat \(Format.telefon(t))", systemImage: "phone.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .minCil()
                }
                .buttonStyle(.bordered)
            }
            if let h = cil.hodiny, !h.isEmpty {
                DisclosureGroup("Otevírací doba") {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(Format.hodiny(h), id: \.self) { Text($0).font(.callout) }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 4)
                }
                .font(.callout.weight(.semibold))
            }
        }
        .karta()
    }
}
