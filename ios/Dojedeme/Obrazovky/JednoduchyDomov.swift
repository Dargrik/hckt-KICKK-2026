//  JednoduchyDomov.swift – jednoduchý režim pro seniora: písmo nejméně .xxLarge, dotykové cíle 60 pt,
//  velké dlaždice (Můj lékař, Moje místa, Zubař, Nemocnice, Úřad), Zavolat Senior Expres (jen když v obci jezdí) a Pomoc.
//  Moje místa uloží blízký v úplném režimu; tady se jen ukážou (bez mazání), a když žádná nejsou, sekce chybí.
//  Odpoledne a o víkendu ukazuje rovnou spoje na další pracovní den.

import SwiftUI

struct JednoduchyDomov: View {
    @Environment(Stav.self) private var stav
    @Environment(\.dynamicTypeSize) private var systemovaVelikost
    @State private var pomoc = false

    private var kdy: Date { Format.vychoziCasJednoduchy() }

    /// Uložená místa kromě lékaře, který už je na dlaždici „Můj lékař“.
    private var dalsiMojeMista: [MojeMisto] {
        stav.mojeMista.filter { $0.id != stav.mujLekar?.id }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    NavigationLink { mujLekar } label: {
                        Dlazdice(nazev: "Můj lékař", ikona: "stethoscope",
                                 popis: stav.mujLekar.map { [$0.nazev, $0.obec].compactMap { $0 }.joined(separator: ", ") })
                    }

                    if !dalsiMojeMista.isEmpty {
                        NadpisSekce(text: "Moje místa").padding(.top, 8)
                        ForEach(dalsiMojeMista) { m in
                            NavigationLink { SpojeniView(cilId: m.id, nazev: m.nazev, kdy: kdy) } label: {
                                Dlazdice(nazev: m.nazev, ikona: Format.ikonaCile(m.typ),
                                         popis: [m.typNazev, m.obec].compactMap { $0 }.joined(separator: ", "))
                            }
                        }
                        NadpisSekce(text: "Další místa").padding(.top, 8)
                    }

                    NavigationLink { SeznamMist(dotaz: .zubar, kdy: kdy) } label: {
                        Dlazdice(nazev: "Zubař", ikona: "mouth")
                    }
                    NavigationLink { SeznamMist(dotaz: .nemocnice, kdy: kdy) } label: {
                        Dlazdice(nazev: "Nemocnice", ikona: "cross.case")
                    }
                    NavigationLink { SeznamMist(dotaz: .urad, kdy: kdy) } label: {
                        Dlazdice(nazev: "Úřad", ikona: "building.columns", popis: "občanský průkaz, pas")
                    }
                    NavigationLink { NovyLekarJednoduse(kdy: kdy) } label: {
                        Dlazdice(nazev: "Hledám nového lékaře", ikona: "person.badge.plus",
                                 popis: "lékaři, kteří přijímají nové pacienty")
                    }

                    if let se = stav.seniorExpres.first, let t = se.telefon, let url = Format.telURL(t) {
                        Link(destination: url) {
                            VStack(alignment: .leading, spacing: 4) {
                                Label("Zavolat Senior Expres", systemImage: "phone.fill").font(.title2.weight(.bold))
                                Text("Odvoz autem pro seniory. \(Format.telefon(t))").font(.title3)
                            }
                            .foregroundStyle(Color("OnSignal"))
                            .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
                            .padding(20)
                            .background(Color("Signal"), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                        }
                    }

                    Button { pomoc = true } label: {
                        Label("Pomoc", systemImage: "questionmark.circle")
                            .font(.title2.weight(.bold))
                            .foregroundStyle(.primary)
                            .frame(maxWidth: .infinity, minHeight: 60)
                            .background(Color("PrimaryTint"), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Color.accentColor, lineWidth: 2))
                    }
                    .buttonStyle(.plain)
                }
                .buttonStyle(.plain)
                .padding(20)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Kam potřebujete?")
            .sheet(isPresented: $pomoc) { Pomoc() }
        }
        .dynamicTypeSize(systemovaVelikost < .xxLarge ? .xxLarge : systemovaVelikost)
    }

    /// Uložený lékař, jinak hledání podle jména (tam jde lékař uložit hvězdičkou).
    @ViewBuilder private var mujLekar: some View {
        if let m = stav.mujLekar {
            SpojeniView(cilId: m.id, nazev: m.nazev, kdy: kdy)
        } else {
            HledatLekare(kdy: kdy)
        }
    }
}

