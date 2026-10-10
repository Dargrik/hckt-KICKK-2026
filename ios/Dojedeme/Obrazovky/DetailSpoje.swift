//  DetailSpoje.swift – časová osa spoje (pěšky, autobus/vlak, mezizastávky, přestup) a akce:
//  Připomenout odjezd, Poslat blízkému (text), Poslat SMS seniorovi.

import SwiftUI
import UserNotifications

struct DetailSpoje: View {
    @Environment(Stav.self) private var stav
    let spoj: Spoj
    let cil: Cil
    let datum: String
    let tam: Bool
    var poslatSMS: () -> Void

    @State private var hlaseni: String?

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(spoj.odjezdSpoje).font(.largeTitle.bold())
                        Image(systemName: "arrow.right").foregroundStyle(Color.ink2)
                        Text(spoj.prijezd).font(.title2.weight(.semibold)).foregroundStyle(Color.ink2)
                    }
                    .monospacedDigit()
                    Text("\(Format.doba(spoj.minut)), \(Format.prestupy(spoj.prestupy))").font(.callout).foregroundStyle(Color.ink2)
                    Text(tam ? "Do: \(cil.nazev)" : "Z: \(cil.nazev) domů").font(.headline)
                    if spoj.odjezd != spoj.odjezdSpoje {
                        Text(tam ? "Z domu vyjděte \(Format.vCase(spoj.odjezd))." : "Vyjděte \(Format.vCase(spoj.odjezd)).")
                            .font(.callout)
                    }
                }
                .padding(.vertical, 4)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Odjezd \(spoj.odjezdSpoje), příjezd \(spoj.prijezd), \(Format.doba(spoj.minut)), \(Format.prestupy(spoj.prestupy)). \(tam ? "Do" : "Z") \(cil.nazev).")
            }

            Section("Cesta") {
                ForEach(Array(spoj.useky.enumerated()), id: \.offset) { i, u in
                    if i > 0, !u.jePesky, spoj.useky[..<i].contains(where: { !$0.jePesky }) {
                        Label("Přestup", systemImage: "arrow.triangle.swap")
                            .font(.callout.weight(.semibold))
                            .foregroundStyle(Color.ink2)
                    }
                    UsekRadek(usek: u)
                }
            }

            if let hlaseni {
                Section { Pruh(druh: .info, ikona: "bell", text: hlaseni) }
            }

            Section {
                Button {
                    Task {
                        let h = await pripomen()
                        hlaseni = h
                        AccessibilityNotification.Announcement(h).post()
                    }
                } label: {
                    Label("Připomenout odjezd", systemImage: "bell").minCil()
                }
                ShareLink(item: textProBlizkeho) {
                    Label("Poslat blízkému", systemImage: "square.and.arrow.up").minCil()
                }
                if tam && !stav.jednoduchy {
                    Button(action: poslatSMS) {
                        Label("Poslat SMS seniorovi", systemImage: "message").minCil()
                    }
                }
            }
        }
        .navigationTitle("Spoj \(Format.vCase(spoj.odjezdSpoje))")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var textProBlizkeho: String {
        let den = Format.den(Format.datum(datum) ?? .now)
        let odkud = spoj.nastupniZastavka.map { " ze zastávky \($0)" } ?? ""
        return tam
            ? "Jedu \(den) do: \(cil.nazev). Odjezd \(spoj.odjezdSpoje)\(odkud), příjezd \(spoj.prijezd). Spoj našlo Dojedeme."
            : "Jedu \(den) domů z: \(cil.nazev). Odjezd \(spoj.odjezdSpoje)\(odkud), doma \(spoj.prijezd). Spoj našlo Dojedeme."
    }

    /// Lokální oznámení 15 minut před odjezdem.
    private func pripomen() async -> String {
        guard let odjezd = Format.datum(datum, cas: spoj.odjezd) else { return "Čas odjezdu se nepodařilo přečíst." }
        let kdy = odjezd.addingTimeInterval(-15 * 60)
        guard kdy > .now else { return "Spoj odjíždí za méně než 15 minut." }
        let centrum = UNUserNotificationCenter.current()
        let povoleno = (try? await centrum.requestAuthorization(options: [.alert, .sound])) ?? false
        guard povoleno else { return "Připomínku nejde nastavit. Povolte oznámení pro Dojedeme v Nastavení telefonu." }
        let obsah = UNMutableNotificationContent()
        obsah.title = tam ? "Za 15 minut vyjděte z domu" : "Za 15 minut vyjděte na spoj domů"
        obsah.body = "Odjezd \(spoj.odjezdSpoje)" + (spoj.nastupniZastavka.map { " ze zastávky \($0)" } ?? "") + "."
        obsah.sound = .default
        let slozky = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: kdy)
        let pozadavek = UNNotificationRequest(identifier: "odjezd-\(datum)-\(spoj.odjezd)", content: obsah,
                                              trigger: UNCalendarNotificationTrigger(dateMatching: slozky, repeats: false))
        do {
            try await centrum.add(pozadavek)
            return "Připomeneme vám to \(Format.den(kdy)) \(Format.vCase(API.cas(kdy)))."
        } catch {
            return "Připomínku se nepodařilo uložit."
        }
    }
}

/// Jeden úsek na časové ose.
struct UsekRadek: View {
    let usek: Usek

    var body: some View {
        if usek.jePesky {
            Label {
                Text(popisChuze)
            } icon: {
                Image(systemName: "figure.walk")
            }
            .font(.callout)
            .frame(minHeight: 44)
        } else {
            VStack(alignment: .leading, spacing: 6) {
                let druh = Format.druh(usek.typ)
                Label("\(druh.nazev)\(usek.linka.map { " \($0)" } ?? "")", systemImage: druh.ikona)
                    .font(.headline)
                if let smer = usek.smer { Text("směr \(smer)").font(.callout).foregroundStyle(Color.ink2) }
                casZastavka(usek.odjezd, usek.z?.nazev, "odjezd")
                if let m = usek.mezizastavky, !m.isEmpty {
                    DisclosureGroup("Zastávky cestou (\(m.count))") {
                        ForEach(Array(m.enumerated()), id: \.offset) { _, z in
                            HStack(alignment: .firstTextBaseline) {
                                Text(z.cas).monospacedDigit().frame(minWidth: 52, alignment: .leading)
                                Text(z.nazev)
                            }
                            .font(.callout)
                        }
                    }
                    .font(.callout)
                }
                casZastavka(usek.prijezd, usek.doBod?.nazev, "příjezd")
                if let d = usek.dopravce { Text(d).font(.footnote).foregroundStyle(Color.ink3) }
            }
            .padding(.vertical, 4)
        }
    }

    private var popisChuze: String {
        let doba = "\(Format.doba(usek.minut ?? 0)) pěšky"
        if let kam = usek.doBod?.nazev { return "\(doba) na zastávku \(kam)" }
        if let odkud = usek.z?.nazev { return "\(doba) ze zastávky \(odkud)" }
        return doba
    }

    private func casZastavka(_ cas: String?, _ zastavka: String?, _ popis: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(cas ?? "").font(.title3.bold()).monospacedDigit().frame(minWidth: 56, alignment: .leading)
            Text(zastavka ?? "").font(.body)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(popis) \(cas ?? ""), \(zastavka ?? "")")
    }
}
