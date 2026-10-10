// Dojedeme – úvodní stránka: jen doplní hlavní číslo z /statistiky (mapa a další data jsou na stránce Data a mapy).
(function () {
  "use strict";
  const D = window.Dojedeme;
  const fmt = new Intl.NumberFormat("cs-CZ");
  const RADOVE = { 2: "každý druhý", 3: "každý třetí", 4: "každý čtvrtý", 5: "každý pátý", 6: "každý šestý", 7: "každý sedmý",
                   8: "každý osmý", 9: "každý devátý", 10: "každý desátý", 11: "každý jedenáctý", 12: "každý dvanáctý" };

  async function nactiCislo() {
    try {
      const s = await D.api("/statistiky");
      if (s.seniori_nad_3h_nebo_bez_spojeni) {
        document.getElementById("cislo-seniori").textContent = fmt.format(s.seniori_nad_3h_nebo_bez_spojeni);
      }
      if (RADOVE[s.jeden_z_kolika_senioru]) document.getElementById("cislo-kolikaty").textContent = RADOVE[s.jeden_z_kolika_senioru];
    } catch (e) { /* zůstane číslo vložené v HTML */ }
  }
  nactiCislo();
})();
