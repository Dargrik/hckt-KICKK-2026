//  Format.swift – formáty podle design/BRAND.md (kap. 5): čas 7:42, „ve 14:35“, 38 min, 1 h 15 min,
//  bez přestupu / 1 přestup / 2 přestupy, telefon 736 647 582, datum „v pondělí 12. 10.“

import Foundation

enum Format {
    static let nbsp = "\u{00A0}"

    static func doba(_ minut: Int) -> String {
        if minut < 60 { return "\(minut)\(nbsp)min" }
        let h = minut / 60, m = minut % 60
        return m == 0 ? "\(h)\(nbsp)h" : "\(h)\(nbsp)h \(m)\(nbsp)min"
    }

    static func prestupy(_ n: Int) -> String {
        switch n {
        case 0: return "bez přestupu"
        case 1: return "1 přestup"
        case 2...4: return "\(n) přestupy"
        default: return "\(n) přestupů"
        }
    }

    /// „v 7:42“, „ve 14:35“
    static func vCase(_ cas: String) -> String {
        let h = Int(cas.split(separator: ":").first ?? "") ?? 0
        return ([2, 3, 4, 12, 13, 14, 20, 21, 22, 23].contains(h) ? "ve" : "v") + nbsp + cas
    }

    /// 736 647 582 (bez +420)
    static func telefon(_ t: String) -> String {
        var c = t.filter(\.isNumber)
        if c.count == 12, c.hasPrefix("420") { c.removeFirst(3) }
        guard c.count == 9 else { return t }
        let a = Array(c)
        return "\(String(a[0..<3]))\(nbsp)\(String(a[3..<6]))\(nbsp)\(String(a[6..<9]))"
    }

    /// +420 736 647 582
    static func telefonPlny(_ t: String) -> String {
        let kratky = telefon(t)
        return kratky == t ? t : "+420\(nbsp)\(kratky)"
    }

    static func telURL(_ t: String) -> URL? {
        URL(string: "tel:" + t.filter { $0.isNumber || $0 == "+" })
    }

    private static let dnyV = ["v neděli", "v pondělí", "v úterý", "ve středu", "ve čtvrtek", "v pátek", "v sobotu"]

    /// „dnes“, „zítra“, „v pondělí 12. 10.“
    static func den(_ d: Date) -> String {
        let k = Calendar.current
        if k.isDateInToday(d) { return "dnes" }
        if k.isDateInTomorrow(d) { return "zítra" }
        let c = k.dateComponents([.weekday, .day, .month], from: d)
        return "\(dnyV[(c.weekday ?? 1) - 1]) \(c.day ?? 1).\(nbsp)\(c.month ?? 1)."
    }

    /// „dnes v 7:00“, „zítra ve 13:30“
    static func denACas(_ d: Date) -> String { "\(den(d)) \(vCase(API.cas(d)))" }

    /// Datum z API („2026-10-12“) a čas („6:25“) → Date.
    static func datum(_ iso: String, cas: String? = nil) -> Date? {
        let d = iso.split(separator: "-").compactMap { Int($0) }
        guard d.count == 3 else { return nil }
        var c = DateComponents(year: d[0], month: d[1], day: d[2])
        if let cas {
            let t = cas.split(separator: ":").compactMap { Int($0) }
            if t.count == 2 { c.hour = t[0]; c.minute = t[1] }
        }
        return Calendar.current.date(from: c)
    }

    /// Nejbližší pracovní den v 7:00 (zítra a dál) – pro hledání, když dnes nic nejede.
    static func dalsiPracovniDen(po d: Date = .now) -> Date {
        let k = Calendar.current
        var den = k.startOfDay(for: k.date(byAdding: .day, value: 1, to: d) ?? d)
        while k.isDateInWeekend(den) { den = k.date(byAdding: .day, value: 1, to: den) ?? den }
        return k.date(bySettingHour: 7, minute: 0, second: 0, of: den) ?? den
    }

    /// Výchozí čas hledání: teď, jen o víkendu a večer (po 19:00) až další pracovní den v 7:00.
    static func vychoziCas(_ ted: Date = .now) -> Date {
        let k = Calendar.current
        return k.isDateInWeekend(ted) || k.component(.hour, from: ted) >= 19 ? dalsiPracovniDen(po: ted) : ted
    }

    /// Jednoduchý režim: odpoledne už rovnou další pracovní den, aby senior neviděl „dnes se nevrátíte“.
    static func vychoziCasJednoduchy(_ ted: Date = .now) -> Date {
        let k = Calendar.current
        return k.isDateInWeekend(ted) || k.component(.hour, from: ted) >= 12 ? dalsiPracovniDen(po: ted) : ted
    }

    /// Rychlé volby času: teď a dva nejbližší pracovní dny v 7:00.
    struct RychlaVolba: Hashable {
        let nazev: String
        let cas: Date
    }

    static func rychleVolby(_ ted: Date = .now) -> [RychlaVolba] {
        let prvni = dalsiPracovniDen(po: ted)
        let druhy = dalsiPracovniDen(po: prvni)
        return [RychlaVolba(nazev: "Teď", cas: ted),
                RychlaVolba(nazev: velke(denACas(prvni)), cas: prvni),
                RychlaVolba(nazev: velke(denACas(druhy)), cas: druhy)]
    }

    static func ikonaCile(_ typ: String?) -> String {
        switch typ ?? "" {
        case "praktik", "pediatr", "gynekolog", "ocni", "psychiatr", "endokrinolog", "rehabilitace": return "stethoscope"
        case "zubar", "zubni_pohotovost", "dentalni_hygiena": return "mouth"
        case "nemocnice": return "cross.case"
        case "pohotovost", "pohotovost_chirurgie", "lekarenska_pohotovost": return "staroflife"
        case "obecni_urad", "urad_orp", "matrika": return "building.columns"
        default: return "mappin.and.ellipse"
        }
    }

    /// Otevírací doba ze serveru („po: 16:00-21:00; ut: …“) do čitelných řádků.
    static func hodiny(_ text: String) -> [String] {
        let nazvy = ["po": "pondělí", "ut": "úterý", "st": "středa", "ct": "čtvrtek", "pa": "pátek",
                     "so": "sobota", "ne": "neděle", "svatek": "svátky"]
        return text.split(separator: ";").map { cast in
            let s = cast.trimmingCharacters(in: .whitespaces)
            guard let i = s.firstIndex(of: ":") else { return s }
            let den = String(s[..<i]).lowercased()
            let cas = s[s.index(after: i)...].trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "-", with: "–")
            return "\(nazvy[den] ?? den) \(cas)"
        }
    }

    static func druh(_ typ: String) -> (nazev: String, ikona: String) {
        switch typ {
        case "vlak": return ("Vlak", "train.side.front.car")
        case "tramvaj": return ("Tramvaj", "tram")
        case "trolejbus": return ("Trolejbus", "bus")
        case "pesky": return ("Pěšky", "figure.walk")
        default: return ("Autobus", "bus")
        }
    }

    /// První písmeno velké: „dnes v 7:00“ → „Dnes v 7:00“.
    static func velke(_ s: String) -> String { s.prefix(1).uppercased() + s.dropFirst() }

    static func senioru(_ n: Int) -> String {
        n == 1 ? "1 senior" : (2...4).contains(n) ? "\(n) senioři" : "\(n) seniorů"
    }
}
