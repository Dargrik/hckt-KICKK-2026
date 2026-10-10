//  PoslatSMS.swift – blízký pošle nalezený spoj SMS seniorovi ze svého účtu (POST /ucet/poslat-spoj).
//  Text skládá server ze stejných parametrů jako /spojeni/sms; poslat jde jen potvrzeným seniorům.

import SwiftUI

struct PoslatSMS: View {
    @Environment(Stav.self) private var stav
    @Environment(\.dismiss) private var zavrit
    let parametry: [String: String]

    @State private var ucet: Ucet?
    @State private var nahled: String?
    @State private var vybrany: String?
    @State private var odeslano: PoslanySpoj?
    @State private var chyba: String?
    @State private var posila = false

    var body: some View {
        NavigationStack {
            Form {
                if let ucet {
                    if !ucet.prihlasen {
                        Section {
                            Text("Spoj můžete poslat SMS seniorovi, kterého máte v systému pro blízké. Přihlaste se, spoj zůstane připravený.")
                        }
                        Prihlaseni(hotovo: nacti, kratce: true)
                    } else if (ucet.seniori ?? []).isEmpty {
                        Section {
                            Text("Ve svém účtu zatím nemáte žádného seniora.")
                            Button("Přidat seniora") { stav.zalozka = .blizci; zavrit() }
                        }
                    } else {
                        komu(ucet.seniori ?? [])
                        if !(ucet.seniori ?? []).contains(where: { $0.overeno && $0.aktivni }) {
                            Section {
                                Pruh(druh: .varovani, ikona: "hourglass",
                                     text: "Senior musí nejdřív potvrdit své číslo SMS s kódem. Postup najdete v záložce Pro blízké.")
                            }
                        }
                        if let nahled {
                            Section("Text SMS") { Text(nahled).font(.body) }
                        }
                        if let odeslano {
                            Section {
                                Pruh(druh: .uspech, ikona: "checkmark.circle", text: "SMS jsme poslali: \(stav.jmenoSeniora(odeslano.telefon)).")
                                if odeslano.fronta { Text("Odejde z telefonu služby za chvíli.").foregroundStyle(Color.ink2) }
                            }
                        } else {
                            Section {
                                Button {
                                    Task { await posli() }
                                } label: {
                                    HStack {
                                        Text("Poslat SMS")
                                        if posila { Spacer(); ProgressView() }
                                    }
                                    .frame(maxWidth: .infinity, minHeight: 44)
                                }
                                .buttonStyle(.borderedProminent)
                                .disabled(vybrany == nil || posila)
                            }
                        }
                    }
                } else if chyba == nil {
                    Section { Nacitani(text: "Načítáme váš účet…") }
                }
                if let chyba {
                    Section { Pruh(druh: .chyba, ikona: "exclamationmark.triangle", text: chyba) }
                }
            }
            .navigationTitle("Poslat SMS seniorovi")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Zavřít") { zavrit() } }
            }
            .task { await nacti() }
            .task(id: vybrany) {
                guard let vybrany, ucet != nil else { return }
                if let t = try? await API.shared.textSMS(parametryPro(vybrany)) { nahled = t.text }
            }
        }
    }

    private func komu(_ seniori: [Senior]) -> some View {
        Section("Komu") {
            ForEach(seniori) { s in
                Button {
                    vybrany = s.telefon
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(stav.jmenoSeniora(s.telefon)).font(.headline).foregroundStyle(.primary)
                            if !s.overeno {
                                Text("Čeká na potvrzení čísla").font(.callout).foregroundStyle(Color.ink2)
                            } else if !s.aktivni {
                                Text("Senior si službu vypnul").font(.callout).foregroundStyle(Color.ink2)
                            }
                        }
                        Spacer()
                        if vybrany == s.telefon {
                            Image(systemName: "checkmark").foregroundStyle(Color.accentColor).accessibilityLabel("Vybráno")
                        }
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .disabled(!s.overeno || !s.aktivni || odeslano != nil)
            }
        }
    }

    @MainActor
    private func nacti() async {
        do {
            async let u = API.shared.ucet()
            async let t = API.shared.textSMS(parametry)
            let ucetOdpoved = try await u
            ucet = ucetOdpoved
            nahled = (try? await t)?.text
            let pripraveni = (ucetOdpoved.seniori ?? []).filter { $0.overeno && $0.aktivni }
            if pripraveni.count == 1 { vybrany = pripraveni[0].telefon }
            chyba = nil
        } catch {
            chyba = error.localizedDescription
        }
    }

    /// Spoj pro seniora počítáme z jeho bydliště. Když bydlí jinde než blízký, hledá se od času hledání,
    /// ne od odjezdu spoje, který blízký vybral u sebe.
    private func parametryPro(_ telefon: String) -> [String: String] {
        var p = parametry
        if let s = ucet?.seniori?.first(where: { $0.telefon == telefon }), let la = s.bydliste_lat, let lo = s.bydliste_lon {
            let puvodniLat = Double(p["z_lat"] ?? "") ?? la, puvodniLon = Double(p["z_lon"] ?? "") ?? lo
            if abs(puvodniLat - la) > 0.004 || abs(puvodniLon - lo) > 0.006, let hledani = p["cas_hledani"] {
                p["cas"] = hledani
            }
            p["z_lat"] = "\(la)"
            p["z_lon"] = "\(lo)"
        }
        p["cas_hledani"] = nil
        return p
    }

    @MainActor
    private func posli() async {
        guard let vybrany else { return }
        posila = true
        defer { posila = false }
        do {
            odeslano = try await API.shared.poslatSpoj(telefon: vybrany, parametry: parametryPro(vybrany))
            nahled = odeslano?.text ?? nahled
            chyba = nil
        } catch {
            chyba = error.localizedDescription
        }
    }
}
