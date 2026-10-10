//  SpojeniView.swift – spoje tam a zpět (GET /spojeni) v kartách. Pořadí podle toho, na čem záleží:
//  kam jedu → kdy jede poslední spoj zpátky domů (nebo že to nejde + jiný den + Senior Expres) → den a doba
//  na místě → spoje. Jednoduchý režim: bez ovládání, spoje tam i zpátky pod sebou, „Uložit jako Můj lékař“.

import SwiftUI

struct SpojeniView: View {
    @Environment(Stav.self) private var stav
    let cilId: String
    let nazevPredem: String
    @State private var kdy: Date

    @State private var pobyt = 45
    @State private var smer = 0              // 0 = tam, 1 = zpět
    @State private var data: Spojeni?
    @State private var nacita = true
    @State private var chyba: String?
    @State private var smsPro: Spoj?
    @State private var vyberCasu = false
    @State private var nactenyKlic: String?

    init(cil: Cil, kdy: Date) {
        cilId = cil.id
        nazevPredem = cil.nazev
        _kdy = State(initialValue: kdy)
    }

    init(cilId: String, nazev: String, kdy: Date) {
        self.cilId = cilId
        nazevPredem = nazev
        _kdy = State(initialValue: kdy)
    }

    private var klic: String { "\(API.datum(kdy)) \(API.cas(kdy)) \(pobyt)" }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let c = data?.cil {
                    CilKarta(cil: c)
                } else {
                    Text(nazevPredem).font(.title2.weight(.bold))
                }

                if nacita {
                    Nacitani().karta()
                } else if let chyba {
                    VStack(alignment: .leading, spacing: 12) {
                        Pruh(druh: .chyba, ikona: "wifi.slash", text: "Teď nemůžeme zjistit spoje.")
                        Text(chyba).foregroundStyle(Color.ink2)
                        Button { Task { await nacti() } } label: {
                            Text("Zkusit znovu").frame(maxWidth: .infinity).minCil()
                        }
                        .buttonStyle(.borderedProminent)
                    }
                } else if let d = data {
                    vysledky(d)
                }

