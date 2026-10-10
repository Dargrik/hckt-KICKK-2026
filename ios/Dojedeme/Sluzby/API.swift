//  API.swift – klient serveru Dojedeme (backend/API.md).
//  Přihlášení do systému pro blízké drží cookie relace (HttpOnly), kterou URLSession ukládá sama.

import Foundation

final class API {
    static let shared = API()
    let zaklad = URL(string: "https://dojedeme.cz")!

    private let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.httpCookieStorage = .shared
        c.httpCookieAcceptPolicy = .always
        c.httpShouldSetCookies = true
        c.timeoutIntervalForRequest = 30
        return URLSession(configuration: c)
    }()

    // MARK: obecné volání

    private func url(_ cesta: String, _ parametry: [String: String]) -> URL {
        var k = URLComponents(url: zaklad, resolvingAgainstBaseURL: false)!
        k.path = cesta
        if !parametry.isEmpty {
            k.queryItems = parametry.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        return k.url!
    }

    private func proved(_ r: URLRequest) async throws -> Data {
        let data: Data
        let odpoved: URLResponse
        do {
            (data, odpoved) = try await session.data(for: r)
        } catch {
            // zrušené hledání (uživatel mezitím změnil den nebo odešel z obrazovky) není chyba pro člověka
            if Task.isCancelled || (error as? URLError)?.code == .cancelled { throw CancellationError() }
            throw ApiChyba(chyba: "Telefon se teď nemůže spojit se serverem. Zkontrolujte připojení k internetu a zkuste to znovu.")
        }
        let kod = (odpoved as? HTTPURLResponse)?.statusCode ?? 0
        if (200..<300).contains(kod) { return data }
        if kod == 401 || kod == 403 { throw ApiChyba(chyba: "Přihlášení vypršelo. Přihlaste se prosím znovu.") }
        if let chyba = try? JSONDecoder().decode(ApiChyba.self, from: data) { throw chyba }
        throw ApiChyba(chyba: "Server teď neodpovídá. Zkuste to prosím za chvíli.")
    }

    private func dekoduj<T: Decodable>(_ data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw ApiChyba(chyba: "Odpověď serveru se nepodařilo přečíst. Zkuste to prosím znovu.")
        }
    }

    func get<T: Decodable>(_ cesta: String, _ parametry: [String: String] = [:]) async throws -> T {
        let data = try await proved(URLRequest(url: url(cesta, parametry)))
        return try dekoduj(data)
    }

    func posli<T: Decodable, B: Encodable>(_ cesta: String, metoda: String = "POST", telo: B) async throws -> T {
        var r = URLRequest(url: url(cesta, [:]))
        r.httpMethod = metoda
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try JSONEncoder().encode(telo)
        let data = try await proved(r)
        return try dekoduj(data)
    }

    func posliBezTela(_ cesta: String, metoda: String) async throws {
        var r = URLRequest(url: url(cesta, [:]))
        r.httpMethod = metoda
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = Data("{}".utf8)
        _ = try await proved(r)
    }

    // MARK: formáty parametrů

    static func datum(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year ?? 2026, c.month ?? 1, c.day ?? 1)
    }

    static func cas(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: d)
        return String(format: "%d:%02d", c.hour ?? 0, c.minute ?? 0)
    }

    /// Telefon do adresy: jen číslice (server doplní +420), „+“ by se v cestě muselo kódovat.
    static func telefonDoCesty(_ t: String) -> String { t.filter(\.isNumber) }

    // MARK: místa a spoje

    /// Místa daného typu seřazená podle spojení z bodu `odkud` (nikdy podle kilometrů).
    func cile(typ: String, odkud: Misto, kdy: Date, nabira: Bool = false, urady: Bool = false, limit: Int = 15) async throws -> [Cil] {
        var p = ["typ": typ, "lat": "\(odkud.lat)", "lon": "\(odkud.lon)", "datum": Self.datum(kdy), "cas": Self.cas(kdy), "limit": "\(limit)"]
        if nabira { p["nabira"] = "1" }
        if urady { p["urady"] = "moje" }
        let s: SeznamCilu = try await get("/cile", p)
        return s.cile
    }

    /// Hledání lékaře podle jména, ordinace nebo obce (bez diakritiky).
    func hledejCile(_ dotaz: String, typ: String, odkud: Misto, kdy: Date, limit: Int = 15) async throws -> [Cil] {
        let p = ["q": dotaz, "typ": typ, "lat": "\(odkud.lat)", "lon": "\(odkud.lon)",
                 "datum": Self.datum(kdy), "cas": Self.cas(kdy), "limit": "\(limit)"]
        let s: SeznamCilu = try await get("/cile", p)
        return s.cile
    }

    static func parametrySpojeni(odkud: Misto, cilId: String, kdy: Date, pobyt: Int) -> [String: String] {
        ["z_lat": "\(odkud.lat)", "z_lon": "\(odkud.lon)", "cil_id": cilId,
         "datum": datum(kdy), "cas": cas(kdy), "pobyt": "\(pobyt)", "pocet": "4"]
    }

    func spojeni(odkud: Misto, cilId: String, kdy: Date, pobyt: Int) async throws -> Spojeni {
        try await get("/spojeni", Self.parametrySpojeni(odkud: odkud, cilId: cilId, kdy: kdy, pobyt: pobyt))
    }

    /// Text SMS ke spoji (stejný, jaký pošle server).
    func textSMS(_ parametry: [String: String]) async throws -> TextSMS {
        try await get("/spojeni/sms", parametry)
    }

    func adresy(_ dotaz: String) async throws -> [Adresa] {
        let a: NalezeneAdresy = try await get("/adresy", ["q": dotaz, "limit": "10"])
        return a.adresy
    }

    func seniorExpres(lat: Double, lon: Double) async throws -> SeniorExpresObce {
        try await get("/senior-taxi", ["lat": "\(lat)", "lon": "\(lon)"])
    }

    func platnostJizdnichRadu() async -> String? {
        let z: Zdravi? = try? await get("/zdravi")
        return z?.jizdni_rady?.plati_do
    }

    // MARK: systém pro blízké

    func ucet() async throws -> Ucet { try await get("/ucet") }

    func prihlas(email: String, heslo: String, novy: Bool) async throws {
        struct Telo: Encodable { let email: String; let heslo: String }
        struct Odpoved: Decodable { let email: String? }
        let _: Odpoved = try await posli(novy ? "/ucet/registrace" : "/ucet/prihlaseni", telo: Telo(email: email, heslo: heslo))
    }

    func odhlas() async throws { try await posliBezTela("/ucet/odhlaseni", metoda: "POST") }

    func ulozProfil(telefon: String, _ telo: ProfilPUT) async throws -> ProfilOdpoved {
        try await posli("/sms/profil/\(Self.telefonDoCesty(telefon))", metoda: "PUT", telo: telo)
    }

    func smazProfil(telefon: String) async throws {
        var r = URLRequest(url: url("/sms/profil/\(Self.telefonDoCesty(telefon))", [:]))
        r.httpMethod = "DELETE"
        _ = try await proved(r)
    }

    func novyKod(telefon: String) async throws -> NovyKod {
        struct Prazdne: Encodable {}
        return try await posli("/sms/profil/\(Self.telefonDoCesty(telefon))/overeni", telo: Prazdne())
    }

    func karticka(telefon: String) async throws -> Karticka {
        try await get("/sms/profil/\(Self.telefonDoCesty(telefon))/karticka")
    }

    /// Pošle spoj SMS seniorovi z účtu. Text skládá server ze stejných parametrů jako /spojeni.
    func poslatSpoj(telefon: String, parametry: [String: String]) async throws -> PoslanySpoj {
        var telo = parametry
        telo["telefon"] = telefon
        telo["pocet"] = nil
        return try await posli("/ucet/poslat-spoj", telo: telo)
    }
}
