//  NajitSpoj.swift – hlavní obrazovka standardního režimu. Nahoře karta Odkud a Kdy, pod ní velké volby
//  „Kam pojedete?“ (Můj lékař, Nemocnice, Úřad, Pohotovost), výrazná sekce „Hledáte praktického lékaře?“
//  (lékaři, kteří přijímají nové pacienty) a Moje místa.

import SwiftUI

/// Co hledáme v seznamu míst (GET /cile).
struct DotazMist: Hashable {
    var nadpis: String
    var typ: String
    var nabira = false
    var urady = false
    var popis: String? = nil

    static let nemocnice = DotazMist(nadpis: "Nemocnice", typ: "nemocnice")
    static let urad = DotazMist(nadpis: "Úřad", typ: "obecni_urad,urad_orp", urady: true,
        popis: "Úřady, pod které vaše obec patří. Občanský průkaz, pas nebo řidičský průkaz vyřídíte na úřadu obce s rozšířenou působností.")
    static let pohotovost = DotazMist(nadpis: "Pohotovost", typ: "pohotovost,zubni_pohotovost,pohotovost_chirurgie",
        popis: "Lékařská a zubní pohotovost. Ve všední dny mají většinou otevřeno až odpoledne.")
    static let praktik = DotazMist(nadpis: "Praktický lékař", typ: "praktik")
    static let zubar = DotazMist(nadpis: "Zubař", typ: "zubar")
    static let novyPraktik = DotazMist(nadpis: "Nový praktický lékař", typ: "praktik", nabira: true,
        popis: "Praktičtí lékaři v dosahu, kteří podle seznamu Karlovarského kraje přijímají nové pacienty. Před návštěvou zavolejte.")
}

/// Obor pro „Jiný obor“ (typ pro /cile, nadpis seznamu).
struct Obor: Hashable {
    let typ: String
    let nazev: String
    let nadpis: String
}

let OBORY: [Obor] = [
    Obor(typ: "praktik", nazev: "Praktický lékař", nadpis: "Nový praktický lékař"),
    Obor(typ: "zubar", nazev: "Zubař", nadpis: "Nový zubař"),
    Obor(typ: "gynekolog", nazev: "Gynekolog", nadpis: "Nový gynekolog"),
    Obor(typ: "ocni", nazev: "Oční lékař", nadpis: "Nový oční lékař"),
    Obor(typ: "pediatr", nazev: "Dětský lékař", nadpis: "Nový dětský lékař"),
    Obor(typ: "psychiatr", nazev: "Psychiatr", nadpis: "Nový psychiatr"),
    Obor(typ: "endokrinolog", nazev: "Endokrinolog", nadpis: "Nový endokrinolog"),
    Obor(typ: "rehabilitace", nazev: "Rehabilitace", nadpis: "Rehabilitace pro nové pacienty"),
]

/// Hledání „Můj lékař“: jen lékaři (nemocnice, úřad a pohotovost mají vlastní volbu).
let TYPY_LEKARU = "praktik,zubar,gynekolog,pediatr,ocni,psychiatr,endokrinolog,rehabilitace,dentalni_hygiena"

struct NajitSpoj: View {
    @Environment(Stav.self) private var stav
    @Environment(\.dynamicTypeSize) private var velikostPisma
    @State private var kdy = Format.vychoziCas()
    @State private var vyberCasu = false

