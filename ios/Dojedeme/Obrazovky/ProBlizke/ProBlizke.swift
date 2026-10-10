//  ProBlizke.swift – systém pro blízké (stejný jako web /system): přihlášení e-mailem a heslem,
//  přehled seniorů, přidání a spárování čísla kódem, kartička, smazání. Relace = cookie (API.swift).

import SwiftUI

struct ProBlizke: View {
    @State private var ucet: Ucet?
    @State private var chyba: String?

    var body: some View {
        NavigationStack {
            Group {
                if let ucet {
                    if ucet.prihlasen {
                        PrehledSenioru(ucet: ucet, obnov: nacti)
                    } else {
                        Prihlaseni(hotovo: nacti)
                    }
                } else if let chyba {
                    ContentUnavailableView {
                        Label("Systém se nepodařilo načíst", systemImage: "wifi.slash")
                    } description: {
                        Text(chyba)
                    } actions: {
                        Button("Zkusit znovu") { Task { await nacti() } }
                    }
                } else {
                    ProgressView("Načítáme…")
                }
            }
            .navigationTitle("Pro blízké")
        }
        .task { await nacti() }
    }

    @MainActor
    private func nacti() async {
        do {
            ucet = try await API.shared.ucet()
            chyba = nil
        } catch is CancellationError {
        } catch {
            if ucet == nil { chyba = error.localizedDescription }
        }
    }
}

// MARK: - Přihlášení a nový účet

struct Prihlaseni: View {
    var hotovo: () async -> Void
    /// true = jen pole a tlačítko (uvnitř jiného formuláře, např. Poslat SMS seniorovi)
    var kratce = false
    @State private var novy = false
    @State private var email = ""
    @State private var heslo = ""
    @State private var chyba: String?
    @State private var posila = false

    var body: some View {
        if kratce {
            pole
        } else {
            Form {
                Section {
                    Label("SMS služba pro blízké", systemImage: "person.2.fill")
                        .font(.title3.weight(.bold))
                        .foregroundStyle(Color.accentColor)
                    Text("Senior bez chytrého telefonu pošle obyčejnou SMS a přijde mu spoj k lékaři a zpátky. Vy mu službu jednou nastavíte.")
                    VStack(alignment: .leading, spacing: 6) {
                        Text("1. Přidáte číslo seniora a místa, kam jezdí.")
                        Text("2. Senior jednou pošle SMS s kódem.")
                        Text("3. Pak pošle *11 a přijde mu spoj tam i zpátky.")
                    }
                    .font(.callout)
                    .foregroundStyle(Color.ink2)
                }
                pole
            }
        }
    }

    @ViewBuilder private var pole: some View {
            Section {
                Picker("Účet", selection: $novy) {
                    Text("Přihlášení").tag(false)
                    Text("Nový účet").tag(true)
                }
                .pickerStyle(.segmented)
                TextField("E-mail", text: $email)
                    .textContentType(.username)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .frame(minHeight: 44)
                SecureField("Heslo", text: $heslo)
                    .textContentType(novy ? .newPassword : .password)
                    .frame(minHeight: 44)
            } footer: {
                if novy { Text("E-mail slouží jen k přihlášení. Nic vám na něj neposíláme.") }
            }
            if let chyba {
                Section { Pruh(druh: .chyba, ikona: "exclamationmark.triangle", text: chyba) }
            }
            Section {
                Button {
                    Task { await odesli() }
                } label: {
                    HStack {
                        Text(novy ? "Založit účet" : "Přihlásit se")
                        if posila { Spacer(); ProgressView() }
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .disabled(posila)
            }
    }

    @MainActor
    private func odesli() async {
        let e = email.trimmingCharacters(in: .whitespaces)
        guard e.contains("@"), !heslo.isEmpty else {
            chyba = "Zadejte e-mail a heslo."
            return
        }
        posila = true
        defer { posila = false }
        do {
            try await API.shared.prihlas(email: e, heslo: heslo, novy: novy)
            chyba = nil
            heslo = ""
            await hotovo()
        } catch {
            chyba = error.localizedDescription
        }
    }
}

// MARK: - Přehled seniorů

struct PrehledSenioru: View {
    @Environment(Stav.self) private var stav
    let ucet: Ucet
    var obnov: () async -> Void
    @State private var pridat = false

    private var seniori: [Senior] { ucet.seniori ?? [] }

    var body: some View {
        List {
            Section {
                Text(souhrn).font(.headline)
                Button { pridat = true } label: {
                    Label("Přidat seniora", systemImage: "person.badge.plus").frame(minHeight: 44)
                }
                Button { stav.zalozka = .spoj } label: {
                    Label("Najít spoj a poslat ho SMS", systemImage: "message").frame(minHeight: 44)
                }
            } footer: {
                Text("Spoj pošlete u nalezeného spojení tlačítkem Poslat SMS seniorovi.")
            }

            if !seniori.isEmpty {
                Section("Moji senioři") {
                    ForEach(seniori) { s in
                        NavigationLink {
                            DetailSeniora(telefon: s.telefon, ucet: ucet, obnov: obnov)
                        } label: {
                            SeniorRadek(senior: s)
                        }
                    }
                }
            }

            Section {
                Button("Odhlásit se", role: .destructive) {
                    Task {
                        try? await API.shared.odhlas()
                        await obnov()
                    }
                }
                .frame(minHeight: 44)
            } footer: {
                if let e = ucet.email { Text("Přihlášeni jako \(e)") }
            }
        }
        .refreshable { await obnov() }
        .sheet(isPresented: $pridat) {
            NavigationStack {
                FormularSeniora(existujici: nil, cisloSluzby: ucet.cislo_sluzby, obnov: obnov)
            }
        }
    }

    private var souhrn: String {
        if seniori.isEmpty { return "Zatím nemáte žádného seniora. Začněte tím, že ho přidáte." }
        let zapnuto = seniori.filter { $0.overeno && $0.aktivni }.count
        let ceka = seniori.filter { !$0.overeno }.count
        var t = "\(Format.senioru(seniori.count)) v systému: zapnuto \(zapnuto)"
        if ceka > 0 { t += ", čeká na potvrzení čísla \(ceka)" }
        return t + "."
    }
}

struct StavSeniora: View {
    let senior: Senior

    var body: some View {
        if !senior.overeno {
            Label("Čeká na potvrzení čísla", systemImage: "hourglass").foregroundStyle(Color("WarningFg"))
        } else if senior.aktivni {
            Label("Zapnuto", systemImage: "checkmark.circle").foregroundStyle(Color("SuccessFg"))
        } else {
            Label("Vypnuto (senior poslal STOP)", systemImage: "pause.circle").foregroundStyle(Color.ink2)
        }
    }
}

struct SeniorRadek: View {
    @Environment(Stav.self) private var stav
    let senior: Senior

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(stav.jmenoSeniora(senior.telefon)).font(.headline)
            if stav.jmenaSenioru[senior.telefon] != nil {
                Text(Format.telefonPlny(senior.telefon)).font(.callout).foregroundStyle(Color.ink2)
            }
            StavSeniora(senior: senior).font(.callout)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}
