//  Poloha.swift – jednorázové zjištění polohy (oprávnění jen „při používání“).

import CoreLocation

final class Poloha: NSObject, CLLocationManagerDelegate {
    private let spravce = CLLocationManager()
    private var cekani: CheckedContinuation<CLLocation, Error>?

    override init() {
        super.init()
        spravce.delegate = self
        spravce.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    @MainActor
    func zjisti() async throws -> CLLocation {
        try await withCheckedThrowingContinuation { pokracovani in
            cekani = pokracovani
            switch spravce.authorizationStatus {
            case .notDetermined:
                spravce.requestWhenInUseAuthorization()
            case .denied, .restricted:
                dokonci(.failure(ApiChyba(chyba: "Poloha není povolená. Zadejte adresu, nebo polohu povolte v Nastavení telefonu.")))
            default:
                spravce.requestLocation()
            }
        }
    }

    private func dokonci(_ vysledek: Result<CLLocation, Error>) {
        guard let c = cekani else { return }
        cekani = nil
        c.resume(with: vysledek)
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard cekani != nil else { return }
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            manager.requestLocation()
        case .denied, .restricted:
            dokonci(.failure(ApiChyba(chyba: "Poloha není povolená. Zadejte adresu, nebo polohu povolte v Nastavení telefonu.")))
        default:
            break
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        if let l = locations.last { dokonci(.success(l)) }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        dokonci(.failure(ApiChyba(chyba: "Polohu se nepodařilo zjistit. Zkuste to znovu, nebo zadejte adresu.")))
    }
}
