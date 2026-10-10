// Dojedeme – stránka Data a mapy (/mapa): přehled šesti zjištění (karty), dostupnost obce (hexagony, pracovní den / sobota / neděle),
// obce blízko, a přesto daleko, spádové oblasti nemocnic podle vzdálenosti a podle spojů, cesta na vlastní úřad ORP,
// Senior Expres, pohotovost v sobotu. Seznamy obcí jsou sbalené (details), nahoře lepí obsah stránky se zvýrazněnou částí.
// Data: /statistiky, /obce, /mapa/h3[?den=so|ne], /mapa/obce, /mapa/blizko-daleko, /mapa/spady (GeoJSON
// z data/scripts/spadove_oblasti.py), /mapa/spady/souhrn.
(function () {
  "use strict";
  const D = window.Dojedeme;
  const esc = D.esc;
  const NBSP = "\u00a0";
  const fmt = new Intl.NumberFormat("cs-CZ");
  const fmt1 = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 });
  const cislo = (n) => fmt.format(Math.round(n || 0));
  const km = (n) => `${fmt1.format(n)}${NBSP}km`;
  const doba = (m) => D.minuty(m).replace(/ /g, NBSP);
  const el = (id) => document.getElementById(id);
  const normalizuj = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const obciSlovy = (n) => (n === 1 ? "1 obec" : n >= 2 && n <= 4 ? `${n} obce` : `${n} obcí`);
  // „ve dvou, ve třech, ve čtrnácti, ve dvaceti…“ × „v pěti, v šestnácti, v padesáti…“
  function predlozkaV(n) {
    if (n >= 100) { const s = Math.floor(n / 100); return s <= 4 ? "ve" : "v"; }
    return [2, 3, 4, 12, 13, 14].includes(n) || (n >= 20 && n < 50) ? "ve" : "v";
  }
  const vCase = (cas) => `${predlozkaV(parseInt(cas, 10))}${NBSP}${cas}`;   // „v 8:16“, „ve 13:11“
  const veObcich = (n) => `${predlozkaV(n)} ${n}${NBSP}${n === 1 ? "obci" : "obcích"}`;
  const velke = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  // „Z 21 obcí“, „Ze 3 obcí“, „Z 1 obce“ (začátek věty)
  const zObci = (n) => `${[2, 3, 4, 7, 12, 13, 14, 17].includes(n) || (n >= 100 && n < 200) ? "Ze" : "Z"} ${n}${NBSP}${n === 1 ? "obce" : "obcí"}`;
  const klid = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // nemocnice a úřady ORP: „v Karlových Varech“ (6. pád do vět)
  const V_MESTE = { "Karlovy Vary": "v Karlových Varech", "Cheb": "v Chebu", "Sokolov": "v Sokolově", "Ostrov": "v Ostrově",
                    "Mariánské Lázně": "v Mariánských Lázních", "Aš": "v Aši", "Kraslice": "v Kraslicích" };
  const vMeste = (m) => V_MESTE[m] || `v obci ${m}`;

  const KATEGORIE = {
    praktik: { pole: "mimo_domov_praktik_min", kam: "k praktickému lékaři a zpět" },
    zubar: { pole: "mimo_domov_zubar_min", kam: "k zubaři a zpět" },
    nemocnice: { pole: "mimo_domov_nemocnice_min", kam: "do nemocnice a zpět" },
  };
  // pět nemocnic: barva z tokenů + vlastní vzor, aby barva nikdy nenesla význam sama (BRAND.md kap. 6)
  const VZORY = [
    { barva: "--color-primary", tvar: "plna" },
    { barva: "--color-info", tvar: "svisle" },
    { barva: "--color-error", tvar: "tecky" },
    { barva: "--color-signal", tvar: "vodorovne" },
    { barva: "--color-map-3", tvar: "sikmo" },
  ];
  const VZOR_NEMOCNICE = { "nem-26365804": 0, "nem-24747246": 1, "nem-26365804-554481": 2, "nem-26376709": 3, "nem-47714913": 4 };

  // mapa dostupnosti obce pro pracovní den a pro víkend (víkend: delší okno odjezdů, jezdí méně spojů)
  const DNY = {
    pd: { kdy: "v pracovní den", okno: `Pracovní den (úterý 13.${NBSP}10.${NBSP}2026), odjezd z domova mezi 6. a 9. hodinou.` },
    so: { kdy: "v sobotu", okno: `Sobota 17.${NBSP}10.${NBSP}2026, odjezd z domova mezi 6. a 12. hodinou.` },
    ne: { kdy: "v neděli", okno: `Neděle 18.${NBSP}10.${NBSP}2026, odjezd z domova mezi 6. a 12. hodinou.` },
  };

  const stav = {
    obce: [], obcePodleKodu: new Map(), agregace: new Map(), spadyObce: new Map(), nemocnice: new Map(), souhrn: null,
    vybrana: null, kategorie: "praktik", varianta: "km", rozdil: false,
    den: "pd", h3: {}, agregaceDne: {}, blizko: null, blizkoKat: "praktik",
  };
  let barvy = null;

  function prectiBarvy() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    return {
      tridy: [v("--color-map-none"), v("--color-map-1"), v("--color-map-2"), v("--color-map-3"), v("--color-map-4"), v("--color-map-5"), v("--color-map-6")],
      nemocnice: VZORY.map((z) => v(z.barva)),
      bez: v("--color-map-none"), obrys: v("--color-bg"), hranice: v("--color-ink-2"), ink: v("--color-ink"), primary: v("--color-primary"),
    };
  }
  const indexVzoru = (id) => (id in VZOR_NEMOCNICE ? VZOR_NEMOCNICE[id]
    : Math.max(0, (stav.souhrn ? stav.souhrn.nemocnice.findIndex((n) => n.id === id) : 0)) % VZORY.length);

  /* ---------- SVG vzory (šrafování) v mapě ---------- */
  const NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs) { const e = document.createElementNS(NS, tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); return e; }
  function pridejVzory(mapaId, sNemocnicemi) {
    const svg = document.querySelector(`#${mapaId} .leaflet-overlay-pane svg`);
    if (!svg || svg.querySelector("defs.dojedeme")) return;
    const defs = svgEl("defs", { class: "dojedeme" });
    const vzor = (id, tvar) => {
      const p = svgEl("pattern", { id, patternUnits: "userSpaceOnUse", width: 8, height: 8 });
      if (tvar === "bez") p.setAttribute("patternTransform", "rotate(45)");
      if (tvar === "sikmo") p.setAttribute("patternTransform", "rotate(-45)");
      p.append(svgEl("rect", { width: 8, height: 8, class: "vzor-podklad" }));
      const t = tvar === "tecky" ? svgEl("circle", { cx: 4, cy: 4, r: 1.7 })
        : tvar === "vodorovne" ? svgEl("rect", { y: 3, width: 8, height: 2.5 })
        : tvar === "plna" ? null : svgEl("rect", { x: 3, width: tvar === "bez" ? 3 : 2.5, height: 8 });
      if (t) { t.setAttribute("class", "vzor-textura"); p.append(t); }
      defs.append(p);
    };
    vzor(`${mapaId}-bez`, "bez");
    if (sNemocnicemi) VZORY.forEach((z, i) => vzor(`${mapaId}-n${i}`, z.tvar));
    svg.insertBefore(defs, svg.firstChild);
    obarviVzory(mapaId);
  }
  function obarviVzory(mapaId) {
    const defs = document.querySelector(`#${mapaId} .leaflet-overlay-pane svg defs.dojedeme`);
    if (!defs) return;
    defs.querySelectorAll("pattern").forEach((p) => {
      const pod = p.querySelector(".vzor-podklad"), tex = p.querySelector(".vzor-textura");
      if (p.id.endsWith("-bez")) {
        pod.setAttribute("fill", barvy.obrys); pod.setAttribute("fill-opacity", "0.55");
        tex.setAttribute("fill", barvy.bez);
      } else {
        const i = Number(p.id.split("-n").pop());
        pod.setAttribute("fill", barvy.nemocnice[i]);
        if (tex) { tex.setAttribute("fill", barvy.obrys); tex.setAttribute("fill-opacity", "0.6"); }
      }
    });
  }

  /* ---------- společné pro obě mapy ---------- */
  function novaMapa(id) {
    const L = window.L;
    const m = L.map(id, {
      zoomControl: false, scrollWheelZoom: false, dragging: !L.Browser.mobile,
      minZoom: 8, maxZoom: 15, zoomSnap: 0.25, attributionControl: true,
      fadeAnimation: !klid, zoomAnimation: !klid, markerZoomAnimation: !klid,
    });
    m.attributionControl.setPrefix(false);
    L.control.zoom({ zoomInTitle: "Přiblížit", zoomOutTitle: "Oddálit" }).addTo(m);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(m);
    m.on("popupopen", (e) => {
      const b = e.popup.getElement() && e.popup.getElement().querySelector(".leaflet-popup-close-button");
      if (b) { b.setAttribute("aria-label", "Zavřít podrobnosti"); b.removeAttribute("title"); }
    });
    return m;
  }
  function ukazStav(id, html) {
    const st = el(id);
    if (!st) return;
    if (html === null) { st.hidden = true; st.innerHTML = ""; return; }
    st.hidden = false; st.innerHTML = html;
  }
  const chybaHtml = (nadpis, e, rada) => `<div class="blok chyba"><i class="ph-bold ph-warning ikona" aria-hidden="true"></i>
    <div><strong>${esc(nadpis)}</strong>${esc(e && e.message ? e.message : "")} ${esc(rada)}</div></div>`;
  function lidi(n) { const x = Math.round(n || 0); return x < 1 ? "méně než 1" : `asi ${cislo(x)}`; }
  function stylHranic(f) {
    const vybrana = f.properties.kod_obce === stav.vybrana;
    return vybrana ? { color: barvy.ink, weight: 3.5, opacity: 1, fill: false, interactive: false }
      : { color: barvy.hranice, weight: 0.9, opacity: 0.5, fill: false, interactive: false };
  }

  /* ---------- Přehled nahoře: šest zjištění, každé jako karta s odkazem na svůj oddíl ----------
     Karty plní jednotlivé oddíly, jakmile mají svá data (statistiky, spády, Senior Expres, pohotovost). */
  function karta(id, velkeCislo, veta) {
    const a = el(id);
    if (!a) return;
    a.querySelector(".karta-cislo").textContent = velkeCislo;
    a.querySelector(".karta-text").textContent = veta;
    a.setAttribute("aria-busy", "false");
  }
  const kartaChyba = (id) => karta(id, "–", "Údaj se teď nepodařilo načíst.");

  async function nactiPrehled() {
    try {
      const s = await D.api("/statistiky");
      karta("karta-lekar", `${cislo(s.seniori_nad_3h_nebo_bez_spojeni)} seniorů`,
        `Každý ${s.jeden_z_kolika_senioru}. senior v kraji je kvůli lékaři přes 3${NBSP}hodiny mimo domov, nebo se k němu veřejnou dopravou nedostane.`);
      karta("karta-blizko", obciSlovy(s.obce_km_klame_praktik),
        `má praktického lékaře do 10${NBSP}km, a přesto tam a zpátky strávíte 3${NBSP}hodiny a víc.`);
      el("kontext-kraje").textContent = `V kraji žije ${cislo(s.seniori_kraj)} lidí nad 65 let, to je ${fmt1.format(s.podil_senioru_pct)}${NBSP}% obyvatel.`
        + (s.seniori_dal_nez_1km_od_zastavky ? ` ${cislo(s.seniori_dal_nez_1km_od_zastavky)} z nich bydlí dál než 1${NBSP}km od zastávky se spojem k lékaři.` : "")
        + ` Doba mimo domov je vždy cesta tam, 45${NBSP}minut na místě a cesta zpátky.`;
    } catch (e) {
      kartaChyba("karta-lekar"); kartaChyba("karta-blizko");
    }
  }

  /* seznam obcí pod oddílem: sbalený, ať stránka zůstane přehledná; tabulka se na telefonu skládá do karet */
  function seznamObci(id, nadpis, pocet, popis, hlavicka, radky, trida) {
    return `<details class="rozbalit" id="${id}">
      <summary><i class="ph-bold ph-caret-right" aria-hidden="true"></i><span>${esc(nadpis)} (${pocet})</span></summary>
      <div class="rozbalit-obsah">
        ${popis ? `<p class="male sloupec-textu">${popis}</p>` : ""}
        <div class="tabulka-ram">
          <table class="tabulka-obci ${trida}" aria-label="${esc(nadpis)}">
            <thead><tr>${hlavicka.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead>
            <tbody>${radky}</tbody>
          </table>
        </div>
      </div>
    </details>`;
  }
  /* jedno hlavní číslo oddílu s větou (a případně příkladem) */
  const klicove = (velkeCislo, veta, doplnek = "") => `
    <div class="klicove">
      <p class="cislo-velke">${velkeCislo}</p>
      <p class="klicove-veta">${veta}</p>${doplnek ? `
      <p class="cislo-priklad">${doplnek}</p>` : ""}
    </div>`;

  /* ---------- 1. Mapa dostupnosti obce ---------- */
  let mapaObce = null, hexy = null, hraniceObce = null, hraniceSpady = null;

  function vykresliLegenduObce() {
    const ul = el("legenda-obce");
    ul.innerHTML = [1, 2, 3, 4, 5, 6, 0].map((i) => `<li><i class="m${i}" aria-hidden="true"></i>${esc(D.LEGENDA_MAPY[i])}</li>`).join("");
  }
  function stylHex(f) {
    const t = D.tridaMapy(f.properties[KATEGORIE[stav.kategorie].pole]);
    return { stroke: true, color: barvy.obrys, weight: 0.5, opacity: 0.8, fill: true,
             fillColor: t === 0 ? "url(#mapa-obce-bez)" : barvy.tridy[t], fillOpacity: t === 0 ? 0.9 : 0.88 };
  }
  function popupHex(p) {
    const k = KATEGORIE[stav.kategorie];
    const min = p[k.pole];
    const pesky = p.pesky_k_zastavce_min;
    let chuze = "";
    if (pesky !== null && pesky !== undefined) {
      chuze = pesky >= 99 ? "Do 1 km není zastávka se spojem." : pesky >= 25 ? "Část domů nemá zastávku se spojem do 1 km."
        : `Pěšky k zastávce asi ${D.minuty(pesky)}.`;
    }
    const obec = stav.obcePodleKodu.get(p.kod_obce);
    return `<p class="popup-obec">${esc(p.obec || "Neznámá obec")}</p>
      <p>Lidé nad 65 let: ${esc(lidi(p.obyvatel_65plus))}</p>
      <p>Doba mimo domov ${esc(k.kam)} ${esc(DNY[stav.den].kdy)}: <strong>${esc(min === null || min === undefined ? "bez spojení" : D.minuty(min))}</strong></p>
      ${chuze ? `<p class="male">${esc(chuze)}</p>` : ""}
      ${obec ? `<p><button type="button" class="odkaz-tlacitko" data-obec="${esc(p.kod_obce)}">Shrnutí pro obec ${esc(obec.obec)}</button></p>` : ""}`;
  }

  async function nactiMapuObce(h3, obce) {
    try {
      if (!window.L) throw new Error("Mapový podklad se nepodařilo načíst. Zkontrolujte připojení k internetu.");
      const L = window.L;
      mapaObce = novaMapa("mapa-obce");
      hexy = L.geoJSON(h3, { style: stylHex, onEachFeature: (f, v) => v.bindPopup(() => popupHex(f.properties), { maxWidth: 320 }) });
      mapaObce.fitBounds(hexy.getBounds(), { padding: [4, 4] });
      hexy.addTo(mapaObce);
      if (obce) hraniceObce = L.geoJSON(obce, { style: stylHranic, interactive: false }).addTo(mapaObce);
      pridejVzory("mapa-obce", false);
      mapaObce.on("popupopen", (e) => {
        const b = e.popup.getElement() && e.popup.getElement().querySelector("[data-obec]");
        if (b) b.addEventListener("click", () => { mapaObce.closePopup(); vyberObec(b.dataset.obec, { priblizit: false, fokus: true }); });
      });
      ukazStav("mapa-obce-stav", null);
      setTimeout(() => mapaObce && mapaObce.invalidateSize(), 150);
      if (stav.vybrana) priblizObec(stav.vybrana);
    } catch (e) {
      ukazStav("mapa-obce-stav", chybaHtml("Mapu se nepodařilo načíst.", e, "Shrnutí pro obec najdete i bez mapy přes hledání nahoře."));
    }
  }
  function prepniKategorii(nova) {
    stav.kategorie = nova;
    document.querySelectorAll("#obec-sekce [data-kategorie]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.kategorie === nova)));
    if (hexy) { hexy.setStyle(stylHex); mapaObce.closePopup(); }
    popisDne();
  }

  /* den v týdnu: víkendové hexagony se načtou až na požádání */
  async function prepniDen(den, zapsat = true) {
    stav.den = den;
    document.querySelectorAll("#obec-sekce [data-den]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.den === den)));
    if (zapsat) zapisAdresu();
    if (!stav.h3[den]) {
      ukazStav("mapa-obce-stav", "Načítám mapu…");
      try {
        const h3 = await D.api(`/mapa/h3?den=${den}`);
        stav.h3[den] = h3;
        stav.agregaceDne[den] = agreguj(h3);
      } catch (e) {
        ukazStav("mapa-obce-stav", chybaHtml("Mapu pro tento den se nepodařilo načíst.", e, "Zkuste to znovu nebo přepněte na pracovní den."));
        return;
      }
      if (stav.den !== den) return;   // mezitím přepnuto na jiný den
    }
    ukazStav("mapa-obce-stav", null);
    if (hexy) {
      mapaObce.closePopup();
      hexy.clearLayers();
      hexy.addData(stav.h3[den]);
      if (hraniceObce) hraniceObce.bringToFront();
    }
    popisDne();
    if (stav.vybrana) el("obec-shrnuti").innerHTML = shrnutiHtml(stav.obcePodleKodu.get(stav.vybrana));
  }

  /* věta nad mapou: kolik seniorů je v daný den na cestě 3 h a víc (podle zvoleného cíle) */
  function senioriDaleko(h3, kat) {
    const pole = KATEGORIE[kat].pole;
    return h3.features.reduce((s, f) => {
      const v = f.properties[pole];
      return v === null || v === undefined || v >= 180 ? s + (f.properties.obyvatel_65plus || 0) : s;
    }, 0);
  }
  function popisDne() {
    const p = el("den-popis"), h3 = stav.h3[stav.den];
    if (!h3) { p.innerHTML = ""; return; }
    const d = DNY[stav.den];
    const n = senioriDaleko(h3, stav.kategorie);
    const srovnani = stav.den !== "pd" && stav.h3.pd ? ` V pracovní den je jich ${cislo(senioriDaleko(stav.h3.pd, stav.kategorie))}.` : "";
    p.innerHTML = `<strong>${cislo(n)} lidí nad 65 let</strong> stráví ${esc(d.kdy)} cestou ${esc(KATEGORIE[stav.kategorie].kam)} 3${NBSP}hodiny a víc,
      nebo se tam veřejnou dopravou v jeden den nedostane.${srovnani}<span class="male">${esc(d.okno)}</span>`;
  }

  /* agregace hexagonů po obcích: průměr vážený obyvateli + podíl obyvatel v místech bez spojení */
  function agreguj(h3) {
    const m = new Map();
    for (const f of h3.features) {
      const p = f.properties;
      const w = Math.max(p.obyvatel || 0, 0.01);
      let a = m.get(p.kod_obce);
      if (!a) m.set(p.kod_obce, a = { w: 0, k: {} });
      a.w += w;
      for (const k of Object.keys(KATEGORIE)) {
        const x = a.k[k] || (a.k[k] = { s: 0, w: 0 });
        const v = p[KATEGORIE[k].pole];
        if (v !== null && v !== undefined) { x.s += v * w; x.w += w; }
      }
    }
    return m;
  }

  /* ---------- hledání obce (vzor ARIA combobox jako na stránce Najít spoj) ---------- */
  function pripravHledani() {
    const input = el("obec-hledat"), seznam = el("obec-seznam"), stavEl = el("obec-stav");
    let polozky = [], aktivni = -1;
    const zavri = () => { seznam.hidden = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); aktivni = -1; };
    const otevri = () => { if (polozky.length) { seznam.hidden = false; input.setAttribute("aria-expanded", "true"); } };
    function nastavAktivni(i) {
      aktivni = i;
      [...seznam.children].forEach((li, j) => li.setAttribute("aria-selected", j === i ? "true" : "false"));
      if (i >= 0) { const li = seznam.children[i]; input.setAttribute("aria-activedescendant", li.id); li.scrollIntoView({ block: "nearest" }); }
    }
    function hledej() {
      const q = normalizuj(input.value);
      if (!q) { polozky = []; seznam.innerHTML = ""; zavri(); stavEl.textContent = ""; return; }
      const zacina = [], obsahuje = [];
      for (const o of stav.obce) {
        const n = normalizuj(o.obec);
        if (n.startsWith(q)) zacina.push(o); else if (n.includes(q)) obsahuje.push(o);
      }
      polozky = zacina.concat(obsahuje).slice(0, 8);
      seznam.innerHTML = polozky.map((o, i) => `<li role="option" id="obec-seznam-${i}" aria-selected="false">${esc(o.obec)}${
        o.orp ? ` <span class="male">ORP ${esc(o.orp)}</span>` : ""}</li>`).join("");
      aktivni = -1;
      if (polozky.length) { otevri(); stavEl.textContent = `${obciSlovy(polozky.length).replace(/^1 obec$/, "Jedna obec")} v nabídce. Vyberte šipkami nebo klepnutím.`; }
      else { zavri(); stavEl.textContent = "Takovou obec v Karlovarském kraji nenacházíme. Zkontrolujte název."; }
    }
    function vyber(i) {
      const o = polozky[i];
      if (!o) return;
      zavri(); stavEl.textContent = "";
      vyberObec(o.kod_obce, { priblizit: true, fokus: false });
    }
    input.addEventListener("input", hledej);
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { if (!polozky.length) return; e.preventDefault(); otevri(); nastavAktivni((aktivni + 1) % polozky.length); }
      else if (e.key === "ArrowUp") { if (!polozky.length) return; e.preventDefault(); otevri(); nastavAktivni(aktivni <= 0 ? polozky.length - 1 : aktivni - 1); }
      else if (e.key === "Enter") { if (!seznam.hidden && polozky.length) { e.preventDefault(); vyber(Math.max(aktivni, 0)); } }
      else if (e.key === "Escape") { if (!seznam.hidden) { e.preventDefault(); zavri(); } }
      else if (e.key === "Tab") zavri();
    });
    input.addEventListener("blur", () => setTimeout(zavri, 150));
    seznam.addEventListener("mousedown", (e) => e.preventDefault());
    seznam.addEventListener("click", (e) => { const li = e.target.closest("[role=option]"); if (li) vyber([...seznam.children].indexOf(li)); });
    input.disabled = false;
    stavEl.textContent = "";
  }

  function priblizObec(kod) {
    if (!mapaObce) return;
    let b = null;
    if (hraniceObce) hraniceObce.eachLayer((v) => { if (v.feature.properties.kod_obce === kod) b = v.getBounds(); });
    if (!b && hexy) {
      const L = window.L;
      hexy.eachLayer((v) => { if (v.feature.properties.kod_obce === kod) b = b ? b.extend(v.getBounds()) : L.latLngBounds(v.getBounds().getSouthWest(), v.getBounds().getNorthEast()); });
    }
    if (b) mapaObce.fitBounds(b, { padding: [24, 24], maxZoom: 11.5, animate: !klid });
  }

  function vyberObec(kod, { priblizit = true, fokus = false } = {}) {
    const o = stav.obcePodleKodu.get(kod);
    if (!o) return;
    stav.vybrana = kod;
    el("obec-hledat").value = o.obec;
    const box = el("obec-shrnuti");
    box.innerHTML = shrnutiHtml(o);
    if (hraniceObce) hraniceObce.setStyle(stylHranic);
    if (hraniceSpady) hraniceSpady.setStyle(stylHranic);
    if (priblizit) priblizObec(kod);
    zapisAdresu();
    if (fokus) { box.focus({ preventScroll: true }); box.scrollIntoView({ block: "start", behavior: klid ? "auto" : "smooth" }); }
  }

  function hodnoceni(min) {
    return min < 120 ? "dobrá" : min < 180 ? "střední" : min < 240 ? "špatná" : "kritická";
  }
  function shrnutiHtml(o) {
    const a = stav.agregace.get(o.kod_obce);
    const prumer = (k) => (a && a.k[k].w ? a.k[k].s / a.k[k].w : null);
    const bez = (k) => (a ? 1 - a.k[k].w / a.w : 0);
    const odstavce = [];

    const pr = prumer("praktik"), zu = prumer("zubar");
    const vetaPr = pr === null ? `V pracovní den se z obce ${esc(o.obec)} k praktickému lékaři a zpět veřejnou dopravou v jeden den nedostanete.`
      : `V pracovní den jste z obce ${esc(o.obec)} u praktického lékaře a zpátky doma průměrně za <strong>${esc(doba(pr))}</strong>.`;
    const vetaZu = zu === null ? "K zubaři a zpět to v jeden den nejde." : `K zubaři a zpět za <strong>${esc(doba(zu))}</strong>.`;
    odstavce.push(`${vetaPr} ${vetaZu}`);
    const av = stav.den !== "pd" && stav.agregaceDne[stav.den] ? stav.agregaceDne[stav.den].get(o.kod_obce) : null;
    if (av) {
      const pv = (k) => (av.k[k].w ? av.k[k].s / av.k[k].w : null);
      const prv = pv("praktik"), zuv = pv("zubar");
      odstavce.push(`${esc(velke(DNY[stav.den].kdy))} ${prv === null ? "se k praktickému lékaři a zpět v jeden den nedostanete"
        : `jste u praktického lékaře a zpátky za <strong>${esc(doba(prv))}</strong>`}${zuv === null ? ", k zubaři a zpět to nejde vůbec."
        : `, u zubaře za <strong>${esc(doba(zuv))}</strong>.`}`);
    }

    const s = stav.spadyObce.get(o.kod_obce);
    if (s) odstavce.push(vetaNemocnice(s));
    const podilBez = Math.max(bez("praktik"), bez("zubar"), bez("nemocnice"));
    if (podilBez >= 0.1 && pr !== null) {
      odstavce.push(`Asi ${Math.round(podilBez * 100)}${NBSP}% obyvatel ale bydlí tam, kde spoj tam a zpět v jeden den nejede nebo zastávka je dál než 1${NBSP}km. Průměr počítá jen s místy, odkud spoj jede.`);
    }
    if (s && s.orp_uradni) {
      odstavce.push(s.mimo_orp_uradni === null
        ? `Na úřad ${esc(vMeste(s.orp_uradni))}, pod který obec patří, se tam a zpět v jeden den nedostanete.`
        : `Na úřad ${esc(vMeste(s.orp_uradni))}, pod který obec patří, jste tam a zpět za ${esc(doba(s.mimo_orp_uradni))}.`);
    }

    const trojice = ["praktik", "zubar", "nemocnice"].map(prumer);
    const hod = trojice.every((x) => x !== null) ? hodnoceni((trojice[0] + trojice[1] + trojice[2]) / 3) : "bez spojení";
    const podil = o.podil_65plus !== null && o.podil_65plus !== undefined ? ` (${fmt1.format(o.podil_65plus)}${NBSP}%)` : "";
    const zastavka = o.zastavka ? `Hlavní zastávka ${esc(String(o.zastavka).replace(/,(?=\S)/g, ", "))}: ${esc(D.spoju(o.odjezdu_za_den || 0))} za den.` : "Obec nemá zastávku se spojem.";
    return `
      <div class="shrnuti-hlava">
        <h3>${esc(o.obec)}</h3>
        <p class="male">${o.orp ? `ORP ${esc(o.orp)}. ` : ""}${cislo(o.obyvatel)} obyvatel, z toho ${cislo(o.obyvatel_65plus)} nad 65 let${podil}.</p>
      </div>
      <p class="shrnuti-hodnoceni">Dostupnost lékařů veřejnou dopravou: <strong>${esc(hod)}</strong></p>
      ${odstavce.map((p) => `<p>${p}</p>`).join("")}
      <p class="male">${zastavka}${o.senior_expres ? " V obci jezdí Senior Expres, telefon je na letáku." : ""}</p>
      <p class="shrnuti-odkazy"><a href="${esc(o.letak)}">Leták pro obec ${esc(o.obec)} (PDF)</a> <a href="/aplikace">Najít konkrétní spoj</a></p>`;
  }

  function vetaNemocnice(s) {
    const n = (id) => stav.nemocnice.get(id);
    const nk = n(s.km), nc = s.cas ? n(s.cas) : null;
    if (!nk) return "";
    if (!nc) return `Do žádné nemocnice se odsud veřejnou dopravou tam a zpět v jeden den nedostanete. Nejbližší je ${esc(vMeste(nk.mesto))} (${esc(km(s.km_km))} vzdušnou čarou).`;
    if (!s.lisi_se) {
      return `Nejbližší nemocnice ${esc(vMeste(nk.mesto))} (${esc(km(s.km_km))} vzdušnou čarou) je zároveň ta, kam se dostanete nejrychleji: tam a zpět za <strong>${esc(doba(s.mimo_cas))}</strong>.`;
    }
    if (s.mimo_km === null) {
      return `Nejblíž vzdušnou čarou máte nemocnici ${esc(vMeste(nk.mesto))} (${esc(km(s.km_km))}), tam a zpět se do ní ale v jeden den nedostanete. Nemocnici ${esc(vMeste(nc.mesto))} (${esc(km(s.cas_km))}) zvládnete za <strong>${esc(doba(s.mimo_cas))}</strong>.`;
    }
    if (s.uspora !== null && s.uspora < 5) {
      return `Nejblíž vzdušnou čarou máte nemocnici ${esc(vMeste(nk.mesto))} (${esc(km(s.km_km))}). Stejně rychle, tam a zpět asi za ${esc(doba(s.mimo_cas))}, se dostanete i do nemocnice ${esc(vMeste(nc.mesto))}.`;
    }
    return `Nejblíž vzdušnou čarou máte nemocnici ${esc(vMeste(nk.mesto))} (${esc(km(s.km_km))}), tam a zpět ale strávíte ${esc(doba(s.mimo_km))}. Spojem jste dřív ${esc(vMeste(nc.mesto))} (${esc(km(s.cas_km))}): tam a zpět za <strong>${esc(doba(s.mimo_cas))}</strong>.`;
  }

  /* ---------- Blízko, a přesto daleko (/mapa/blizko-daleko) ----------
     Obce, kde je nejbližší místo do 10 km (nemocnice do 20 km) vzdušnou čarou, a přesto je člověk 3 h a víc mimo domov. */
  const BLIZKO = {
    praktik: { limit: 10, co: "praktického lékaře", kam: "k praktickému lékaři a zpět", nejblizsi: "Nejbližší praktický lékař" },
    zubar: { limit: 10, co: "zubaře", kam: "k zubaři a zpět", nejblizsi: "Nejbližší zubař" },
    nemocnice: { limit: 20, co: "nemocnici", kam: "do nemocnice a zpět", nejblizsi: "Nejbližší nemocnice" },
  };
  const DALEKO_MIN = 180;
  const jeDaleko = (r, limit) => r.km <= limit && (r.mimo_min === null || r.mimo_min >= DALEKO_MIN);
  const podleDoby = (a, b) => (b.mimo_min ?? 1e4) - (a.mimo_min ?? 1e4) || (b.seniori || 0) - (a.seniori || 0);

  async function nactiBlizko() {
    try {
      stav.blizko = await D.api("/mapa/blizko-daleko");
      vykresliBlizko();
      if (window.ResizeObserver) {
        let sirka = el("graf-blizko").clientWidth;
        new ResizeObserver(() => {
          const w = el("graf-blizko").clientWidth;
          if (Math.abs(w - sirka) > 8) { sirka = w; vykresliGraf(); }
        }).observe(el("graf-blizko"));
      }
    } catch (e) {
      el("blizko-cisla").setAttribute("aria-busy", "false");
      el("blizko-cisla").innerHTML = `<div class="cisla-chyba">${chybaHtml("Údaje se teď nepodařilo načíst.", e, "Zkuste stránku načíst znovu.")}</div>`;
    }
  }
  function prepniBlizko(kat) {
    stav.blizkoKat = kat;
    document.querySelectorAll("#blizko [data-blizko]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.blizko === kat)));
    if (stav.blizko) vykresliBlizko();
  }
  function vykresliBlizko() {
    const k = BLIZKO[stav.blizkoKat], data = stav.blizko[stav.blizkoKat];
    const daleko = data.filter((r) => jeDaleko(r, k.limit)).sort(podleDoby);
    const seniori = daleko.reduce((s, r) => s + (r.seniori || 0), 0);
    const priklad = daleko.find((r) => r.mimo_min !== null && r.seniori > 0 && r.odjezd && r.navrat);
    const box = el("blizko-cisla");
    box.setAttribute("aria-busy", "false");
    box.innerHTML = klicove(esc(obciSlovy(daleko.length)),
      `má ${esc(k.co)} do ${k.limit}${NBSP}km vzdušnou čarou, a přesto je cesta ${esc(k.kam)} veřejnou dopravou na 3${NBSP}hodiny a víc, nebo se tam v jeden den nedá dojet. Žije v nich ${cislo(seniori)}${NBSP}lidí nad 65 let.`,
      priklad ? `Například ${esc(priklad.obec)}: ${esc(k.nejblizsi.toLowerCase())} je ${esc(km(priklad.km))} daleko, ale spoj jede ${esc(vCase(priklad.odjezd))} a domů se vrátíte ${esc(vCase(priklad.navrat))}. Celkem ${esc(doba(priklad.mimo_min))}.` : "");
    vykresliGraf();

    const otevreno = el("blizko-seznam") ? el("blizko-seznam").open : false;
    const radky = daleko.map((r) => `<tr>
      <th scope="row">${esc(r.obec)}</th>
      <td data-popis="${esc(k.nejblizsi)}">${esc(km(r.km))}</td>
      <td data-popis="Tam a zpět">${esc(r.mimo_min === null ? "nejde v jeden den" : doba(r.mimo_min))}</td>
      <td data-popis="Odjezd a návrat">${r.odjezd && r.navrat ? `${esc(r.odjezd)} až ${esc(r.navrat)}` : "bez spojení"}</td>
      <td data-popis="Kam se dostanete nejrychleji">${esc(r.cil_obec || "nikam")}</td>
      <td data-popis="Lidé nad 65 let">${cislo(r.seniori)}</td></tr>`).join("");
    el("blizko-tabulka").innerHTML = daleko.length ? seznamObci("blizko-seznam", "Seznam obcí", daleko.length,
      "Seřazeno od nejdelší doby mimo domov. Vzdálenost je vzdušnou čarou k nejbližšímu místu. Odjezd a návrat platí pro nejrychlejší možnost v pracovní den, doba je včetně 45 minut na místě.",
      ["Obec", k.nejblizsi, "Tam a zpět", "Odjezd a návrat", "Kam nejrychleji", "Lidé nad 65 let"], radky, "tabulka-blizko") : "";
    if (otevreno && el("blizko-seznam")) el("blizko-seznam").open = true;
  }

  /* bodový graf: vzdálenost (km) × doba mimo domov (h); vlastní SVG, barvy z tokenů přes CSS třídy */
  function vykresliGraf() {
    const box = el("graf-blizko");
    if (!stav.blizko || !box) return;
    const k = BLIZKO[stav.blizkoKat], data = stav.blizko[stav.blizkoKat];
    const W = Math.max(300, Math.round(box.clientWidth || 720)), uzky = W < 600;
    const H = uzky ? 380 : 460;
    const m = { l: uzky ? 46 : 58, r: uzky ? 10 : 20, t: 40, b: 60 };
    const krokX = k.limit > 10 ? 5 : 2;
    const xMax = Math.ceil(Math.max(k.limit + krokX, ...data.map((r) => r.km)) / krokX) * krokX;
    const yMaxH = Math.max(6, Math.ceil(Math.max(...data.map((r) => (r.mimo_min || 0) / 60))));
    const yBez = yMaxH + 0.8, yTop = yMaxH + 1.3;   // pás „bez spojení“ nad grafem
    const x = (v) => m.l + (v / xMax) * (W - m.l - m.r);
    const y = (h) => H - m.b - (h / yTop) * (H - m.t - m.b);
    const yBodu = (r) => (r.mimo_min === null ? y(yBez) : y(r.mimo_min / 60));
    const daleko = data.filter((r) => jeDaleko(r, k.limit)).sort(podleDoby);
    const ostatni = data.filter((r) => !jeDaleko(r, k.limit));
    const titulek = (r) => `${r.obec}: ${km(r.km)} vzdušnou čarou, ${r.mimo_min === null ? "tam a zpět v jeden den nejde" : `tam a zpět ${doba(r.mimo_min)}`}`;
    const t = [];
    t.push(`<rect class="zona" x="${x(0)}" y="${y(yTop)}" width="${x(k.limit) - x(0)}" height="${y(3) - y(yTop)}"/>`);
    t.push(`<rect class="bez-pas" x="${x(0)}" y="${y(yTop)}" width="${x(xMax) - x(0)}" height="${y(yMaxH + 0.35) - y(yTop)}"/>`);
    for (let h = 0; h <= yMaxH; h++) {
      t.push(`<line class="mrizka" x1="${x(0)}" x2="${x(xMax)}" y1="${y(h)}" y2="${y(h)}"/>`);
      t.push(`<text class="osa-text" x="${x(0) - 8}" y="${y(h) + 5}" text-anchor="end">${h}${NBSP}h</text>`);
    }
    t.push(`<text class="osa-text" x="${x(xMax) - 6}" y="${y(yBez) + 5}" text-anchor="end">bez spojení v jeden den</text>`);
    for (let v = 0; v <= xMax; v += krokX) {
      t.push(`<line class="mrizka" x1="${x(v)}" x2="${x(v)}" y1="${y(0)}" y2="${y(0) + 6}"/>`);
      t.push(`<text class="osa-text" x="${x(v)}" y="${y(0) + 24}" text-anchor="middle">${v}</text>`);
    }
    t.push(`<text class="osa-nadpis" x="${(x(0) + x(xMax)) / 2}" y="${H - 8}" text-anchor="middle">vzdálenost vzdušnou čarou (km)</text>`);
    t.push(`<text class="osa-nadpis" x="${x(0)}" y="${m.t - 22}">doba mimo domov</text>`);
    t.push(`<line class="zona-cara" x1="${x(0)}" x2="${x(xMax)}" y1="${y(3)}" y2="${y(3)}"/>`);
    t.push(`<line class="zona-cara" x1="${x(k.limit)}" x2="${x(k.limit)}" y1="${y(0)}" y2="${y(yTop)}"/>`);
    t.push(`<text class="zona-text" x="${x(k.limit) + 8}" y="${y(3) + 20}">3${NBSP}h</text>`);
    t.push(`<text class="zona-text" x="${x(0) + 10}" y="${y(yMaxH + 0.35) + 22}">${uzky ? "blízko, a přesto daleko" : `do ${k.limit}${NBSP}km, a přesto 3${NBSP}h a víc`}</text>`);
    for (const r of ostatni) t.push(`<circle class="bod" cx="${x(r.km).toFixed(1)}" cy="${yBodu(r).toFixed(1)}" r="5"><title>${esc(titulek(r))}</title></circle>`);
    for (const r of daleko) t.push(`<circle class="bod daleko" cx="${x(r.km).toFixed(1)}" cy="${yBodu(r).toFixed(1)}" r="7"><title>${esc(titulek(r))}</title></circle>`);
    // popisky nejhorších obcí bez překrývání: vpravo od bodu, jinak vlevo, jinak vynechat
    const obsazeno = [];
    const koliduje = (b) => obsazeno.some((o) => b.x1 < o.x2 && b.x2 > o.x1 && b.y1 < o.y2 && b.y2 > o.y1);
    for (const r of daleko.slice(0, uzky ? 4 : 7)) {
      const cx = x(r.km), cy = yBodu(r), w = r.obec.length * 8.6;
      const moznosti = [{ x1: cx + 10, x2: cx + 10 + w, kotva: "start", tx: cx + 10 }, { x1: cx - 10 - w, x2: cx - 10, kotva: "end", tx: cx - 10 }];
      const vol = moznosti.map((b) => ({ ...b, y1: cy - 11, y2: cy + 9 })).find((b) => b.x1 >= 0 && b.x2 <= W && !koliduje(b));
      if (!vol) continue;
      obsazeno.push(vol);
      t.push(`<text class="stitek" x="${vol.tx.toFixed(1)}" y="${(cy + 5).toFixed(1)}" text-anchor="${vol.kotva}">${esc(r.obec)}</text>`);
    }
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="graf-blizko-nadpis">
      <title id="graf-blizko-nadpis">Graf: ${esc(obciSlovy(daleko.length))} má ${esc(k.co)} do ${k.limit} km, a přesto je cesta ${esc(k.kam)} na 3 hodiny a víc. Seznam obcí je v tabulce pod grafem.</title>
      ${t.join("")}</svg>`;
  }


  /* ---------- 2. Spádové oblasti ---------- */
  let mapaSpady = null, vrstvaKm = null, vrstvaCas = null, vrstvaRozdil = null, znacky = null;

  function stylSpadu(f) {
    const p = f.properties, tlum = stav.rozdil;
    if (!p.nemocnice) {
      return { stroke: true, color: barvy.obrys, weight: 0.6, opacity: 0.8, fill: true, fillColor: "url(#mapa-spady-bez)", fillOpacity: tlum ? 0.35 : 0.9 };
    }
    return { stroke: true, color: barvy.obrys, weight: 1.5, opacity: 0.9, fill: true,
             fillColor: `url(#mapa-spady-n${indexVzoru(p.nemocnice)})`, fillOpacity: tlum ? 0.22 : 0.78 };
  }
  function stylRozdilu(f) {
    if (!stav.rozdil) return { stroke: false, fill: true, fillColor: barvy.obrys, fillOpacity: 0 };  // neviditelné, ale klepnutí ukáže podrobnosti
    const id = f.properties[stav.varianta];
    return { stroke: true, color: barvy.ink, weight: 1.6, opacity: 1, fill: true,
             fillColor: `url(#mapa-spady-n${indexVzoru(id)})`, fillOpacity: 0.95 };
  }
  function popupSpadu(p) {
    const nem = p.nemocnice ? stav.nemocnice.get(p.nemocnice) : null;
    if (!nem) {
      return `<p class="popup-obec">Bez spoje do nemocnice</p>
        <p>Odsud se do žádné nemocnice veřejnou dopravou nedostanete tam a zpět v jeden den.</p>
        ${stav.souhrn ? `<p class="male">V takových místech bydlí ${esc(lidi(stav.souhrn.souhrn.seniori_bez_spojeni))} lidí nad 65 let.</p>` : ""}`;
    }
    const kmVar = p.varianta === "km";
    return `<p class="popup-obec">Nemocnice ${esc(vMeste(nem.mesto))}</p>
      <p>${kmVar ? "Podle vzdálenosti: odsud je to nejbližší nemocnice vzdušnou čarou." : "Podle spojů: odsud u ní strávíte nejméně času mimo domov."}</p>
      <p class="male">V celé této oblasti bydlí ${esc(lidi(kmVar ? nem.obyvatel_km : nem.obyvatel_cas))} lidí, z toho ${esc(lidi(kmVar ? nem.seniori_km : nem.seniori_cas))} nad 65 let.</p>`;
  }
  function popupRozdilu(p) {
    const nk = stav.nemocnice.get(p.km), nc = stav.nemocnice.get(p.cas);
    if (!nk || !nc) return "";
    const tamKm = p.mimo_km === null ? "tam a zpět se do ní v jeden den nedostanete" : `tam a zpět ${doba(p.mimo_km)}`;
    return `<p class="popup-obec">${esc(p.obec)} <span class="male">(${esc(lidi(p.obyvatel))} obyvatel)</span></p>
      <p>Nejblíž vzdušnou čarou: nemocnice ${esc(vMeste(nk.mesto))}, ${esc(km(p.km_km))}, ${esc(tamKm)}.</p>
      <p>Nejrychleji spojem: nemocnice ${esc(vMeste(nc.mesto))}, tam a zpět <strong>${esc(doba(p.mimo_cas))}</strong>, cesta tam ${esc(doba(p.cesta_cas))}.</p>
      ${p.uspora !== null && p.uspora >= 5 ? `<p class="male">Rozdíl ${esc(doba(p.uspora))}.</p>` : ""}`;
  }

  function vykresliLegenduSpadu() {
    const ul = el("legenda-spady");
    const s = stav.souhrn;
    if (!s) return;
    const polozky = s.nemocnice.map((n) => `<li><i class="vzor vzor-${indexVzoru(n.id)}" aria-hidden="true"></i>${esc(n.mesto)}</li>`);
    polozky.push(`<li><i class="vzor vzor-bez" aria-hidden="true"></i>bez spoje tam a zpět v jeden den</li>`);
    polozky.push(`<li><i class="vzor vzor-rozdil" aria-hidden="true"></i>místa, kde se obě mapy liší</li>`);
    ul.innerHTML = polozky.join("");
  }

  function popisSpadu() {
    const s = stav.souhrn && stav.souhrn.souhrn;
    let t = stav.varianta === "km"
      ? "Podle vzdálenosti: každé místo má barvu a vzor nemocnice, která je nejblíž vzdušnou čarou. Tak se spádovost obvykle kreslí."
      : "Podle spojů: každé místo má barvu a vzor nemocnice, u které strávíte veřejnou dopravou nejméně času. Šrafovaná místa nemají spoj tam a zpět v jeden den.";
    if (stav.rozdil && s) {
      t += ` Zvýrazněná místa jsou ta, kde se obě mapy liší. Bydlí v nich ${cislo(s.obyvatel_mista_lisi_se)} lidí, z toho ${cislo(s.seniori_mista_lisi_se)} nad 65 let.`;
    }
    el("spady-popis").textContent = t;
  }

  function prekresliSpady() {
    if (!mapaSpady) { popisSpadu(); return; }
    const [zobrazit, skryt] = stav.varianta === "km" ? [vrstvaKm, vrstvaCas] : [vrstvaCas, vrstvaKm];
    if (mapaSpady.hasLayer(skryt)) mapaSpady.removeLayer(skryt);
    if (!mapaSpady.hasLayer(zobrazit)) zobrazit.addTo(mapaSpady);
    zobrazit.setStyle(stylSpadu);
    zobrazit.bringToBack();
    vrstvaRozdil.setStyle(stylRozdilu);
    vrstvaRozdil.bringToFront();
    if (znacky) znacky.eachLayer((z) => z.bringToFront());
    mapaSpady.closePopup();
    popisSpadu();
  }
  function prepniVariantu(nova, zapsat = true) {
    stav.varianta = nova;
    document.querySelectorAll("#spady-sekce .prepinac button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.varianta === nova)));
    prekresliSpady();
    if (zapsat) zapisAdresu();
  }
  function prepniRozdil(zapnout = !stav.rozdil, zapsat = true) {
    stav.rozdil = zapnout;
    el("ukaz-rozdil").setAttribute("aria-pressed", String(stav.rozdil));
    prekresliSpady();
    if (zapsat) zapisAdresu();
  }

  /* stav stránky v adrese (#obec=555347&spady=cas&rozdil=1) – odkaz se dá poslat dál nebo pustit v prezentaci */
  function zapisAdresu() {
    const casti = [];
    if (stav.vybrana) casti.push(`obec=${stav.vybrana}`);
    if (stav.den !== "pd") casti.push(`den=${stav.den}`);
    if (stav.varianta !== "km") casti.push(`spady=${stav.varianta}`);
    if (stav.rozdil) casti.push("rozdil=1");
    try { history.replaceState(null, "", casti.length ? `#${casti.join("&")}` : location.pathname + location.search); } catch (e) { /* bez historie to jde i tak */ }
  }
  function prectiAdresu() {
    const h = new URLSearchParams(location.hash.replace(/^#/, ""));
    return { obec: /^\d{6}$/.test(h.get("obec") || "") ? h.get("obec") : null, spady: h.get("spady") === "cas" ? "cas" : null, rozdil: h.get("rozdil") === "1",
             den: ["so", "ne"].includes(h.get("den")) ? h.get("den") : "pd" };
  }

  async function nactiMapuSpadu(spady, obce) {
    try {
      if (!window.L) throw new Error("Mapový podklad se nepodařilo načíst. Zkontrolujte připojení k internetu.");
      const L = window.L;
      mapaSpady = novaMapa("mapa-spady");
      const prvky = (v) => ({ type: "FeatureCollection", features: spady.features.filter((f) => f.properties.varianta === v) });
      const popup = (f, v) => v.bindPopup(() => popupSpadu(f.properties), { maxWidth: 320 });
      vrstvaKm = L.geoJSON(prvky("km"), { style: stylSpadu, onEachFeature: popup });
      vrstvaCas = L.geoJSON(prvky("cas"), { style: stylSpadu, onEachFeature: popup });
      mapaSpady.fitBounds(vrstvaKm.getBounds(), { padding: [4, 4] });
      vrstvaKm.addTo(mapaSpady);
      if (obce) hraniceSpady = L.geoJSON(obce, { style: stylHranic, interactive: false }).addTo(mapaSpady);
      vrstvaRozdil = L.geoJSON(prvky("rozdil"), { style: stylRozdilu,
        onEachFeature: (f, v) => v.bindPopup(() => popupRozdilu(f.properties), { maxWidth: 340 }) }).addTo(mapaSpady);
      znacky = L.layerGroup().addTo(mapaSpady);
      for (const n of stav.souhrn.nemocnice) {
        L.circleMarker([n.lat, n.lon], { radius: 8, color: barvy.obrys, weight: 3, fillColor: barvy.ink, fillOpacity: 1 })
          .bindTooltip(n.mesto, { permanent: true, direction: "top", offset: [0, -10], className: "stitek-nemocnice" })
          .bindPopup(`<p class="popup-obec">${esc(n.nazev)}</p><p class="male">${esc(n.mesto)}</p>`)
          .addTo(znacky);
      }
      pridejVzory("mapa-spady", true);
      ukazStav("mapa-spady-stav", null);
      prekresliSpady();
      setTimeout(() => mapaSpady && mapaSpady.invalidateSize(), 150);
    } catch (e) {
      ukazStav("mapa-spady-stav", chybaHtml("Mapu se nepodařilo načíst.", e, "Výsledky najdete v číslech a v tabulce obcí."));
    }
  }

  /* čísla vedle mapy a sbalená tabulka seniorů podle nemocnic */
  function vykresliCisla() {
    const s = stav.souhrn, x = s.souhrn;
    el("spady-cisla").innerHTML =
      klicove(esc(obciSlovy(x.obce_lisi_se)),
        `ze ${cislo(x.obci)} má nejblíž jinou nemocnici, než do které se veřejnou dopravou dostanou nejrychleji.`)
      + klicove(`${cislo(x.seniori_v_obcich_lisi_se_vyrazne)} seniorů`,
        `žije ${esc(veObcich(x.obce_lisi_se_vyrazne))}, kde jinou než nejbližší nemocnicí ušetří aspoň půl hodiny. U poloviny z nich je to ${esc(doba(x.median_uspora_vyrazne_min))} a víc.`);
    el("spady-cisla").setAttribute("aria-busy", "false");
    karta("karta-nemocnice", obciSlovy(x.obce_lisi_se), "má nejblíž jinou nemocnici, než do které se veřejnou dopravou dostane nejrychleji.");

    const zmena = (n) => { const d = n.seniori_cas - n.seniori_km; return d === 0 ? "beze změny" : `${d > 0 ? "+" : "−"}${cislo(Math.abs(d))}`; };
    const radky = s.nemocnice.map((n) => `<tr><th scope="row"><span class="nem-nazev"><i class="vzor vzor-${indexVzoru(n.id)}" aria-hidden="true"></i><span>${esc(n.mesto)}</span></span></th>
      <td>${cislo(n.seniori_km)}</td><td>${cislo(n.seniori_cas)}</td><td>${esc(zmena(n))}</td></tr>`).join("");
    el("spady-nemocnice").innerHTML = `<details class="rozbalit" id="spady-tabulka">
      <summary><i class="ph-bold ph-caret-right" aria-hidden="true"></i><span>Kolik seniorů patří ke které nemocnici</span></summary>
      <div class="rozbalit-obsah"><div class="tabulka-posun"><table class="tabulka-nemocnic" aria-label="Lidé nad 65 let ve spádové oblasti nemocnice">
        <thead><tr><th scope="col">Nemocnice</th><th scope="col">Podle vzdálenosti</th><th scope="col">Podle spojů</th><th scope="col">Rozdíl</th></tr></thead>
        <tbody>${radky}</tbody>
      </table></div></div>
    </details>`;
  }

  /* jeden výrazný příklad pod mapou: nemocnice o kilometry dál, a přesto je člověk dřív doma (Boží Dar) */
  const PRIKLAD_OBEC = "506486";   // Boží Dar
  const Z_OBCE = { "Boží Dar": "Z Božího Daru" };
  function vykresliPriklad() {
    const n = (id) => stav.nemocnice.get(id);
    const vhodne = stav.souhrn.obce.filter((o) => o.lisi_se && o.mimo_km !== null && o.mimo_cas !== null && o.uspora >= 20 && o.cas_km > o.km_km);
    const o = vhodne.find((x) => x.kod_obce === PRIKLAD_OBEC)
      || vhodne.sort((a, b) => (b.cas_km - b.km_km) * b.uspora - (a.cas_km - a.km_km) * a.uspora)[0];
    if (!o) return;
    const nk = n(o.km), nc = n(o.cas);
    const nejdele = Math.max(o.mimo_km, o.mimo_cas);
    const radek = (nadpis, nem, vzdalenost, min, rychlejsi) => `
      <div class="srovnani-radek${rychlejsi ? " rychlejsi" : ""}">
        <p class="srovnani-popis"><span class="male">${esc(nadpis)}</span><br><strong>Nemocnice ${esc(vMeste(nem.mesto))}</strong>, ${esc(km(vzdalenost))}</p>
        <div class="srovnani-pruh" aria-hidden="true"><span style="width:${(100 * min / nejdele).toFixed(1)}%"></span></div>
        <p class="srovnani-cas">tam a zpět <strong>${esc(doba(min))}</strong></p>
      </div>`;
    const kmKlame = el("km-klame");
    kmKlame.innerHTML = `
      <h3>O kilometry dál, a přesto dřív doma</h3>
      <p class="sloupec-textu">${esc(Z_OBCE[o.obec] || `Z obce ${o.obec}`)} je nejblíž nemocnice ${esc(vMeste(nk.mesto))}. Nemocnice ${esc(vMeste(nc.mesto))}
        je o ${esc(km(o.cas_km - o.km_km))} dál, a přesto jste z ní veřejnou dopravou doma o <strong>${esc(doba(o.uspora))}</strong> dřív.</p>
      <div class="srovnani">
        ${radek("Nejblíž vzdušnou čarou", nk, o.km_km, o.mimo_km, false)}
        ${radek(`O ${km(o.cas_km - o.km_km)} dál`, nc, o.cas_km, o.mimo_cas, true)}
      </div>
      <p class="male sloupec-textu">Doba tam a zpět je průměr za obec vážený počtem obyvatel, včetně 45 minut v nemocnici, v pracovní den.</p>`;
    kmKlame.hidden = false;
  }
  /* ---------- 3. Úřady ----------
     Úřady se nevybírají podle vzdálenosti: každá obec patří pod svůj úřad ORP. Počítáme cestu tam a zpět na ten vlastní. */
  const DLOUHO_NA_URAD = 180, VELMI_DLOUHO_NA_URAD = 240;
  const nejdeNeboNad = (o, min) => o.mimo_orp_uradni === null || o.mimo_orp_uradni >= min;
  function obceDlouhoNaUrad() {
    const obce = (stav.souhrn.obce || []).filter((o) => o.orp_uradni);   // Hradiště (vojenský újezd) ORP nemá
    const problem = obce.filter((o) => nejdeNeboNad(o, DLOUHO_NA_URAD))
      .sort((a, b) => (b.mimo_orp_uradni ?? 1e4) - (a.mimo_orp_uradni ?? 1e4) || b.seniori - a.seniori);
    return { obce, problem, seniori: problem.reduce((s, o) => s + (o.seniori || 0), 0) };
  }
  function vykresliOrp() {
    const box = el("urady-obsah");
    const { obce, problem, seniori } = obceDlouhoNaUrad();
    box.setAttribute("aria-busy", "false");
    if (!obce.length) { box.innerHTML = ""; kartaChyba("karta-urady"); return; }
    karta("karta-urady", obciSlovy(problem.length), `má cestu na vlastní úřad a zpět delší než 3${NBSP}hodiny, nebo se tam v jeden den nedá dojet.`);
    if (!problem.length) { box.innerHTML = `<p>Ze všech obcí se na vlastní úřad dá dojet tam a zpět do 3 hodin.</p>`; return; }

    const velmi = problem.filter((o) => nejdeNeboNad(o, VELMI_DLOUHO_NA_URAD)).length;
    const podleUradu = new Map();
    problem.forEach((o) => podleUradu.set(o.orp_uradni, (podleUradu.get(o.orp_uradni) || 0) + 1));
    const nejvic = [...podleUradu].sort((a, b) => b[1] - a[1]).slice(0, 2);
    const vetaUrady = nejvic.length === 2
      ? `Nejvíc takových obcí patří pod úřad ${esc(vMeste(nejvic[0][0]))} (${nejvic[0][1]}) a ${esc(vMeste(nejvic[1][0]))} (${nejvic[1][1]}).` : "";

    const radky = problem.map((o) => `<tr>
      <th scope="row">${esc(o.obec)}</th>
      <td data-popis="Úřad, kam obec patří">${esc(o.orp_uradni)}</td>
      <td data-popis="Tam a zpět">${esc(o.mimo_orp_uradni === null ? "nejde v jeden den" : doba(o.mimo_orp_uradni))}</td>
      <td data-popis="Lidé nad 65 let">${cislo(o.seniori)}</td></tr>`).join("");

    box.innerHTML = klicove(esc(obciSlovy(problem.length)),
        `ze ${cislo(obce.length)} má cestu na vlastní úřad tam a zpět delší než 3${NBSP}hodiny, nebo se tam v jeden den nedá dojet. Žije v nich ${cislo(seniori)}${NBSP}lidí nad 65 let.`
        + (velmi ? ` ${esc(velke(obciSlovy(velmi)))} z nich ${velmi >= 2 && velmi <= 4 ? "mají" : "má"} na úřad a zpět 4${NBSP}hodiny a víc.` : ""),
        vetaUrady)
      + seznamObci("urady-seznam", "Seznam obcí", problem.length,
        "Seřazeno od nejdelší cesty. Doba tam a zpět je průměr za obec vážený počtem obyvatel, včetně 45 minut na úřadě.",
        ["Obec", "Úřad, kam obec patří", "Tam a zpět", "Lidé nad 65 let"], radky, "tabulka-urady");
  }

  /* ---------- Kde chybí Senior Expres (/mapa/senior-expres, P-11) ---------- */
  async function nactiSeniorExpres() {
    const box = el("se-obsah");
    try {
      const d = await D.api("/mapa/senior-expres");
      const radky = d.obce.map((o) => `<tr>
        <th scope="row">${esc(o.obec)}</th>
        <td data-popis="Úřad ORP">${esc(o.orp || "")}</td>
        <td data-popis="Lidé nad 65 let">${cislo(o.seniori)}</td>
        <td data-popis="Dostupnost">${esc(o.hodnoceni || "")}</td>
        <td data-popis="Lékař, zubař a nemocnice">${esc(o.prumer_min === null ? "nejde v jeden den" : doba(o.prumer_min))}</td>
        <td data-popis="Poznámka">${esc(o.poznamka || "")}</td></tr>`).join("");
      const vuz = (d.vuz_bez_provozu || []).slice(0, 4);
      karta("karta-se", obciSlovy(d.bez_se_obci), `z ${d.problemove_obci} s nejhorší dostupností lékařů nemá Senior Expres. Žije v nich ${cislo(d.bez_se_seniori)}${NBSP}seniorů.`);
      box.innerHTML = klicove(esc(obciSlovy(d.bez_se_obci)),
          `z ${d.problemove_obci}, kde cesta k lékaři a zpět trvá přes 3${NBSP}hodiny nebo nejde vůbec, nemá Senior Expres. Žije v nich ${cislo(d.bez_se_seniori)}${NBSP}seniorů.
          Dalších ${esc(obciSlovy(d.stredni_bez_se_obci))} se střední dostupností a ${cislo(d.stredni_bez_se_seniori)}${NBSP}seniory ho nemá také.`,
          vuz.length ? `Kraj v posledních letech dotoval vozy pro Senior Expres i v obcích ${esc(vuz.join(", "))}. Jak tam službu objednat, jsme na webech obcí nenašli. Služba možná jezdí, jen o ní obec na webu nepíše.` : "")
        + seznamObci("se-seznam", "Obce s nejhorší dostupností bez Senior Expresu", d.obce.length,
          "Seřazeno od nejhorší dostupnosti a nejvíc seniorů. Doba tam a zpět je průměr cesty k praktikovi, zubaři a do nemocnice v pracovní den, včetně 45 minut na místě.",
          ["Obec", "Úřad ORP", "Lidé nad 65 let", "Dostupnost", "Tam a zpět průměrně", "Poznámka"], radky, "tabulka-se");
    } catch (e) {
      box.innerHTML = chybaHtml("Údaje o Senior Expresu se teď nepodařilo načíst.", e, "Zkuste stránku načíst znovu.");
      kartaChyba("karta-se");
    }
    box.setAttribute("aria-busy", "false");
  }

  /* ---------- Pohotovost v sobotu (/mapa/pohotovost, P-12 víkendová varianta) ---------- */
  async function nactiPohotovost() {
    const box = el("poh-obsah");
    try {
      const d = await D.api("/mapa/pohotovost");
      const radky = d.obce.map((o) => `<tr>
        <th scope="row">${esc(o.obec)}</th>
        <td data-popis="Úřad ORP">${esc(o.orp || "")}</td>
        <td data-popis="Lidé nad 65 let">${cislo(o.seniori)}</td>
        <td data-popis="Proč">${esc(o.stav || "")}</td></tr>`).join("");
      karta("karta-pohotovost", `${cislo(d.seniori_bez_navratu)} seniorů`,
        `Každý ${d.jeden_z_kolika}. senior v kraji se v sobotu dopoledne nedostane veřejnou dopravou na pohotovost a zpátky.`);
      box.innerHTML = klicove(`${cislo(d.seniori_bez_navratu)} seniorů`,
          `tedy každý ${esc(String(d.jeden_z_kolika))}. senior v kraji, se v sobotu dopoledne veřejnou dopravou nedostane na pohotovost a zpátky domů.
          ${esc(zObci(d.obci_bez_navratu))} tam v sobotu dopoledne nejede nic, žije v nich ${cislo(d.seniori_obci_bez_navratu)}${NBSP}seniorů.`,
          d.obci_dobre_pres_den ? `${esc(velke(veObcich(d.obci_dobre_pres_den)))} z nich přitom ve všední den jezdí spoje k lékaři dobře. V běžné mapě dostupnosti se to proto neukáže.` : "")
        + seznamObci("poh-seznam", "Obce, odkud se v sobotu na pohotovost nedostanete", d.obce.length,
          `Sobota 17.${NBSP}10.${NBSP}2026, odjezd z domova mezi 8. a 13. hodinou, hodina na pohotovosti. Otevřeno mají pohotovosti v Karlových Varech, Chebu, Sokolově, Mariánských Lázních a Aši. Seřazeno podle počtu seniorů.`,
          ["Obec", "Úřad ORP", "Lidé nad 65 let", "Proč"], radky, "tabulka-poh");
    } catch (e) {
      box.innerHTML = chybaHtml("Údaje o pohotovosti se teď nepodařilo načíst.", e, "Zkuste stránku načíst znovu.");
      kartaChyba("karta-pohotovost");
    }
    box.setAttribute("aria-busy", "false");
  }

  /* ---------- lepící obsah stránky: výška hlavičky a zvýraznění části, kde právě jste ---------- */
  function navigace() {
    const hlavicka = document.querySelector(".web-hlavicka"), nav = el("mapa-nav");
    if (!nav) return;
    const odkazy = [...nav.querySelectorAll("a[href^='#']")];
    const oddily = odkazy.map((a) => el(a.hash.slice(1))).filter(Boolean);
    let horni = 0;
    const zmer = () => {
      horni = hlavicka && getComputedStyle(hlavicka).position === "sticky" ? hlavicka.offsetHeight : 0;
      document.documentElement.style.setProperty("--hlavicka", `${horni}px`);
    };
    zmer();
    if (window.ResizeObserver && hlavicka) new ResizeObserver(zmer).observe(hlavicka);
    window.addEventListener("resize", zmer);

    let aktivni = null, ceka = false;
    const oznac = () => {
      ceka = false;
      const hranice = horni + nav.offsetHeight + 120;
      let id = oddily[0] && oddily[0].id;
      for (const o of oddily) if (o.getBoundingClientRect().top <= hranice) id = o.id;
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) id = oddily[oddily.length - 1].id;
      if (id === aktivni) return;
      aktivni = id;
      odkazy.forEach((a) => {
        const je = a.hash === `#${id}`;
        if (je) a.setAttribute("aria-current", "location"); else a.removeAttribute("aria-current");
        if (je) {   // na telefonu se obsah posouvá do strany: aktivní položku držet na očích
          const ul = a.closest("ul"), u = ul.getBoundingClientRect(), r = a.getBoundingClientRect();
          if (r.left < u.left || r.right > u.right - 40) ul.scrollLeft = Math.max(0, ul.scrollLeft + r.left - u.left - 16);
        }
      });
    };
    window.addEventListener("scroll", () => { if (!ceka) { ceka = true; setTimeout(oznac, 80); } }, { passive: true });
    oznac();
    // odkaz na postup výpočtu (/mapa#metoda) rovnou rozbalí sbalený text
    const otevriMetodu = () => { if (location.hash === "#metoda") el("metoda").open = true; };
    otevriMetodu();
    window.addEventListener("hashchange", otevriMetodu);
  }

  /* ---------- světlý / tmavý vzhled ---------- */
  function zmenaVzhledu() {
    barvy = prectiBarvy();
    obarviVzory("mapa-obce"); obarviVzory("mapa-spady");
    if (hexy) hexy.setStyle(stylHex);
    if (hraniceObce) hraniceObce.setStyle(stylHranic);
    if (hraniceSpady) hraniceSpady.setStyle(stylHranic);
    if (mapaSpady) prekresliSpady();
    if (znacky) znacky.eachLayer((z) => z.setStyle({ color: barvy.obrys, fillColor: barvy.ink }));
  }

  /* ---------- start ---------- */
  async function start() {
    barvy = prectiBarvy();
    navigace();
    vykresliLegenduObce();
    popisSpadu();
    document.querySelectorAll("#obec-sekce [data-kategorie]").forEach((b) => b.addEventListener("click", () => prepniKategorii(b.dataset.kategorie)));
    document.querySelectorAll("#obec-sekce [data-den]").forEach((b) => b.addEventListener("click", () => prepniDen(b.dataset.den)));
    document.querySelectorAll("#blizko [data-blizko]").forEach((b) => b.addEventListener("click", () => prepniBlizko(b.dataset.blizko)));
    document.querySelectorAll("#spady-sekce .prepinac button").forEach((b) => b.addEventListener("click", () => prepniVariantu(b.dataset.varianta)));
    el("ukaz-rozdil").addEventListener("click", () => prepniRozdil());
    const adresa = prectiAdresu();
    if (adresa.spady) prepniVariantu(adresa.spady, false);
    if (adresa.rozdil) prepniRozdil(true, false);
    window.addEventListener("dojedeme:vzhled", zmenaVzhledu);
    const tmavy = window.matchMedia("(prefers-color-scheme: dark)");
    if (tmavy.addEventListener) tmavy.addEventListener("change", zmenaVzhledu);

    nactiPrehled();
    const pObce = D.api("/obce"), pH3 = D.api("/mapa/h3"), pHranice = D.api("/mapa/obce").catch(() => null);
    const pSpady = D.api("/mapa/spady"), pSouhrn = D.api("/mapa/spady/souhrn");
    nactiBlizko();
    nactiSeniorExpres();
    nactiPohotovost();

    // souhrn spádových oblastí: čísla, příklady, tabulka, úřady (nezávisle na mapách)
    const souhrnHotov = pSouhrn.then((s) => {
      stav.souhrn = s;
      s.nemocnice.forEach((n) => stav.nemocnice.set(n.id, n));
      s.obce.forEach((o) => stav.spadyObce.set(o.kod_obce, o));
      vykresliLegenduSpadu(); vykresliCisla(); vykresliPriklad(); vykresliOrp(); popisSpadu();
      el("ukaz-rozdil").disabled = false;
    }).catch((e) => {
      el("spady-cisla").setAttribute("aria-busy", "false");
      el("spady-cisla").innerHTML = chybaHtml("Výsledky se teď nepodařilo načíst.", e, "Zkuste stránku načíst znovu.");
      el("urady-obsah").setAttribute("aria-busy", "false");
      el("urady-obsah").innerHTML = chybaHtml("Údaje o úřadech se teď nepodařilo načíst.", e, "Zkuste stránku načíst znovu.");
      kartaChyba("karta-nemocnice"); kartaChyba("karta-urady");
    });

    // hledání a shrnutí obce
    const obceHotove = Promise.all([pObce, pH3.catch(() => null)]).then(([d, h3]) => {
      stav.obce = d.obce;
      d.obce.forEach((o) => stav.obcePodleKodu.set(o.kod_obce, o));
      if (h3) { stav.agregace = agreguj(h3); stav.h3.pd = h3; stav.agregaceDne.pd = stav.agregace; popisDne(); }
      pripravHledani();
      souhrnHotov.finally(() => {
        if (adresa.obec && stav.obcePodleKodu.has(adresa.obec)) {
          vyberObec(adresa.obec, { priblizit: true, fokus: false });
          el("obec-sekce").scrollIntoView({ block: "start" });
        } else if (adresa.spady || adresa.rozdil) el("spady-sekce").scrollIntoView({ block: "start" });
      });
    }).catch((e) => {
      el("obec-stav").textContent = `Seznam obcí se nepodařilo načíst. ${e.message}`;
    });

    // mapa 1
    Promise.all([pH3, pHranice]).then(([h3, hranice]) => nactiMapuObce(h3, hranice))
      .then(() => { if (adresa.den !== "pd") prepniDen(adresa.den, false); })
      .catch((e) => ukazStav("mapa-obce-stav", chybaHtml("Mapu se nepodařilo načíst.", e, "Zkuste stránku načíst znovu.")));
    // mapa 2
    Promise.all([pSpady, pHranice, souhrnHotov]).then(([spady, hranice]) => {
      if (!stav.souhrn) throw new Error("");
      return nactiMapuSpadu(spady, hranice);
    }).catch((e) => ukazStav("mapa-spady-stav", chybaHtml("Mapu spádových oblastí se nepodařilo načíst.", e, "Zkuste stránku načíst znovu.")));
  }

  start();
})();
