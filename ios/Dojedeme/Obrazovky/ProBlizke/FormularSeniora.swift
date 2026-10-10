//  FormularSeniora.swift – nový senior nebo úprava: telefon (+ jméno jen v tomto telefonu), bydliště,
//  předvolby (*11, *12…) a povinný souhlas. Uložení PUT /sms/profil/{telefon}, u nového pak spárování kódem.

import SwiftUI

struct FormularSeniora: View {
    @Environment(Stav.self) private var stav
    @Environment(\.dismiss) private var zavrit
    let existujici: Senior?
    let cisloSluzby: String?
    var obnov: () async -> Void

    struct Predvolba: Identifiable, Hashable {
        var kod: String
        var cilId: String
        var popis: String
        var nazev: String
        var id: String { kod }
    }

    @State private var telefon = ""
    @State private var jmeno = ""
    @State private var bydliste: Misto?
    @State private var predvolby: [Predvolba] = []
    @State private var souhlas = false
    @State private var chyba: String?
    @State private var uklada = false
    @State private var vyberMista = false
    @State private var sparovat: Sparovani?
    @State private var pripraveno = false

    struct Sparovani: Identifiable, Hashable {
        let telefon: String
        let overeni: Overeni?
        let cisloSluzby: String?
        var id: String { telefon }
    }

    private var normalizovany: String? {
        var c = telefon.filter(\.isNumber)
        if c.count == 12, c.hasPrefix("420") { c.removeFirst(3) }
        return c.count == 9 ? "+420" + c : nil
    }

    var body: some View {
        Form {
            Section {
                TextField("Telefon seniora, např. 736 647 582", text: $telefon)
                    .keyboardType(.phonePad)
                    .textContentType(.telephoneNumber)
                    .disabled(existujici != nil)
                    .frame(minHeight: 44)
                TextField("Jméno, např. Děda Josef", text: $jmeno)
                    .frame(minHeight: 44)
            } header: {
                Text("Senior")
            } footer: {
                Text("Číslo mobilu, ze kterého bude senior psát. Jméno zůstane jen v tomto telefonu.")
            }

            Section("Bydliště seniora") {
                NavigationLink {
                    AdresaVyberSeniora(bydliste: $bydliste)
                } label: {
                    if let b = bydliste {
                        Label(b.popis, systemImage: "house")
                    } else {
                        Text("Vybrat bydliště").foregroundStyle(Color.accentColor)
                    }
                }
                .frame(minHeight: 44)
            }

            Section {
                ForEach($predvolby) { $p in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            Text("*\(p.kod)").font(.title3.bold()).monospacedDigit()
                            TextField("Popis, např. Můj zubař", text: $p.popis)
                        }
                        if p.nazev != p.popis {
                            Text(p.nazev).font(.callout).foregroundStyle(Color.ink2)
                        }
                    }
                    .frame(minHeight: 44)
                }
                .onDelete { predvolby.remove(atOffsets: $0) }
                Button {
                    vyberMista = true
                } label: {
                    Label("Přidat místo", systemImage: "plus.circle").frame(minHeight: 44)
                }
                .disabled(bydliste == nil)
            } header: {
                Text("Předvolby")
            } footer: {
                Text(bydliste == nil ? "Nejdřív vyberte bydliště. Místa pak seřadíme podle spojení z něj."
                                     : "Senior pak pošle třeba *11 a přijde mu spoj na první místo.")
            }

            Section {
                Toggle(isOn: $souhlas) {
                    Text("Senior souhlasí s tím, že Dojedeme uloží jeho telefonní číslo a bydliště, aby mu mohlo posílat spoje. Souhlas může kdykoli zrušit SMS STOP.")
                        .font(.callout)
                }
            }

            if let chyba {
                Section { Pruh(druh: .chyba, ikona: "exclamationmark.triangle", text: chyba) }
            }

