//  Nastaveni.swift – bydliště, režim, Moje místa a o aplikaci (platnost jízdních řádů, odkaz na zdroje dat na webu).

import SwiftUI

struct Nastaveni: View {
    @Environment(Stav.self) private var stav
    @State private var platiDo: String?

    var body: some View {
        @Bindable var stav = stav
        NavigationStack {
            List {
                Section("Bydliště") {
                    if let b = stav.bydliste { Text(b.popis) }
                    NavigationLink("Změnit bydliště") { ZmenaBydliste() }
                        .frame(minHeight: 44)
                }

                Section {
                    Toggle("Jednoduchý režim", isOn: $stav.jednoduchy)
                        .frame(minHeight: 44)
                } footer: {
                    Text("Větší písmo, velká tlačítka a jen to nejdůležitější. Vrátíte se přes tlačítko Pomoc.")
                }

                Section("Moje místa") {
                    if stav.mojeMista.isEmpty {
                        Text("Zatím žádná. Místo uložíte hvězdičkou u spojení.").foregroundStyle(Color.ink2)
                    }
                    ForEach(stav.mojeMista) { m in
                        VStack(alignment: .leading) {
                            Text(m.nazev).font(.headline)
                            if let o = m.obec { Text(o).font(.callout).foregroundStyle(Color.ink2) }
                        }
                    }
                    .onDelete { stav.mojeMista.remove(atOffsets: $0) }
                }

                // Zdroje dat jen jako odkaz na web: licence CC BY (DATA ZÁPAD, ÚZIS, RÚIAN) chtějí uvedení zdroje.
                Section("O aplikaci") {
                    if let platiDo, let d = Format.datum(platiDo) {
                        let c = Calendar.current.dateComponents([.day, .month, .year], from: d)
                        Text("Jízdní řády platí do \(c.day ?? 0).\(Format.nbsp)\(c.month ?? 0).\(Format.nbsp)\(String(c.year ?? 0)).")
                    }
                    Link("Web Dojedeme", destination: URL(string: "https://dojedeme.cz")!)
                        .frame(minHeight: 44)
                    Link("Zdroje dat", destination: URL(string: "https://dojedeme.cz/mapa#data")!)
                        .frame(minHeight: 44)
                }
            }
            .navigationTitle("Nastavení")
            .task { platiDo = await API.shared.platnostJizdnichRadu() }
        }
    }
}