    private var sloupce: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: 12), count: velikostPisma.isAccessibilitySize ? 1 : 2)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    odkudKdy

                    VStack(alignment: .leading, spacing: 12) {
                        NadpisSekce(text: "Kam pojedete?")
                        LazyVGrid(columns: sloupce, spacing: 12) {
                            NavigationLink { HledatLekare(kdy: kdy) } label: {
                                VelkaVolba(nazev: "Můj lékař", popis: "podle jména", ikona: "stethoscope")
                            }
                            NavigationLink { SeznamMist(dotaz: .nemocnice, kdy: kdy) } label: {
                                VelkaVolba(nazev: "Nemocnice", popis: "nejrychleji dostupné", ikona: "cross.case")
                            }
                            NavigationLink { SeznamMist(dotaz: .urad, kdy: kdy) } label: {
                                VelkaVolba(nazev: "Úřad", popis: "kam vaše obec patří", ikona: "building.columns")
                            }
                            NavigationLink { SeznamMist(dotaz: .pohotovost, kdy: .now) } label: {
                                VelkaVolba(nazev: "Pohotovost", popis: "lékařská i zubní", ikona: "staroflife")
                            }
                        }
                        .buttonStyle(.plain)
                    }

                    hledamPraktika

                    if !stav.mojeMista.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            NadpisSekce(text: "Moje místa")
                            ForEach(stav.mojeMista) { m in
                                NavigationLink {
                                    SpojeniView(cilId: m.id, nazev: m.nazev, kdy: kdy)
                                } label: {
                                    MojeMistoKarta(misto: m)
                                }
                                .buttonStyle(.plain)
                                .contextMenu {
                                    Button("Odebrat z Mých míst", systemImage: "star.slash", role: .destructive) {
                                        stav.mojeMista.removeAll { $0.id == m.id }
                                    }
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Najít spoj")
            .sheet(isPresented: $vyberCasu) {
                VyberCasu(kdy: $kdy)
                    .presentationDetents([.medium, .large])
            }
        }
    }

    // MARK: části

    private var odkudKdy: some View {
        Karta {
            VStack(spacing: 0) {
                if let b = stav.bydliste {
                    NavigationLink { ZmenaBydliste() } label: {
                        RadekVolby(ikona: "house.fill", nadpis: "Odkud", hodnota: b.popis)
                    }
                    .buttonStyle(.plain)
                }
                Divider().padding(.leading, 44)
                Button { vyberCasu = true } label: {
                    RadekVolby(ikona: "clock.fill", nadpis: "Kdy", hodnota: Format.velke(Format.denACas(kdy)))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var hledamPraktika: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Hledáte praktického lékaře?", systemImage: "person.badge.plus")
                .font(.title3.weight(.bold))
                .foregroundStyle(Color.accentColor)
            Text("Ukážeme praktické lékaře v dosahu, kteří přijímají nové pacienty. Seřazené podle toho, jak rychle se k nim dostanete.")
                .font(.body)
            NavigationLink {
                SeznamMist(dotaz: .novyPraktik, kdy: kdy)
            } label: {
                Text("Najít praktického lékaře")
                    .font(.headline)
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            NavigationLink {
                Obory(kdy: kdy)
            } label: {
                Text("Jiný obor: zubař, gynekolog, oční…")
                    .font(.callout.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.bordered)
        }
        .padding(18)
        .background(Color("PrimaryTint"), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

/// Výběr dne a času odjezdu: rychlé volby a pod nimi kalendář.
struct VyberCasu: View {
    @Binding var kdy: Date
    @Environment(\.dismiss) private var zavrit

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach(Format.rychleVolby(), id: \.nazev) { volba in
                        Button(volba.nazev) { kdy = volba.cas; zavrit() }
                            .frame(minHeight: 44)
                    }
                }
                Section("Jiný den a čas") {
                    DatePicker("Odjezd od", selection: $kdy, displayedComponents: [.date, .hourAndMinute])
                        .frame(minHeight: 44)
                }
            }
            .navigationTitle("Kdy pojedete")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Hotovo") { zavrit() } }
            }
        }
    }
}

struct ZmenaBydliste: View {
    @Environment(Stav.self) private var stav
    @Environment(\.dismiss) private var zavrit

    var body: some View {
        AdresaVyber(nadpis: "Bydliště", vysvetleni: "Adresa zůstane jen v tomto telefonu.") { misto in
            stav.bydliste = misto
            Task { await stav.obnovSeniorExpres() }
            zavrit()
        }
    }
}

struct Obory: View {
    let kdy: Date

    var body: some View {
        List {
            Section {
                ForEach(OBORY, id: \.typ) { o in
                    NavigationLink(o.nazev) {
                        SeznamMist(dotaz: DotazMist(nadpis: o.nadpis, typ: o.typ, nabira: true,
                                                    popis: "Lékaři v dosahu, kteří podle seznamu Karlovarského kraje přijímají nové pacienty. Před návštěvou zavolejte."),
                                   kdy: kdy)
                    }
                    .frame(minHeight: 44)
                }
            } footer: {
                Text("Ukážeme jen lékaře, kteří přijímají nové pacienty, seřazené podle spojení.")
            }
        }
        .navigationTitle("Nový lékař")
    }
}

/// „Můj lékař“: hledání podle příjmení, názvu ordinace nebo obce, výsledky seřazené podle spojení.
struct HledatLekare: View {
    @Environment(Stav.self) private var stav
    let kdy: Date
    var odkud: Misto? = nil
    var priVyberu: ((Cil) -> Void)? = nil

    @State private var dotaz = ""
    @State private var vysledky: [Cil] = []
    @State private var hleda = false
    @State private var chyba: String?

    var body: some View {
        List {
            if dotaz.count < 2 {
                Section {
                    Text("Napište příjmení lékaře, název ordinace nebo obec, například Jedelský nebo Nejdek. Diakritiku psát nemusíte.")
                        .foregroundStyle(Color.ink2)
                }
            }
            if let chyba { Section { Pruh(druh: .chyba, ikona: "exclamationmark.triangle", text: chyba) } }
            if hleda {
                Section { Nacitani(text: "Hledáme lékaře…") }
            } else if !vysledky.isEmpty {
                Section("Nalezení lékaři") {
                    ForEach(vysledky) { c in
                        if let priVyberu {
                            Button { priVyberu(c) } label: { CilRadek(cil: c).foregroundStyle(.primary) }
                        } else {
                            NavigationLink { SpojeniView(cil: c, kdy: kdy) } label: { CilRadek(cil: c) }
                        }
                    }
                }
            } else if dotaz.count >= 2 {
                Section { Text("Nikoho takového jsme nenašli. Zkuste jen příjmení nebo obec.").foregroundStyle(Color.ink2) }
            }
        }
        .searchable(text: $dotaz, placement: .navigationBarDrawer(displayMode: .always), prompt: "Příjmení, ordinace nebo obec")
        .task(id: dotaz) { await hledej() }
        .navigationTitle("Můj lékař")
    }

    @MainActor
    private func hledej() async {
        let q = dotaz.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2, let z = odkud ?? stav.bydliste else { vysledky = []; return }
        try? await Task.sleep(nanoseconds: 350_000_000)
        if Task.isCancelled { return }
        hleda = true
        defer { hleda = false }
        do {
            vysledky = try await API.shared.hledejCile(q, typ: TYPY_LEKARU, odkud: z, kdy: kdy)
            chyba = nil
        } catch {
            if !Task.isCancelled { chyba = error.localizedDescription }
        }
    }
}
