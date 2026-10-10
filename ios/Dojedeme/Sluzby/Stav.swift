//  Stav.swift – co si aplikace pamatuje v telefonu: bydliště, režim, Moje místa a jména seniorů.
//  Nic z toho se neposílá na server (kromě bydliště při hledání spoje).

import Foundation
import Observation

/// Bod, odkud se jede (bydliště seniora nebo uživatele).
struct Misto: Codable, Hashable {
    var popis: String
    var lat: Double
    var lon: Double
    var kodObce: String?
}

/// Uložené místo pro rychlé hledání spoje (lékař, nemocnice…).
struct MojeMisto: Codable, Hashable, Identifiable {
    var id: String
    var nazev: String
    var obec: String?
    var typNazev: String?
    var typ: String? = nil

    /// Lékař (ne nemocnice, pohotovost ani úřad) – pro dlaždici „Můj lékař“ v jednoduchém režimu.
    var jeLekar: Bool {
        guard let typ else { return false }
        return !["nemocnice", "pohotovost", "zubni_pohotovost", "pohotovost_chirurgie", "lekarenska_pohotovost",
                 "obecni_urad", "urad_orp", "matrika"].contains(typ)
    }
}

enum Zalozka: Hashable {
    case spoj, blizci, nastaveni
}

@Observable
final class Stav {
    var bydliste: Misto? { didSet { Self.uloz(bydliste, "bydliste") } }
    var jednoduchy: Bool { didSet { UserDefaults.standard.set(jednoduchy, forKey: "jednoduchy") } }
    var uvodHotovy: Bool { didSet { UserDefaults.standard.set(uvodHotovy, forKey: "uvodHotovy") } }
    var mojeMista: [MojeMisto] { didSet { Self.uloz(mojeMista, "mojeMista") } }
    /// Jména seniorů ("+420…": "Děda Josef") jen v tomto telefonu, na server se neposílají.
    var jmenaSenioru: [String: String] { didSet { Self.uloz(jmenaSenioru, "jmenaSenioru") } }

    var zalozka: Zalozka = .spoj
    /// Senior Expres v obci bydliště (načte se po startu a po změně bydliště).
    var seniorExpres: [SeniorExpres] = []

    init() {
        jednoduchy = UserDefaults.standard.bool(forKey: "jednoduchy")
        uvodHotovy = UserDefaults.standard.bool(forKey: "uvodHotovy")
        mojeMista = Self.nacti("mojeMista") ?? []
        jmenaSenioru = Self.nacti("jmenaSenioru") ?? [:]
        bydliste = Self.nacti("bydliste")    // Optional až nakonec (inicializace @Observable)
    }

    func jeUlozene(_ id: String) -> Bool { mojeMista.contains { $0.id == id } }

    func prepniUlozeni(_ cil: Cil) {
        if let i = mojeMista.firstIndex(where: { $0.id == cil.id }) {
            mojeMista.remove(at: i)
        } else {
            mojeMista.insert(MojeMisto(id: cil.id, nazev: cil.nazev, obec: cil.obec, typNazev: cil.typ_nazev, typ: cil.typ), at: 0)
            if mojeMista.count > 8 { mojeMista.removeLast() }
        }
    }

    /// Uložený lékař pro „Můj lékař“ (nejnovější uložený lékař, ne nemocnice).
    var mujLekar: MojeMisto? { mojeMista.first { $0.jeLekar } }

    func jmenoSeniora(_ telefon: String) -> String {
        if let j = jmenaSenioru[telefon], !j.isEmpty { return j }
        return Format.telefonPlny(telefon)
    }

    @MainActor
    func obnovSeniorExpres() async {
        guard let b = bydliste else { seniorExpres = []; return }
        if let s = try? await API.shared.seniorExpres(lat: b.lat, lon: b.lon) {
            seniorExpres = s.sluzby.filter { $0.telefon != nil }
            if bydliste?.kodObce == nil, let kod = s.kod_obce { bydliste?.kodObce = kod }
        }
    }

    private static func uloz<T: Encodable>(_ hodnota: T?, _ klic: String) {
        if let hodnota, let data = try? JSONEncoder().encode(hodnota) {
            UserDefaults.standard.set(data, forKey: klic)
        } else {
            UserDefaults.standard.removeObject(forKey: klic)
        }
    }

    private static func nacti<T: Decodable>(_ klic: String) -> T? {
        guard let data = UserDefaults.standard.data(forKey: klic) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }
}
