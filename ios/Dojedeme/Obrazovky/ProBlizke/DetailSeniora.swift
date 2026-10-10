//  DetailSeniora.swift – stav, bydliště a předvolby seniora; potvrzení čísla, kartička, úprava a smazání.

import SwiftUI
import UIKit

struct DetailSeniora: View {
    @Environment(Stav.self) private var stav
    @Environment(\.dismiss) private var zavrit
    let telefon: String
    let ucet: Ucet
    var obnov: () async -> Void

    @State private var upravit = false
    @State private var karticka: String?
    @State private var smazat = false
    @State private var chyba: String?

    private var senior: Senior? { ucet.seniori?.first { $0.telefon == telefon } }

    var body: some View {
        List {
            if let s = senior {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(stav.jmenoSeniora(s.telefon)).font(.title3.weight(.semibold))
                        Text(Format.telefonPlny(s.telefon)).font(.callout).foregroundStyle(Color.ink2)
                        StavSeniora(senior: s).font(.headline)
                    }
                    .padding(.vertical, 4)
                    if !s.overeno {
                        NavigationLink {
                            OvereniView(telefon: s.telefon, overeni: s.overeni, cisloSluzby: ucet.cislo_sluzby, obnov: obnov)
                        } label: {
                            Label("Spárovat číslo kódem", systemImage: "number").frame(minHeight: 44)
                        }
                    }
                }

                Section("Bydliště") {
                    Text(s.bydliste_popis ?? "Uložené podle mapy")
                }

                Section {
                    if s.zkratky.isEmpty {
                        Text("Zatím žádné. Přidejte je v úpravě.").foregroundStyle(Color.ink2)
                    }
                    ForEach(s.zkratky, id: \.kod) { z in
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            Text("*\(z.kod)").font(.title3.bold()).monospacedDigit()
                            VStack(alignment: .leading) {
                                Text(z.popis ?? z.nazev ?? "Uložené místo").font(.headline)
                                if let n = z.nazev, n != z.popis {
                                    Text([n, z.obec].compactMap { $0 }.joined(separator: ", ")).font(.callout).foregroundStyle(Color.ink2)
                                }
                            }
                        }
                        .accessibilityElement(children: .combine)
                    }
                } header: {
                    Text("Předvolby")
                } footer: {
                    Text("Senior pošle SMS s hvězdičkou a číslem, třeba *11. Na jiný den *11 zitra.")
                }

                Section {
                    Button { Task { await nactiKarticku() } } label: {
                        Label("Kartička pro seniora", systemImage: "rectangle.and.text.magnifyingglass").frame(minHeight: 44)
                    }
                    Button { upravit = true } label: {
                        Label("Upravit", systemImage: "pencil").frame(minHeight: 44)
                    }
                    Button(role: .destructive) { smazat = true } label: {
                        Label("Smazat seniora", systemImage: "trash").frame(minHeight: 44)
                    }
                }
                if let chyba { Section { Pruh(druh: .chyba, ikona: "exclamationmark.triangle", text: chyba) } }
            } else {
                ContentUnavailableView("Senior už v účtu není", systemImage: "person.slash")
            }
        }
        .navigationTitle(stav.jmenoSeniora(telefon))
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $upravit) {
            NavigationStack {
                FormularSeniora(existujici: senior, cisloSluzby: ucet.cislo_sluzby, obnov: obnov)
            }
        }
        .sheet(item: Binding(get: { karticka.map { TextKarticky(text: $0) } }, set: { karticka = $0?.text })) { k in
            KartickaView(text: k.text)
        }
        .confirmationDialog("Smazat seniora?", isPresented: $smazat, titleVisibility: .visible) {
            Button("Smazat seniora", role: .destructive) { Task { await smaz() } }
            Button("Ponechat", role: .cancel) {}
        } message: {
            Text("Služba mu přestane odpovídat a smažeme i historii jeho SMS.")
        }
    }

    @MainActor
    private func nactiKarticku() async {
        do {
            karticka = try await API.shared.karticka(telefon: telefon).text
            chyba = nil
        } catch {
            chyba = error.localizedDescription
        }
    }

    @MainActor
    private func smaz() async {
        do {
            try await API.shared.smazProfil(telefon: telefon)
            stav.jmenaSenioru[telefon] = nil
            await obnov()
            zavrit()
        } catch {
            chyba = error.localizedDescription
        }
    }
}

struct TextKarticky: Identifiable {
    let text: String
    var id: String { text }
}

