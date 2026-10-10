//  DojedemeApp.swift – Dojedeme: K lékaři a zase domů.
//  Úvod (režim a bydliště) → standardní režim (záložky Najít spoj, Pro blízké, Nastavení)
//  nebo jednoduchý režim (velké dlaždice pro seniora). Design a texty: design/BRAND.md.

import SwiftUI
import UserNotifications

/// Připomínka odjezdu se ukáže i tehdy, když je aplikace zrovna otevřená.
final class Oznameni: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Oznameni()

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }
}

@main
struct DojedemeApp: App {
    @State private var stav = Stav()

    init() {
        UNUserNotificationCenter.current().delegate = Oznameni.shared
    }

    var body: some Scene {
        WindowGroup {
            Koren()
                .environment(stav)
                .tint(.accentColor)
                .task { await stav.obnovSeniorExpres() }
        }
    }
}

struct Koren: View {
    @Environment(Stav.self) private var stav

    var body: some View {
        if stav.bydliste == nil || !stav.uvodHotovy {
            Uvod()
        } else if stav.jednoduchy {
            JednoduchyDomov()
        } else {
            Zalozky()
        }
    }
}

struct Zalozky: View {
    @Environment(Stav.self) private var stav

    var body: some View {
        @Bindable var stav = stav
        TabView(selection: $stav.zalozka) {
            NajitSpoj()
                .tabItem { Label("Najít spoj", systemImage: "bus") }
                .tag(Zalozka.spoj)
            ProBlizke()
                .tabItem { Label("Pro blízké", systemImage: "person.2") }
                .tag(Zalozka.blizci)
            Nastaveni()
                .tabItem { Label("Nastavení", systemImage: "gearshape") }
                .tag(Zalozka.nastaveni)
        }
    }
}
