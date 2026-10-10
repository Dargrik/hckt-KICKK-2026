//  SeznamMist.swift – místa seřazená podle spojení z bydliště (GET /cile), nikdy podle kilometrů.
//  S `priVyberu` slouží jako výběr místa (předvolby seniora v systému pro blízké).

import SwiftUI

struct SeznamMist: View {
    @Environment(Stav.self) private var stav
    let dotaz: DotazMist
    let kdy: Date
    var odkud: Misto? = nil
    var priVyberu: ((Cil) -> Void)? = nil

    @State private var cile: [Cil] = []
    @State private var nacita = true
    @State private var chyba: String?

    var body: some View {
        List {
            if let p = dotaz.popis {
                Section { Text(p).foregroundStyle(Color.ink2) }
            }
            if nacita {
                Section { Nacitani() }
            } else if let chyba {
                Section {
                    ContentUnavailableView {
                        Label("Seznam se nepodařilo načíst", systemImage: "wifi.slash")
                    } description: {
                        Text(chyba)
                    } actions: {
                        Button("Zkusit znovu") { Task { await nacti() } }
                    }
                }
            } else if cile.isEmpty {
                Section {
                    ContentUnavailableView("Nic jsme nenašli", systemImage: "magnifyingglass",
                                           description: Text("V dosahu teď takové místo není. Zkuste jiný den nebo jiný obor."))
                }
            } else {
                Section {
                    ForEach(cile) { c in
                        if let priVyberu {
                            Button { priVyberu(c) } label: { CilRadek(cil: c).foregroundStyle(.primary) }
                        } else {
                            NavigationLink { SpojeniView(cil: c, kdy: kdy) } label: { CilRadek(cil: c) }
                        }
                    }
                } footer: {
                    Text("Seřazeno podle toho, kdy tam budete, když vyjedete \(Format.denACas(kdy)).")
                }
            }
        }
        .navigationTitle(dotaz.nadpis)
        .task { if cile.isEmpty && chyba == nil { await nacti() } }
        .refreshable { await nacti(zobrazitNacitani: false) }
    }

    @MainActor
    private func nacti(zobrazitNacitani: Bool = true) async {
        guard let z = odkud ?? stav.bydliste else { return }
        if zobrazitNacitani { nacita = true }
        defer { nacita = false }
        do {
            cile = try await API.shared.cile(typ: dotaz.typ, odkud: z, kdy: kdy, nabira: dotaz.nabira, urady: dotaz.urady)
            chyba = nil
        } catch is CancellationError {
        } catch {
            chyba = error.localizedDescription
        }
    }
}
