//  AdresaVyber.swift – bydliště: hledání adresy (GET /adresy, adresy RÚIAN kraje) nebo poloha telefonu.

import SwiftUI

struct AdresaVyber: View {
    var nadpis = "Bydliště"
    var vysvetleni: String? = nil
    var priVyberu: (Misto) -> Void

    @State private var dotaz = ""
    @State private var vysledky: [Adresa] = []
    @State private var chyba: String?
    @State private var hleda = false
    @State private var poloha = Poloha()
    @State private var zjistujePolohu = false
    @State private var hledanoPro = ""

    var body: some View {
        List {
            if let vysvetleni {
                Section { Text(vysvetleni).foregroundStyle(Color.ink2) }
            }
            Section {
                Button {
                    Task { await pouzijPolohu() }
                } label: {
                    HStack {
                        Label("Jsem teď doma, použít polohu", systemImage: "location.fill")
                        if zjistujePolohu { Spacer(); ProgressView() }
                    }
                    .frame(minHeight: 44)
                }
                .disabled(zjistujePolohu)
            } footer: {
                Paticka(text: "Telefon se zeptá na polohu. Klepněte na Povolit při používání aplikace.")
            }
            if let chyba {
                Section { Pruh(druh: .chyba, ikona: "exclamationmark.triangle", text: chyba) }
            }
            if hleda {
                Section { Nacitani(text: "Hledáme adresu…") }
            } else if !vysledky.isEmpty {
                Section("Vyberte adresu") {
                    ForEach(vysledky) { a in
                        Button {
                            priVyberu(Misto(popis: a.adresa, lat: a.lat, lon: a.lon, kodObce: a.kod_obce))
                        } label: {
                            Text(a.adresa).foregroundStyle(.primary).frame(minHeight: 44, alignment: .leading)
                        }
                    }
                }
            } else if !hledanoPro.isEmpty && hledanoPro == dotaz.trimmingCharacters(in: .whitespaces) {
                Section { Text("Takovou adresu v Karlovarském kraji nenacházíme. Zkuste obec a číslo domu, například Abertamy 115.").foregroundStyle(Color.ink2) }
            }
        }
        .searchable(text: $dotaz, placement: .navigationBarDrawer(displayMode: .always), prompt: "Obec nebo ulice a číslo domu")
        .task(id: dotaz) { await hledej() }
        .navigationTitle(nadpis)
    }

    @MainActor
    private func hledej() async {
        let q = dotaz.trimmingCharacters(in: .whitespaces)
        guard q.filter({ !$0.isWhitespace }).count >= 3 else { vysledky = []; hledanoPro = ""; return }
        try? await Task.sleep(nanoseconds: 300_000_000)   // počkat, až člověk dopíše
        if Task.isCancelled { return }
        hleda = true
        defer { hleda = false }
        do {
            vysledky = try await API.shared.adresy(q)
            hledanoPro = q
            chyba = nil
        } catch {
            if !Task.isCancelled { chyba = error.localizedDescription }
        }
    }

    @MainActor
    private func pouzijPolohu() async {
        zjistujePolohu = true
        defer { zjistujePolohu = false }
        do {
            let l = try await poloha.zjisti()
            let lat = l.coordinate.latitude, lon = l.coordinate.longitude
            let obec = try? await API.shared.seniorExpres(lat: lat, lon: lon)
            guard let kod = obec?.kod_obce else {
                chyba = "Tato poloha není v Karlovarském kraji. Napište adresu, například Abertamy 115."
                return
            }
            chyba = nil
            priVyberu(Misto(popis: "Moje poloha", lat: lat, lon: lon, kodObce: kod))
        } catch {
            chyba = error.localizedDescription
        }
    }
}
