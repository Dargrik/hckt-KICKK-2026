//  Uvod.swift – první spuštění: co aplikace dělá, režim (jednoduchý / standardní) a bydliště.
//  Jeden krok = jedna otázka (BRAND.md, přístupnost).

import SwiftUI

struct Uvod: View {
    @Environment(Stav.self) private var stav
    @State private var krok = 0

    var body: some View {
        NavigationStack {
            Group {
                switch krok {
                case 0: vitejte
                case 1: rezim
                default: bydliste
                }
            }
            .animation(.default, value: krok)
        }
    }

    private var vitejte: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Image("Logo")
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: 240)
                    .accessibilityLabel("Dojedeme")
                Text("K lékaři a zase domů.")
                    .font(.largeTitle.bold())
                Text("Najdeme vám spoj autobusem nebo vlakem k lékaři, do nemocnice nebo na úřad. A hlavně spoj zpátky domů.")
                    .font(.title3)
                Text("Místa řadíme podle toho, jak rychle se tam dostanete, ne podle kilometrů.")
                    .font(.body)
                    .foregroundStyle(Color.ink2)
                Button { krok = 1 } label: {
                    Text("Začít").font(.title3.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 60)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            }
            .padding(24)
        }
    }

    private var rezim: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Jak má aplikace vypadat?").font(.title.bold())
                volba(nazev: "Velká tlačítka",
                      popis: "Větší písmo, velká tlačítka a jen to nejdůležitější: lékař, zubař, nemocnice a úřad.",
                      ikona: "textformat.size.larger", jednoduchy: true)
                volba(nazev: "Všechny možnosti",
                      popis: "Vlastní lékař, výběr dne a času a služba pro blízké. Pro toho, kdo s telefonem umí.",
                      ikona: "list.bullet", jednoduchy: false)
                Text("Později to změníte v Nastavení nebo pod tlačítkem Pomoc.")
                    .font(.callout)
                    .foregroundStyle(Color.ink2)
            }
            .padding(24)
        }
        .navigationTitle("Vzhled")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func volba(nazev: String, popis: String, ikona: String, jednoduchy: Bool) -> some View {
        Button {
            stav.jednoduchy = jednoduchy
            krok = 2
        } label: {
            HStack(alignment: .top, spacing: 16) {
                Image(systemName: ikona)
                    .font(.title)
                    .foregroundStyle(Color.accentColor)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 6) {
                    Text(nazev).font(.title2.weight(.semibold)).foregroundStyle(.primary)
                    Text(popis).font(.body).foregroundStyle(Color.ink2).multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
            }
            .padding(20)
            .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
            .background(Color("PrimaryTint"), in: RoundedRectangle(cornerRadius: 16))
        }
        .buttonStyle(.plain)
    }

    private var bydliste: some View {
        AdresaVyber(nadpis: "Kde bydlíte?",
                    vysvetleni: "Spoje hledáme z vašeho bydliště. Adresa zůstane jen v tomto telefonu.") { misto in
            stav.bydliste = misto
            stav.uvodHotovy = true
            Task { await stav.obnovSeniorExpres() }
        }
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Zpět") { krok = 1 } }
        }
    }
}