                Text("Podle jízdních řádů CIS JŘ. Spoje počítá Dojedeme z otevřených dat.")
                    .font(.footnote)
                    .foregroundStyle(Color.ink2)
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Spojení")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if let c = data?.cil, !stav.jednoduchy {
                    Button {
                        stav.prepniUlozeni(c)
                    } label: {
                        Image(systemName: stav.jeUlozene(c.id) ? "star.fill" : "star")
                    }
                    .accessibilityLabel(stav.jeUlozene(c.id) ? "Odebrat z Mých míst" : "Uložit do Mých míst")
                }
            }
        }
        .sensoryFeedback(.selection, trigger: stav.mojeMista.count)
        .task(id: klic) { if nactenyKlic != klic { await nacti() } }
        .sheet(item: $smsPro) { spoj in
            PoslatSMS(parametry: parametry(pro: spoj))
        }
        .sheet(isPresented: $vyberCasu) {
            VyberCasu(kdy: $kdy)
                .presentationDetents([.medium, .large])
        }
    }

    // MARK: výsledky

    @ViewBuilder private func vysledky(_ d: Spojeni) -> some View {
        // 1. odpověď na otázku „dostanu se zpátky domů?“ (když tam nic nejede, řeší to karta níž)
        if !d.tam.isEmpty || d.jen_pesky {
            PruhZpet(spojeni: d, kdy: kdy)
        }
        if !d.zpet_mozne && !d.jen_pesky && !d.tam.isEmpty {
            jinyDenTlacitko(prominentni: true)
            seniorExpres(d)
        }

        // 2. kdy a jak dlouho
        if stav.jednoduchy {
            Button { vyberCasu = true } label: {
                Label("Spoje \(Format.denACas(kdy)). Změnit den", systemImage: "calendar")
                    .font(.headline)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .minCil()
            }
            .buttonStyle(.bordered)
        } else {
            ovladani
        }

        // 3. spoje
        if d.jen_pesky, let s = d.tam.first {
            Text("Sem dojdete pěšky asi za \(Format.doba(s.minut)).").font(.headline).karta()
        } else if d.tam.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Label(Calendar.current.isDateInToday(kdy) ? "Dnes už sem spoj nejede." : "V tento den sem spoj nejede.",
                      systemImage: "bus")
                    .font(.headline)
                Text("Zkuste jiný den.").foregroundStyle(Color.ink2)
                jinyDenTlacitko(prominentni: true)
            }
            .karta()
        } else if stav.jednoduchy {
            NadpisSekce(text: "Tam")
            seznamSpoju(Array(d.tam.prefix(3)), d: d, tam: true)
            NadpisSekce(text: "Zpátky domů")
            if d.zpet.isEmpty {
                Text("Zpátky už v ten den nic nejede.").font(.headline).karta()
            } else {
                seznamSpoju(Array(d.zpet.prefix(3)), d: d, tam: false)
            }
            ulozitJakoMujLekar(d.cil)
        } else {
            Picker("Směr", selection: $smer) {
                Text("Tam").tag(0)
                Text("Zpátky domů").tag(1)
            }
            .pickerStyle(.segmented)
            .accessibilityLabel("Spoje tam, nebo zpátky domů")

            Text(smer == 0 ? "Spoje tam, \(d.den)" : "Zpátky domů od \(d.zpet_od ?? "")")
                .font(.headline)
                .foregroundStyle(Color.ink2)
                .accessibilityAddTraits(.isHeader)

            let spoje = smer == 0 ? d.tam : d.zpet
            if spoje.isEmpty {
                Text(smer == 0 ? "Žádný spoj tam." : "Zpátky už v ten den nic nejede.").font(.headline).karta()
            } else {
                seznamSpoju(spoje, d: d, tam: smer == 0)
            }
            if smer == 1 {
                Paticka(text: "Počítáme s tím, že na místě budete \(Format.doba(pobyt)).")
            }
            if smer == 0, let prvni = d.tam.first {
                Button { smsPro = prvni } label: {
                    Label("Poslat SMS seniorovi", systemImage: "message")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .minCil()
                }
                .buttonStyle(.bordered)
            }
        }

        if d.zpet_mozne || d.jen_pesky || d.tam.isEmpty {
            seniorExpres(d)
        }
    }

    private func seznamSpoju(_ spoje: [Spoj], d: Spojeni, tam: Bool) -> some View {
        ForEach(Array(spoje.enumerated()), id: \.offset) { i, s in
            NavigationLink {
                DetailSpoje(spoj: s, cil: d.cil, datum: d.datum, tam: tam) { smsPro = s }
            } label: {
                SpojKarta(spoj: s, tam: tam, prvni: i == 0)
            }
            .buttonStyle(.plain)
        }
    }

    @ViewBuilder private func seniorExpres(_ d: Spojeni) -> some View {
        ForEach(d.senior_expres, id: \.self) { s in
            SeniorExpresKarta(sluzba: s).karta()
        }
    }

    private func jinyDenTlacitko(prominentni: Bool) -> some View {
        let jiny = Format.dalsiPracovniDen(po: kdy)
        return Group {
            if prominentni {
                Button { kdy = jiny } label: {
                    Text("Hledat \(Format.den(jiny))").font(.headline).frame(maxWidth: .infinity).minCil()
                }
                .buttonStyle(.borderedProminent)
            } else {
                Button { kdy = jiny } label: {
                    Text("Hledat \(Format.den(jiny))").font(.headline).frame(maxWidth: .infinity).minCil()
                }
                .buttonStyle(.bordered)
            }
        }
    }

    @ViewBuilder private func ulozitJakoMujLekar(_ c: Cil) -> some View {
        let ulozeno = stav.jeUlozene(c.id)
        let lekar = MojeMisto(id: c.id, nazev: c.nazev, typ: c.typ).jeLekar
        Button { stav.prepniUlozeni(c) } label: {
            Label(ulozeno ? (lekar ? "Uloženo jako Můj lékař" : "Uloženo do Mých míst")
                          : (lekar ? "Uložit jako Můj lékař" : "Uložit do Mých míst"),
                  systemImage: ulozeno ? "star.fill" : "star")
                .font(.headline)
                .frame(maxWidth: .infinity, alignment: .leading)
                .minCil()
        }
        .buttonStyle(.bordered)
    }

    /// Den a čas odjezdu a doba na místě: stejné řádky jako karta Odkud / Kdy na hlavní obrazovce.
    private var ovladani: some View {
        Karta {
            VStack(spacing: 0) {
                Button { vyberCasu = true } label: {
                    RadekVolby(ikona: "clock.fill", nadpis: "Odjezd od", hodnota: Format.velke(Format.denACas(kdy)))
                }
                .buttonStyle(.plain)
                Divider().padding(.leading, 44)
                Menu {
                    Picker("Jak dlouho tam budete", selection: $pobyt) {
                        ForEach([30, 45, 60, 90, 120, 180], id: \.self) { Text(Format.doba($0)).tag($0) }
                    }
                } label: {
                    RadekVolby(ikona: "hourglass", nadpis: "Jak dlouho tam budete", hodnota: Format.doba(pobyt))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func parametry(pro spoj: Spoj) -> [String: String] {
        guard let z = stav.bydliste else { return [:] }
        var p = API.parametrySpojeni(odkud: z, cilId: cilId, kdy: kdy, pobyt: pobyt)
        p["datum"] = data?.datum ?? API.datum(kdy)
        p["cas"] = spoj.odjezd      // SMS popíše právě tento spoj (když senior bydlí jinde, server hledá z jeho bydliště)
        p["cas_hledani"] = API.cas(kdy)
        return p
    }

    @MainActor
    private func nacti() async {
        guard let z = stav.bydliste else { return }
        nacita = true
        defer { nacita = false }
        let hledany = klic
        do {
            data = try await API.shared.spojeni(odkud: z, cilId: cilId, kdy: kdy, pobyt: pobyt)
            nactenyKlic = hledany
            chyba = nil
        } catch is CancellationError {
        } catch {
            chyba = error.localizedDescription
        }
    }
}

extension Spoj: Identifiable {
    var id: String { "\(odjezd)-\(prijezd)-\(useky.count)" }
}