/// Kartička k telefonu seniora: velké písmo, jde poslat nebo vytisknout.
struct KartickaView: View {
    @Environment(\.dismiss) private var zavrit
    let text: String

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(Array(text.split(separator: "\n", omittingEmptySubsequences: false).enumerated()), id: \.offset) { i, radek in
                        let r = String(radek)
                        if r.isEmpty {
                            Spacer().frame(height: 4)
                        } else if i == 0 {
                            Text(r).font(.title.bold())
                        } else if r.hasPrefix("*") {
                            Text(r).font(.title2.bold()).monospacedDigit()
                        } else {
                            Text(r).font(.title3)
                        }
                    }
                }
                .padding(24)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .navigationTitle("Kartička pro seniora")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Zavřít") { zavrit() } }
                ToolbarItem(placement: .primaryAction) {
                    ShareLink(item: text) { Label("Poslat nebo vytisknout", systemImage: "square.and.arrow.up") }
                }
            }
        }
    }
}

/// Spárování čísla: senior pošle SMS s kódem na číslo služby. Stav se kontroluje sám.
struct OvereniView: View {
    @Environment(Stav.self) private var stav
    let telefon: String
    @State var overeni: Overeni?
    let cisloSluzby: String?
    var obnov: () async -> Void

    @State private var hotovo = false
    @State private var chyba: String?
    @State private var noveCislo: String?

    private var cislo: String { Format.telefonPlny(noveCislo ?? cisloSluzby ?? "") }
    /// Číslo bez mezer, aby na něj šlo v SMS klepnout.
    private var cisloBezMezer: String {
        let c = (noveCislo ?? cisloSluzby ?? "").filter(\.isNumber)
        return c.count == 12 && c.hasPrefix("420") ? "+" + c : c
    }
    private var kod: String { overeni?.sms ?? "*\(overeni?.kod ?? "")" }
    private var navod: String {
        "Pošlete prosím SMS s textem \(kod) na číslo \(cisloBezMezer). Nevytáčejte, pište jen SMS. Tím zapnete Dojedeme: spoje k lékaři přes SMS."
    }

    var body: some View {
        List {
            if hotovo {
                Section {
                    Pruh(druh: .uspech, ikona: "checkmark.circle", text: "Hotovo, číslo je potvrzené. \(stav.jmenoSeniora(telefon)) může psát.")
                }
                Section {
                    Text("Teď stačí, aby senior poslal SMS s hvězdičkou a číslem místa, třeba *11. Kartičku s návodem mu vytisknete v detailu seniora.")
                    Button {
                        stav.zalozka = .spoj
                    } label: {
                        Label("Najít spoj a poslat ho SMS", systemImage: "message").minCil()
                    }
                }
            } else if let overeni {
                Section {
                    Text(kod)
                        .font(.system(.largeTitle, design: .rounded).bold())
                        .monospacedDigit()
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.vertical, 8)
                        .accessibilityLabel("Kód \(overeni.kod.map { String($0) }.joined(separator: " "))")
                    Text("Požádejte seniora, ať ze svého telefonu pošle SMS s textem \(kod) na číslo \(cislo). Na číslo nevolá, jen píše SMS. Kód platí 48 hodin.")
                    HStack {
                        ProgressView()
                        Text("Čekáme na SMS od seniora.").foregroundStyle(Color.ink2)
                    }
                }
                Section {
                    Button {
                        UIPasteboard.general.string = navod
                    } label: {
                        Label("Zkopírovat návod", systemImage: "doc.on.doc").frame(minHeight: 44)
                    }
                    ShareLink(item: navod) {
                        Label("Poslat návod seniorovi", systemImage: "square.and.arrow.up").frame(minHeight: 44)
                    }
                }
            } else {
                Section {
                    Text("Kód pro potvrzení vypršel. Vytvořte nový a předejte ho seniorovi.")
                    Button("Vytvořit nový kód") { Task { await novyKod() } }
                }
            }
            if let chyba { Section { Pruh(druh: .chyba, ikona: "exclamationmark.triangle", text: chyba) } }
        }
        .navigationTitle("Potvrzení čísla")
        .navigationBarTitleDisplayMode(.inline)
        .sensoryFeedback(.success, trigger: hotovo)
        .task { await hlidej() }
    }

    /// Každých 5 s se zeptá na účet; jakmile je číslo ověřené, ukáže „Hotovo“.
    @MainActor
    private func hlidej() async {
        while !Task.isCancelled && !hotovo {
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            if let u = try? await API.shared.ucet(), let s = u.seniori?.first(where: { $0.telefon == telefon }), s.overeno {
                hotovo = true
                await obnov()
            }
        }
    }

    @MainActor
    private func novyKod() async {
        do {
            let n = try await API.shared.novyKod(telefon: telefon)
            overeni = n.overeni
            noveCislo = n.cislo_sluzby
            chyba = nil
            await obnov()
        } catch {
            chyba = error.localizedDescription
        }
    }
}
