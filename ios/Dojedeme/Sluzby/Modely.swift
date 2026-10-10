//  Modely.swift – odpovědi API https://dojedeme.cz (popis: backend/API.md).
//  Časy jsou řetězce "H:MM", data "RRRR-MM-DD". Názvy polí odpovídají JSONu serveru.

import Foundation

/// Chyba pro člověka: text z pole `chyba` odpovědi serveru, nebo náš vlastní.
struct ApiChyba: Error, LocalizedError, Decodable {
    let chyba: String
    var errorDescription: String? { chyba }
}

/// Místo z /cile (lékař, nemocnice, úřad…). S polohou uživatele obsahuje i nejbližší spoj.
struct Cil: Codable, Identifiable, Hashable {
    let id: String
    let typ: String?
    let typ_nazev: String?
    let nazev: String
    let adresa: String?
    let obec: String?
    let kod_obce: String?
    let lat: Double
    let lon: Double
    let telefon: [String]?
    let web: String?
    let hodiny: String?
    let nabira: Bool?
    let role: String?          // u úřadů: „Úřad vaší obce“, „Úřad obce s rozšířenou působností“
    let odjezd: String?
    let prijezd: String?
    let cesta_min: Int?
    let prestupy: Int?
    let dostupne: Bool?
}

struct SeznamCilu: Decodable {
    let pocet: Int
    let cile: [Cil]
}

struct Bod: Codable, Hashable {
    let nazev: String?
    let lat: Double?
    let lon: Double?
}

struct Mezizastavka: Codable, Hashable {
    let nazev: String
    let cas: String
}

/// Úsek cesty: typ = pesky | bus | vlak | tramvaj | trolejbus
struct Usek: Codable, Hashable {
    let typ: String
    let minut: Int?
    let linka: String?
    let smer: String?
    let dopravce: String?
    let z: Bod?
    let doBod: Bod?
    let odjezd: String?
    let prijezd: String?
    let mezizastavky: [Mezizastavka]?

    enum CodingKeys: String, CodingKey {
        case typ, minut, linka, smer, dopravce, z, odjezd, prijezd, mezizastavky
        case doBod = "do"   // „do“ je ve Swiftu klíčové slovo
    }

    var jePesky: Bool { typ == "pesky" }
}

struct Spoj: Codable, Hashable {
    let odjezd: String
    let prijezd: String
    let minut: Int
    let prestupy: Int
    let useky: [Usek]

    var jizdy: [Usek] { useky.filter { !$0.jePesky } }
    /// Odjezd prvního autobusu nebo vlaku (stejný čas píše SMS). `odjezd` je odchod z domu nebo od lékaře.
    var odjezdSpoje: String { jizdy.first?.odjezd ?? odjezd }
    var peskyMinut: Int { useky.filter(\.jePesky).compactMap(\.minut).reduce(0, +) }
    /// Zastávka, kde se nastupuje do prvního spoje.
    var nastupniZastavka: String? { jizdy.first?.z?.nazev }
}

struct SeniorExpres: Codable, Hashable {
    let obec: String?
    let nazev: String
    let telefon: String?
    let provozovatel: String?
    let podminky: String?
    let cena: String?
    let provoz: String?
    let zdroj: String?
}

struct Spojeni: Decodable {
    struct Odkud: Decodable { let lat: Double; let lon: Double; let obec: String? }
    let datum: String
    let den: String
    let z: Odkud
    let cil: Cil
    let tam: [Spoj]
    let zpet_od: String?
    let zpet: [Spoj]
    let posledni_zpet: Spoj?     // vždy zobrazit „Poslední spoj zpět …“
    let zpet_mozne: Bool         // false → „V tento den se zpátky nedostanete“ + Senior Expres
    let jen_pesky: Bool
    let senior_expres: [SeniorExpres]
}

struct TextSMS: Decodable {
    let text: String
    let znaku: Int
    let sms: Int
}

struct Adresa: Decodable, Identifiable, Hashable {
    let adresa: String
    let lat: Double
    let lon: Double
    let kod_obce: String?
    var id: String { "\(adresa)|\(lat)|\(lon)" }
}

struct NalezeneAdresy: Decodable {
    let adresy: [Adresa]
}

struct SeniorExpresObce: Decodable {
    let kod_obce: String?
    let sluzby: [SeniorExpres]
}

struct Zdravi: Decodable {
    struct JizdniRady: Decodable { let plati_do: String? }
    let jizdni_rady: JizdniRady?
}

// MARK: - Systém pro blízké (účty, senioři, SMS)

struct Overeni: Codable, Hashable {
    let kod: String
    let sms: String?
    let plati_do: String?
}

struct ZkratkaSeniora: Codable, Hashable {
    let kod: String
    let cil_id: String
    let popis: String?
    let nazev: String?
    let obec: String?
}

struct Senior: Decodable, Identifiable, Hashable {
    let telefon: String
    let aktivni: Bool
    let overeno: Bool
    let bydliste_lat: Double?
    let bydliste_lon: Double?
    let bydliste_popis: String?
    let zkratky: [ZkratkaSeniora]
    let overeni: Overeni?
    var id: String { telefon }
}

struct Ucet: Decodable {
    let prihlasen: Bool
    let email: String?
    let seniori: [Senior]?
    let cislo_sluzby: String?    // soukromé číslo služby: jen přihlášenému správci, nikde veřejně
}

/// Tělo PUT /sms/profil/{telefon} (založení i úprava).
struct ProfilPUT: Encodable {
    struct Bydliste: Encodable { let lat: Double; let lon: Double; let popis: String }
    struct Zkratka: Encodable { let kod: String; let cil_id: String; let popis: String }
    let bydliste: Bydliste
    let souhlas: Bool
    let zkratky: [Zkratka]
}

struct ProfilOdpoved: Decodable {
    let telefon: String
    let overeno: Bool
    let overeni: Overeni?
    let cislo_sluzby: String?
}

struct NovyKod: Decodable {
    let overeni: Overeni
    let cislo_sluzby: String?
}

struct Karticka: Decodable {
    let text: String
}

struct PoslanySpoj: Decodable {
    let telefon: String
    let text: String
    let stav: String
    let fronta: Bool
}