            Section {
                Button {
                    Task { await uloz() }
                } label: {
                    HStack {
                        Text(existujici == nil ? "Uložit a získat kód" : "Uložit změny")
                        if uklada { Spacer(); ProgressView() }
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .disabled(uklada)
            }
        }
        .navigationTitle(existujici == nil ? "Nový senior" : "Upravit seniora")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Zrušit") { zavrit() } }
        }
        .sheet(isPresented: $vyberMista) {
            if let b = bydliste {
                VyberMistaSeniora(odkud: b) { cil in
                    pridej(cil)
                    vyberMista = false
                }
            }
        }
        .navigationDestination(item: $sparovat) { s in
            OvereniView(telefon: s.telefon, overeni: s.overeni, cisloSluzby: s.cisloSluzby, obnov: obnov)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) { Button("Hotovo") { zavrit() } }
                }
        }
        .onAppear(perform: pripravit)
    }

    private func pripravit() {
        guard !pripraveno else { return }
        pripraveno = true
        guard let s = existujici else { return }
        telefon = Format.telefon(s.telefon)
        jmeno = stav.jmenaSenioru[s.telefon] ?? ""
        if let lat = s.bydliste_lat, let lon = s.bydliste_lon {
            bydliste = Misto(popis: s.bydliste_popis ?? "Uložené podle mapy", lat: lat, lon: lon)
        }
        predvolby = s.zkratky.map {
            Predvolba(kod: $0.kod, cilId: $0.cil_id, popis: $0.popis ?? $0.nazev ?? "", nazev: $0.nazev ?? $0.popis ?? "")
        }
        souhlas = true
    }

    private func pridej(_ cil: Cil) {
        let pouzite = Set(predvolby.compactMap { Int($0.kod) })
        let kod = (11...999).first { !pouzite.contains($0) } ?? 11
        predvolby.append(Predvolba(kod: "\(kod)", cilId: cil.id, popis: cil.nazev, nazev: cil.nazev))
    }

    @MainActor
    private func uloz() async {
        guard let tel = existujici?.telefon ?? normalizovany else {
            chyba = "Zadejte číslo mobilu seniora: 9 číslic, například 736 647 582."
            return
        }
        guard let b = bydliste else { chyba = "Vyberte bydliště seniora."; return }
        guard !predvolby.isEmpty else { chyba = "Přidejte aspoň jedno místo, kam senior jezdí. Jinak by mu SMS nic neposlala."; return }
        guard souhlas else { chyba = "Bez souhlasu seniora službu zapnout nejde."; return }
        uklada = true
        defer { uklada = false }
        let telo = ProfilPUT(
            bydliste: ProfilPUT.Bydliste(lat: b.lat, lon: b.lon, popis: b.popis),
            souhlas: true,
            zkratky: predvolby.map { p in
                ProfilPUT.Zkratka(kod: p.kod, cil_id: p.cilId, popis: p.popis.isEmpty ? p.nazev : p.popis)
            })
        do {
            let odpoved = try await API.shared.ulozProfil(telefon: tel, telo)
            let j = jmeno.trimmingCharacters(in: .whitespaces)
            stav.jmenaSenioru[odpoved.telefon] = j.isEmpty ? nil : j
            chyba = nil
            await obnov()
            if existujici == nil && !odpoved.overeno {
                sparovat = Sparovani(telefon: odpoved.telefon, overeni: odpoved.overeni, cisloSluzby: odpoved.cislo_sluzby ?? cisloSluzby)
            } else {
                zavrit()
            }
        } catch {
            chyba = error.localizedDescription
        }
    }
}

/// Bydliště seniora (stejné hledání adresy jako u uživatele).
struct AdresaVyberSeniora: View {
    @Binding var bydliste: Misto?
    @Environment(\.dismiss) private var zavrit

    var body: some View {
        AdresaVyber(nadpis: "Bydliště seniora") { m in
            bydliste = m
            zavrit()
        }
    }
}

/// Výběr místa pro předvolbu: typ nebo jméno lékaře, seřazeno podle spojení z bydliště seniora.
struct VyberMistaSeniora: View {
    let odkud: Misto
    var priVyberu: (Cil) -> Void
    @Environment(\.dismiss) private var zavrit

    private let kdy = Format.dalsiPracovniDen()
    private let typy: [DotazMist] = [.praktik, .zubar, .nemocnice, .pohotovost, .urad]

    var body: some View {
        NavigationStack {
            List {
                Section {
                    NavigationLink {
                        HledatLekare(kdy: kdy, odkud: odkud, priVyberu: priVyberu)
                    } label: {
                        Label("Hledat lékaře podle jména", systemImage: "magnifyingglass").frame(minHeight: 44)
                    }
                }
                Section("Nebo vyberte druh místa") {
                    ForEach(typy, id: \.self) { t in
                        NavigationLink(t.nadpis) {
                            SeznamMist(dotaz: t, kdy: kdy, odkud: odkud, priVyberu: priVyberu)
                        }
                        .frame(minHeight: 44)
                    }
                }
            }
            .navigationTitle("Přidat místo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Zrušit") { zavrit() } }
            }
        }
    }
}