/// Velká dlaždice jednoduchého režimu: ikona, název a volitelně druhý řádek (např. jméno uloženého lékaře).
/// Při největším písmu se ikona dá nad text, aby se slova nelámala.
struct Dlazdice: View {
    let nazev: String
    let ikona: String
    var popis: String? = nil
    @Environment(\.dynamicTypeSize) private var velikost
    @ScaledMetric(relativeTo: .title) private var velikostIkony: CGFloat = 44

    var body: some View {
        let ax = velikost.isAccessibilitySize
        let rozvrzeni = ax ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12)) : AnyLayout(HStackLayout(spacing: 20))
        rozvrzeni {
            Image(systemName: ikona)
                .font(.system(size: velikostIkony))
                .foregroundStyle(Color.accentColor)
                .frame(minWidth: velikostIkony * 1.2, alignment: .leading)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(nazev).font(.title2.weight(.bold)).foregroundStyle(.primary)
                if let popis, !popis.isEmpty {
                    Text(popis).font(.body).foregroundStyle(Color.ink2)
                }
            }
            if !ax {
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.title3.weight(.semibold)).foregroundStyle(Color.accentColor)
                    .accessibilityHidden(true)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, minHeight: 112, alignment: .leading)
        .background(Color("PrimaryTint"), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Color.accentColor, lineWidth: 2))
        .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityHint("Ukáže spoje tam a zpátky domů")
    }
}

struct Pomoc: View {
    @Environment(Stav.self) private var stav
    @Environment(\.dismiss) private var zavrit
    @State private var potvrditRezim = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Klepněte na místo, kam potřebujete. Ukážeme, kdy jede spoj tam a kdy zpátky domů.")
                    Text("Nahoře vždy uvidíte, kdy jede poslední spoj zpátky.")
                    Text("Nic nemůžete pokazit. Když si nevíte rady, požádejte o pomoc někoho blízkého.")
                }
                if let se = stav.seniorExpres.first, let t = se.telefon, let url = Format.telURL(t) {
                    Section {
                        Link(destination: url) {
                            Label("Zavolat Senior Expres \(Format.telefon(t))", systemImage: "phone.fill").minCil()
                        }
                    }
                }
                Section {
                    NavigationLink("Změnit bydliště") { ZmenaBydliste() }
                        .minCil()
                    Button("Všechny možnosti aplikace") { potvrditRezim = true }
                        .minCil()
                } header: {
                    Text("Pro blízké")
                } footer: {
                    if let b = stav.bydliste { Paticka(text: "Bydliště: \(b.popis)") }
                }
            }
            .navigationTitle("Pomoc")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Zavřít") { zavrit() } }
            }
            .confirmationDialog("Aplikace bude mít víc tlačítek a menší písmo. Opravdu?", isPresented: $potvrditRezim,
                                titleVisibility: .visible) {
                Button("Ano, všechny možnosti") {
                    stav.jednoduchy = false
                    zavrit()
                }
                Button("Ne, nechat jednoduché", role: .cancel) {}
            }
        }
    }
}

/// Jednoduchý režim: nový lékař ve třech velkých volbách (praktik, zubař, jiný obor).
struct NovyLekarJednoduse: View {
    let kdy: Date

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Ukážeme lékaře v dosahu, kteří přijímají nové pacienty. Před návštěvou zavolejte.")
                    .font(.title3)
                NavigationLink { SeznamMist(dotaz: .novyPraktik, kdy: kdy) } label: {
                    Dlazdice(nazev: "Praktický lékař", ikona: "stethoscope")
                }
                NavigationLink {
                    SeznamMist(dotaz: DotazMist(nadpis: "Nový zubař", typ: "zubar", nabira: true,
                                                popis: "Zubaři v dosahu, kteří přijímají nové pacienty. Před návštěvou zavolejte."), kdy: kdy)
                } label: {
                    Dlazdice(nazev: "Zubař", ikona: "mouth")
                }
                NavigationLink { Obory(kdy: kdy) } label: {
                    Dlazdice(nazev: "Jiný obor", ikona: "list.bullet", popis: "gynekolog, oční, dětský lékař")
                }
            }
            .buttonStyle(.plain)
            .padding(20)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Nový lékař")
    }
}
