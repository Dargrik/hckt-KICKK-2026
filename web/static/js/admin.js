// Dojedeme – administrace (web/admin.html): přehled kraje, hexagonová mapa, tabulka obcí, export, log SMS.
// Vanilla JS (ES2020), bez build kroku. Formátování přes window.Dojedeme (dojedeme.js), barvy z CSS proměnných.
(function () {
  "use strict";
  const D = window.Dojedeme;
  const esc = D.esc;
  const $ = (s, r = document) => r.querySelector(s);
  const bezPohybu = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const tmavyRezim = window.matchMedia("(prefers-color-scheme: dark)");

  // ---------- formátování ----------
  const formaty = {};
  function cislo(n, des = 0) {
    if (n === null || n === undefined || isNaN(n)) return "–";
    const f = formaty[des] || (formaty[des] = new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: des, maximumFractionDigits: des }));
    return f.format(n);
  }
  const procent = (n, des = 1) => (n === null || n === undefined || isNaN(n) ? "–" : `${cislo(n, des)} %`);
  const sklonuj = (n, jedna, dva, pet) => (n === 1 ? jedna : n >= 2 && n <= 4 ? dva : pet);
  const bezDiakritiky = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const porovnejText = new Intl.Collator("cs").compare;
  const ikona = (n) => `<i class="ph-bold ph-${n}" aria-hidden="true"></i>`;

  /** Chyba lidsky: co se stalo + co udělat (volitelně tlačítko „Zkusit znovu“). */
  function chybaHtml(text, znovu) {
    const tlacitko = znovu
      ? `<span class="akce-radek"><button class="tlacitko vedlejsi" type="button" data-znovu="${esc(znovu)}">${ikona("arrow-clockwise")}Zkusit znovu</button></span>`
      : "";
    return `<div class="blok chyba" role="alert"><i class="ph-bold ph-warning ikona" aria-hidden="true"></i><span><strong>${esc(text)}</strong>${tlacitko}</span></div>`;
  }
  function hlas(text) { const el = $("#hlaseni"); el.textContent = ""; window.setTimeout(() => { el.textContent = text; }, 50); }

  // ---------- číselníky ----------
  const METRIKY = [
    { klic: "praktik", nazev: "Praktický lékař", ikona: "stethoscope", pole: "mimo_domov_praktik_min" },
    { klic: "zubar", nazev: "Zubař", ikona: "tooth", pole: "mimo_domov_zubar_min" },
    { klic: "gynekolog", nazev: "Gynekolog", ikona: "gender-female", pole: "mimo_domov_gynekolog_min" },
    { klic: "ocni", nazev: "Oční", dlouhy: "Oční lékař", ikona: "eye", pole: "mimo_domov_ocni_min" },
    { klic: "nemocnice", nazev: "Nemocnice", ikona: "hospital", pole: "mimo_domov_nemocnice_min" },
    { klic: "urad_orp", nazev: "Úřad ORP", ikona: "bank", pole: "mimo_domov_urad_orp_min" },
    { klic: "prumer", nazev: "Průměr", dlouhy: "Průměr (praktický lékař, zubař, nemocnice)", ikona: "chart-bar", pole: "prumer_mimo_domov_h", hodiny: true },
  ];
  const nazevMetriky = (m) => m.dlouhy || m.nazev;
  /** Doba mimo domov v minutách pro hexagon nebo obec (null = bez spojení). */
  function minutyMetriky(p, m) {
    const v = p[m.pole];
    return v === null || v === undefined ? null : m.hodiny ? v * 60 : v;
  }
  // hodnocení obce ↔ stupnice mapy: dobrá do 2 h, střední 2–3 h (Map3), špatná 3–4 h (Map4), kritická 4 h+ (Map6)
  const HODNOCENI = {
    "dobrá": { poradi: 0, trida: "b-m1" },
    "střední": { poradi: 1, trida: "b-m3" },
    "špatná": { poradi: 2, trida: "b-m4" },
    "kritická": { poradi: 3, trida: "b-m6" },
    "bez spojení": { poradi: 4, trida: "b-m0" },
  };
  const SPATNE = new Set(["špatná", "kritická", "bez spojení"]);
  function hodnoceniHtml(h) {
    if (!h) return "–";
    const x = HODNOCENI[h] || { trida: "b-m0" };
    return `<span class="hodnoceni"><i class="vzorek ${x.trida}" aria-hidden="true"></i>${esc(h)}</span>`;
  }
  const dobaText = (min) => (min === null || min === undefined ? "bez spojení" : D.minuty(min));

  // ---------- stav ----------
  const stav = {
    statistiky: null,
    obce: [],
    obcePodleKodu: new Map(),
    razeni: { sloupec: "prumer_mimo_domov_h", smer: "desc" },
    filtrOrp: "",
    filtrText: "",
    zobrazene: [],
    vybrana: null,
    metrika: METRIKY[0],
    hranice: false,
    zvyraznit: false,
  };

  // =====================================================================================
  // PŘEHLED KRAJE
  // =====================================================================================
  async function nactiPrehled() {
    $("#prehled-chyba").innerHTML = "";
    const [s, z] = await Promise.allSettled([D.api("/statistiky"), D.api("/zdravi")]);
    if (s.status === "fulfilled") {
      stav.statistiky = s.value;
      if (s.value.hexagonu) $("#hexagonu-pocet").textContent = cislo(s.value.hexagonu);
    }
    vykresliDlazdice(s.status === "fulfilled" ? s.value : null, z.status === "fulfilled" ? z.value : null);
    vykresliHodnoceni(s.status === "fulfilled" ? s.value : null);
    vykresliMedian();
    const chyba = [s, z].find((x) => x.status === "rejected");
    if (chyba) $("#prehled-chyba").innerHTML = chybaHtml(`Část přehledu se nenačetla. ${chyba.reason.message}`, "prehled");
  }

  function vykresliDlazdice(s, z) {
    const d = [];
    if (s) {
      d.push({ nazev: "Obyvatel kraje", hodnota: cislo(s.obyvatel_kraj), pozn: `ve ${cislo(s.obci)} obcích` });
      d.push({ nazev: "Senioři 65+", hodnota: cislo(s.seniori_kraj), pozn: `${procent(s.podil_senioru_pct)} obyvatel` });
      d.push({ nazev: "Senioři s cestou k lékaři nad 3 h nebo bez spojení", hodnota: cislo(s.seniori_nad_3h_nebo_bez_spojeni),
               pozn: `každý ${esc(s.jeden_z_kolika_senioru)}. senior v kraji (${procent(s.podil_senioru_nad_3h_pct)})`, dulezita: true });
    }
    if (z) {
      const jr = z.jizdni_rady || {};
      let pozn = "";
      if (jr.aktualizovano) {
        const a = new Date(jr.aktualizovano);
        if (!isNaN(a)) pozn = `Aktualizováno ${D.datum(jr.aktualizovano)} ${predlozkaCasu(a)} ${D.cas(a)}`;
      }
      let varovani = "";
      if (jr.plati_do) {
        const dni = Math.round((new Date(jr.plati_do + "T00:00:00") - new Date(new Date().toDateString())) / 864e5);
        if (dni < 14) {
          const text = dni < 0 ? "Jízdní řády už neplatí. Spoje mohou být chybné, zkontrolujte noční aktualizaci."
            : `Jízdní řády přestanou platit za ${dni} ${sklonuj(dni, "den", "dny", "dní")}. Zkontrolujte noční aktualizaci.`;
          varovani = `<div class="blok upozorneni"><i class="ph-bold ph-calendar-x ikona" aria-hidden="true"></i><span>${text}</span></div>`;
        }
      }
      d.push({ nazev: "Jízdní řády platí do", hodnota: jr.plati_do ? D.datum(jr.plati_do) : "–", pozn, html: varovani });
      d.push({ nazev: "Spojů dnes", hodnota: cislo(z.spoju_dnes), pozn: `${cislo(z.zastavek)} zastávek, ${cislo(z.cilu)} cílů` });
    }
    $("#dlazdice").innerHTML = d.map((x) => `
      <div class="cislo-polozka${x.dulezita ? " dulezita" : ""}">
        <dt>${esc(x.nazev)}</dt>
        <dd class="hodnota">${x.hodnota}</dd>
        ${x.pozn ? `<dd class="pozn">${x.pozn}</dd>` : ""}
        ${x.html ? `<dd class="varovani">${x.html}</dd>` : ""}
      </div>`).join("");
    $("#dlazdice").removeAttribute("aria-busy");
  }
  /** „v 8:00“, „ve 2:00“ hodiny 2, 3, 4, 12–14, 20–24 → „ve“ (výslovnost), jinak „v“. */
  function predlozkaCasu(d) {
    const h = d.getHours();
    return [2, 3, 4, 12, 13, 14, 20, 21, 22, 23].includes(h) ? "ve" : "v";
  }

  function vykresliHodnoceni(s) {
    const box = $("#hodnoceni-obsah");
    if (!s || !s.obce_podle_hodnoceni) { box.innerHTML = '<p class="male">Údaje se nepodařilo načíst.</p>'; return; }
    const poradi = Object.keys(HODNOCENI);
    const data = poradi.map((h) => ({ h, n: s.obce_podle_hodnoceni[h] || 0 }));
    const celkem = data.reduce((a, x) => a + x.n, 0) || 1;
    box.innerHTML = `
      <div class="pruh" aria-hidden="true">${data.filter((x) => x.n > 0).map((x) => `<span class="${HODNOCENI[x.h].trida}" style="flex-grow: ${x.n}"></span>`).join("")}</div>
      <ul class="pruh-popisky">${data.map((x) => `
        <li><i class="vzorek ${HODNOCENI[x.h].trida}" aria-hidden="true"></i><span>${esc(x.h)}</span>
          <strong>${cislo(x.n)}</strong><span class="male">${sklonuj(x.n, "obec", "obce", "obcí")} (${procent((100 * x.n) / celkem, 0)})</span></li>`).join("")}
      </ul>`;
  }

  // =====================================================================================
  // OBCE – tabulka, filtry, řazení
  // =====================================================================================
  const SLOUPCE = {
    obec: { typ: "text", vychozi: "asc", nazev: "obec" },
    orp: { typ: "text", vychozi: "asc", nazev: "ORP" },
    obyvatel_65plus: { typ: "cislo", vychozi: "desc", nazev: "senioři 65+", prazdne: -Infinity },
    podil_65plus: { typ: "cislo", vychozi: "desc", nazev: "podíl 65+", prazdne: -Infinity },
    odjezdu_za_den: { typ: "cislo", vychozi: "asc", nazev: "odjezdů za den", prazdne: -Infinity },
    mimo_domov_praktik_min: { typ: "cislo", vychozi: "desc", nazev: "praktický lékař", prazdne: Infinity },
    mimo_domov_zubar_min: { typ: "cislo", vychozi: "desc", nazev: "zubař", prazdne: Infinity },
    mimo_domov_nemocnice_min: { typ: "cislo", vychozi: "desc", nazev: "nemocnice", prazdne: Infinity },
    prumer_mimo_domov_h: { typ: "cislo", vychozi: "desc", nazev: "průměr", prazdne: Infinity },
    hodnoceni: { typ: "hodnoceni", vychozi: "desc", nazev: "hodnocení" },
    senior_expres: { typ: "bool", vychozi: "desc", nazev: "Senior Expres" },
  };

  function hodnotaRazeni(o, sloupec) {
    const s = SLOUPCE[sloupec];
    const v = o[sloupec];
    if (s.typ === "hodnoceni") return (HODNOCENI[v] ? HODNOCENI[v].poradi : 5) * 1e4 + (o.prumer_mimo_domov_h ?? 1e3);
    if (s.typ === "bool") return v ? 1 : 0;
    if (s.typ === "cislo") return v === null || v === undefined ? s.prazdne : v;
    return v || "";
  }

  function serad(seznam) {
    const { sloupec, smer } = stav.razeni;
    const s = SLOUPCE[sloupec];
    const k = smer === "asc" ? 1 : -1;
    return [...seznam].sort((a, b) => {
      const va = hodnotaRazeni(a, sloupec), vb = hodnotaRazeni(b, sloupec);
      let r;
      if (s.typ === "text") {
        if (!va && vb) return 1; // prázdné ORP vždy na konec
        if (va && !vb) return -1;
        r = porovnejText(va, vb);
      } else r = va === vb ? 0 : va < vb ? -1 : 1;
      return r * k || porovnejText(a.obec, b.obec);
    });
  }

  async function nactiObce() {
    $("#obce-chyba").innerHTML = "";
    try {
      const d = await D.api("/obce");
      stav.obce = d.obce || [];
      stav.obcePodleKodu = new Map(stav.obce.map((o) => [o.kod_obce, o]));
      naplnVybery();
      vykresliTabulku();
      vykresliLetaky();
      $("#stahnout-csv").disabled = false;
      if (vrstvaH3) prestylujMapu();
      aktualizujSeznamSpatnych();
      const kod = new URLSearchParams(window.location.search).get("obec");
      if (kod && stav.obcePodleKodu.has(kod)) vyberObec(kod, { priblizit: true });
    } catch (e) {
      $("#obce-chyba").innerHTML = chybaHtml(`Seznam obcí se nenačetl. ${e.message}`, "obce");
      $("#obce-telo").innerHTML = '<tr><td class="prazdno" colspan="11">Tabulka je prázdná, protože se nepodařilo načíst data.</td></tr>';
    }
  }

  function naplnVybery() {
    const orp = [...new Set(stav.obce.map((o) => o.orp).filter(Boolean))].sort(porovnejText);
    const bezOrp = stav.obce.some((o) => !o.orp);
    $("#filtr-orp").innerHTML = '<option value="">Všechny ORP</option>' +
      orp.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join("") +
      (bezOrp ? '<option value="__bez">Bez ORP</option>' : "");
    const abc = [...stav.obce].sort((a, b) => porovnejText(a.obec, b.obec));
    $("#vyber-obce").innerHTML = '<option value="">Vyberte obec…</option>' +
      abc.map((o) => `<option value="${esc(o.kod_obce)}">${esc(o.obec)}${o.orp ? ` (ORP ${esc(o.orp)})` : ""}</option>`).join("");
  }

  function filtruj() {
    const t = bezDiakritiky(stav.filtrText.trim());
    return stav.obce.filter((o) => {
      if (stav.filtrOrp === "__bez" && o.orp) return false;
      if (stav.filtrOrp && stav.filtrOrp !== "__bez" && o.orp !== stav.filtrOrp) return false;
      if (t && !bezDiakritiky(o.obec).includes(t) && !String(o.kod_obce).startsWith(t)) return false;
      return true;
    });
  }

  function bunkaDoby(min) {
    return min === null || min === undefined
      ? '<td class="num"><span class="bez-spojeni">bez spojení</span></td>'
      : `<td class="num">${D.minuty(min)}</td>`;
  }

  function vykresliTabulku() {
    stav.zobrazene = serad(filtruj());
    const telo = $("#obce-telo");
    if (!stav.zobrazene.length) {
      telo.innerHTML = '<tr><td class="prazdno" colspan="11">Žádná obec neodpovídá hledání. Zkuste jiný název nebo vyberte „Všechny ORP“.</td></tr>';
    } else {
      telo.innerHTML = stav.zobrazene.map((o) => `
        <tr data-kod="${esc(o.kod_obce)}"${o.kod_obce === stav.vybrana ? ' aria-current="true"' : ""}>
          <th scope="row"><button type="button" class="obec-tlacitko" data-kod="${esc(o.kod_obce)}">${esc(o.obec)}</button></th>
          <td>${o.orp ? esc(o.orp) : '<span class="ne">bez ORP</span>'}</td>
          <td class="num">${cislo(o.obyvatel_65plus)}</td>
          <td class="num">${procent(o.podil_65plus)}</td>
          <td class="num">${cislo(o.odjezdu_za_den)}</td>
          ${bunkaDoby(o.mimo_domov_praktik_min)}
          ${bunkaDoby(o.mimo_domov_zubar_min)}
          ${bunkaDoby(o.mimo_domov_nemocnice_min)}
          ${bunkaDoby(o.prumer_mimo_domov_h === null || o.prumer_mimo_domov_h === undefined ? null : o.prumer_mimo_domov_h * 60)}
          <td>${hodnoceniHtml(o.hodnoceni)}</td>
          <td>${o.senior_expres ? `<span class="ano">${ikona("taxi")}ano</span>` : '<span class="ne">ne</span>'}</td>
        </tr>`).join("");
    }
    const n = stav.zobrazene.length, c = stav.obce.length;
    $("#pocet-obci").textContent = `Obcí v tabulce: ${cislo(n)} z ${cislo(c)}`;
    $("#csv-pocet").textContent = `Obcí v exportu: ${cislo(n)}`;
    $("#stahnout-csv").disabled = n === 0;
    aktualizujZahlavi();
  }

  function aktualizujZahlavi() {
    document.querySelectorAll("#tabulka-obci thead th[data-sloupec]").forEach((th) => {
      const aktivni = th.dataset.sloupec === stav.razeni.sloupec;
      th.setAttribute("aria-sort", aktivni ? (stav.razeni.smer === "asc" ? "ascending" : "descending") : "none");
      const b = th.querySelector("button");
      let i = b.querySelector("i");
      if (!i) { i = document.createElement("i"); i.setAttribute("aria-hidden", "true"); b.appendChild(i); }
      i.className = `ph-bold ${aktivni ? (stav.razeni.smer === "asc" ? "ph-arrow-up" : "ph-arrow-down") : "ph-arrows-down-up"}`;
    });
  }

  function nastavUdalostiTabulky() {
    document.querySelectorAll("#tabulka-obci thead th[data-sloupec] button").forEach((b) => {
      b.addEventListener("click", () => {
        const sl = b.closest("th").dataset.sloupec;
        if (stav.razeni.sloupec === sl) stav.razeni.smer = stav.razeni.smer === "asc" ? "desc" : "asc";
        else stav.razeni = { sloupec: sl, smer: SLOUPCE[sl].vychozi };
        vykresliTabulku();
        hlas(`Seřazeno podle sloupce ${SLOUPCE[sl].nazev}, ${stav.razeni.smer === "asc" ? "vzestupně" : "sestupně"}.`);
      });
    });
    $("#obce-telo").addEventListener("click", (e) => {
      if (e.target.closest("a")) return;
      const tr = e.target.closest("tr[data-kod]");
      if (!tr) return;
      vyberObec(tr.dataset.kod, { priblizit: true, posunout: true, fokus: !!e.target.closest("button") });
    });
    $("#filtr-orp").addEventListener("change", (e) => { stav.filtrOrp = e.target.value; vykresliTabulku(); });
    const hledej = D.zpozdeni(() => vykresliTabulku(), 150);
    $("#filtr-text").addEventListener("input", (e) => { stav.filtrText = e.target.value; hledej(); });
    $("#vyber-obce").addEventListener("change", (e) => { if (e.target.value) vyberObec(e.target.value, { priblizit: true }); });
  }

  // =====================================================================================
  // EXPORT
  // =====================================================================================
  function stahniCsv() {
    const desetinne = (n, d) => (n === null || n === undefined || isNaN(n) ? "" : (d === undefined ? String(n) : Number(n).toFixed(d)).replace(".", ","));
    const pole = (s) => { s = String(s ?? ""); return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const hlavicka = ["Kód obce", "Obec", "ORP", "Obyvatel", "Obyvatel 65+", "Podíl 65+ (%)", "Hlavní zastávka", "Odjezdů za den",
      "Mimo domov – praktický lékař (min)", "Mimo domov – zubař (min)", "Mimo domov – gynekolog (min)", "Mimo domov – oční lékař (min)",
      "Mimo domov – nemocnice (min)", "Mimo domov – úřad ORP (min)", "Průměr mimo domov (h)", "Hodnocení", "Senior Expres", "Leták (PDF)"];
    const radky = stav.zobrazene.map((o) => [o.kod_obce, o.obec, o.orp || "", desetinne(o.obyvatel), desetinne(o.obyvatel_65plus),
      desetinne(o.podil_65plus, 1), o.zastavka || "", desetinne(o.odjezdu_za_den),
      desetinne(o.mimo_domov_praktik_min, 0), desetinne(o.mimo_domov_zubar_min, 0), desetinne(o.mimo_domov_gynekolog_min, 0),
      desetinne(o.mimo_domov_ocni_min, 0), desetinne(o.mimo_domov_nemocnice_min, 0), desetinne(o.mimo_domov_urad_orp_min, 0),
      desetinne(o.prumer_mimo_domov_h, 2), o.hodnoceni || "", o.senior_expres ? "ano" : "ne",
      new URL(o.letak || `/letaky/${o.kod_obce}.pdf`, window.location.origin).href]);
    const text = "﻿" + [hlavicka, ...radky].map((r) => r.map(pole).join(";")).join("\r\n") + "\r\n";
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `dojedeme-obce-${D.isoDatum(new Date())}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    hlas(`Stahuje se tabulka ${cislo(radky.length)} obcí.`);
  }

  function vykresliLetaky() {
    const skupiny = new Map();
    [...stav.obce].sort((a, b) => porovnejText(a.obec, b.obec)).forEach((o) => {
      const k = o.orp || "Bez ORP";
      if (!skupiny.has(k)) skupiny.set(k, []);
      skupiny.get(k).push(o);
    });
    const klice = [...skupiny.keys()].sort((a, b) => (a === "Bez ORP") - (b === "Bez ORP") || porovnejText(a, b));
    $("#letaky-souhrn").textContent = `Letáky jednotlivých obcí (${cislo(stav.obce.length)})`;
    $("#letaky-seznam").innerHTML = klice.map((k) => `
      <h4>${k === "Bez ORP" ? "Bez ORP" : `ORP ${esc(k)}`}</h4>
      <ul>${skupiny.get(k).map((o) => `<li><a href="${esc(o.letak || `/letaky/${o.kod_obce}.pdf`)}" download>${ikona("file-pdf")}${esc(o.obec)}</a></li>`).join("")}</ul>`).join("");
  }

  /** Všechny letáky v jednom ZIPu. Poprvé ho server skládá asi minutu, proto stahujeme přes fetch a ukazujeme stav.
      Bez JavaScriptu (nebo bez fetch) funguje odkaz sám jako obyčejné stažení. */
  let zipBezi = false;
  async function stahniZip(e) {
    if (!window.fetch || !window.URL || !URL.createObjectURL) return;
    e.preventDefault();
    if (zipBezi) return;
    zipBezi = true;
    const odkaz = e.currentTarget;
    const box = $("#letaky-zip-stav");
    const text = (t) => { box.innerHTML = `<p class="male">${t}</p>`; };
    const pocet = stav.obce.length || 134;
    odkaz.setAttribute("aria-disabled", "true");
    text(`Připravujeme ${cislo(pocet)} letáků, poprvé to trvá asi minutu. Stránku můžete mezitím dál používat.`);
    try {
      let r;
      try { r = await fetch(odkaz.href); }
      catch { throw new Error("Nepodařilo se spojit se serverem. Zkontrolujte připojení k internetu."); }
      if (!r.ok) {
        let zprava = null;
        try { zprava = (await r.json()).chyba; } catch { /* odpověď není JSON */ }
        if (!zprava && (r.status === 502 || r.status === 504)) zprava = "Příprava letáků trvala déle, než server čeká.";
        throw new Error(zprava || "Server teď letáky nepřipravil.");
      }
      const delka = Number(r.headers.get("content-length")) || 0;
      let blob;
      if (r.body && r.body.getReader && delka) {
        const cteni = r.body.getReader();
        const casti = [];
        let nacteno = 0, posledni = -1;
        for (;;) {
          const { done, value } = await cteni.read();
          if (done) break;
          casti.push(value);
          nacteno += value.length;
          const proc = Math.floor((nacteno / delka) * 10) * 10;
          if (proc !== posledni) { posledni = proc; text(`Stahuje se soubor ZIP: ${proc} %`); }
        }
        blob = new Blob(casti, { type: "application/zip" });
      } else {
        text("Stahuje se soubor ZIP…");
        blob = await r.blob();
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "dojedeme-letaky-obci.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      text(`Hotovo. Soubor dojedeme-letaky-obci.zip (${cislo(blob.size / 1048576, 1)} MB) najdete ve stažených souborech.`);
    } catch (err) {
      box.innerHTML = `<div class="blok chyba"><i class="ph-bold ph-warning ikona" aria-hidden="true"></i><span><strong>Letáky se nepodařilo stáhnout.</strong>${esc(err.message)} Zkuste to prosím za minutu znovu, nebo stáhněte letáky jednotlivých obcí níže.</span></div>`;
    } finally {
      zipBezi = false;
      odkaz.removeAttribute("aria-disabled");
    }
  }

  // =====================================================================================
  // MAPA
  // =====================================================================================
  let mapa = null, vrstvaH3 = null, vrstvaHranic = null, vrstvaSpatnych = null, vrstvaVyberu = null;
  let h3Data = null, obceGeo = null, obceGeoSlib = null;
  const hraniceObci = new Map();
  let B = {};

  function nactiBarvy() {
    const cs = getComputedStyle(document.documentElement);
    const g = (n) => cs.getPropertyValue(n).trim();
    B = {
      mapa: [g("--color-map-none"), g("--color-map-1"), g("--color-map-2"), g("--color-map-3"), g("--color-map-4"), g("--color-map-5"), g("--color-map-6")],
      bg: g("--color-bg"), ink: g("--color-ink"), ink2: g("--color-ink-2"), primary: g("--color-primary"),
    };
  }

  function hodnoceniObce(kod) { const o = stav.obcePodleKodu.get(kod); return o ? o.hodnoceni : null; }

  function stylHexu(f) {
    const p = f.properties;
    const t = D.tridaMapy(minutyMetriky(p, stav.metrika));
    const ztlumit = stav.zvyraznit && stav.obce.length > 0 && !SPATNE.has(hodnoceniObce(p.kod_obce));
    if (t === 0) {
      return { fillColor: "url(#admin-srafa)", fillOpacity: ztlumit ? 0.2 : 1, color: B.mapa[0], weight: 1.2, opacity: ztlumit ? 0.25 : 0.9, dashArray: "3 3" };
    }
    return { fillColor: B.mapa[t], fillOpacity: ztlumit ? 0.14 : 0.78, color: B.bg, weight: 0.6, opacity: ztlumit ? 0.3 : 0.9, dashArray: null };
  }

  function popupHexu(p) {
    const m = stav.metrika;
    const min = minutyMetriky(p, m);
    const pesky = p.pesky_k_zastavce_min;
    return `<div class="popup">
      <p class="popup-nadpis">${esc(p.obec)}</p>
      <dl>
        <div><dt>Obyvatel (odhad)</dt><dd>${cislo(Math.round(p.obyvatel || 0))}, z toho 65+: ${cislo(Math.round(p.obyvatel_65plus || 0))}</dd></div>
        <div><dt>${esc(nazevMetriky(m))}</dt><dd>${min === null ? "bez spojení" : `${D.minuty(min)} mimo domov`}</dd></div>
        <div><dt>Pěšky k zastávce</dt><dd>${pesky === null || pesky === undefined || pesky >= 99 ? "dál než 1 km" : D.minuty(pesky)}</dd></div>
        <div><dt>Hodnocení</dt><dd>${hodnoceniHtml(p.hodnoceni)}</dd></div>
      </dl></div>`;
  }

  function vytvorMapu() {
    if (!window.L) {
      $("#mapa-stav").innerHTML = chybaHtml("Mapový podklad se nenačetl. Zkontrolujte připojení k internetu a načtěte stránku znovu.");
      return false;
    }
    nactiBarvy();
    mapa = L.map("mapa", { center: [50.17, 12.75], zoom: 9, minZoom: 8, maxZoom: 16, scrollWheelZoom: false, zoomSnap: 0.5 });
    mapa.attributionControl.setPrefix(false);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(mapa);
    mapa.createPane("hranice").style.zIndex = 410;
    mapa.createPane("zvyrazneni").style.zIndex = 420;
    mapa.createPane("vyber").style.zIndex = 430;
    ["hranice", "zvyrazneni", "vyber"].forEach((n) => { mapa.getPane(n).style.pointerEvents = "none"; });
    // kolečko myši přibližuje až po kliknutí do mapy (stránka se jinak „zasekne“ na mapě)
    mapa.on("click focus", () => mapa.scrollWheelZoom.enable());
    mapa.getContainer().addEventListener("mouseleave", () => mapa.scrollWheelZoom.disable());
    window.setTimeout(() => mapa.invalidateSize(), 150);
    if ("ResizeObserver" in window) new ResizeObserver(() => mapa.invalidateSize()).observe($("#mapa"));
    return true;
  }

  async function nactiH3() {
    $("#mapa-stav").hidden = false;
    $("#mapa-stav").innerHTML = '<span class="mapa-nacitani">Načítám mapu…</span>';
    try {
      h3Data = await D.api("/mapa/h3");
    } catch (e) {
      $("#mapa-stav").innerHTML = chybaHtml(`Mapa se nenačetla. ${e.message}`, "mapa");
      return;
    }
    vrstvaH3 = L.geoJSON(h3Data, {
      style: stylHexu,
      onEachFeature: (f, vrstva) => {
        vrstva.bindPopup(() => popupHexu(f.properties), { maxWidth: 320, autoPanPaddingTopLeft: [80, 24], autoPanPaddingBottomRight: [24, 24] });
        vrstva.on("click", () => vyberObec(f.properties.kod_obce, { priblizit: false }));
        vrstva.on("mouseover", () => vrstva.setStyle({ weight: 2.5, color: B.ink, opacity: 1 }));
        vrstva.on("mouseout", () => vrstvaH3.resetStyle(vrstva));
      },
    }).addTo(mapa);
    if (!stav.vybrana) mapa.fitBounds(vrstvaH3.getBounds(), { padding: [8, 8], animate: false });
    $("#mapa-stav").hidden = true;
    vykresliLegendu();
    // hranice obcí jsou potřeba pro zvýraznění a výběr – načtou se na pozadí
    nactiHraniceObci().then(() => {
      if (stav.hranice) zobrazHranice();
      if (stav.zvyraznit) zobrazSpatne();
      if (stav.vybrana) zvyrazniVybranou(stav.vybrana, false);
    }).catch(() => { /* bez hranic mapa funguje dál, chyba se ukáže u přepínače */ });
  }

  function nactiHraniceObci() {
    if (!obceGeoSlib) {
      obceGeoSlib = D.api("/mapa/obce").then((g) => {
        obceGeo = g;
        g.features.forEach((f) => hraniceObci.set(f.properties.kod_obce, f));
        return g;
      }).catch((e) => {
        obceGeoSlib = null;
        $("#spatne-seznam").hidden = false;
        $("#spatne-seznam").textContent = `Hranice obcí se nenačetly. ${e.message}`;
        throw e;
      });
    }
    return obceGeoSlib;
  }

  function prestylujMapu() {
    if (!vrstvaH3) return;
    vrstvaH3.setStyle(stylHexu);
    if (vrstvaHranic) vrstvaHranic.setStyle(stylHranic());
    if (vrstvaSpatnych) vrstvaSpatnych.setStyle(stylSpatnych());
    if (stav.vybrana && vrstvaVyberu) zvyrazniVybranou(stav.vybrana, false);
  }
  const stylHranic = () => ({ color: B.ink2, weight: 1, opacity: 0.75, fill: false, interactive: false });
  const stylSpatnych = () => ({ color: B.ink, weight: 3, opacity: 1, fill: false, interactive: false });

  function zobrazHranice() {
    if (!mapa || !obceGeo) return;
    if (!vrstvaHranic) vrstvaHranic = L.geoJSON(obceGeo, { pane: "hranice", style: stylHranic, interactive: false });
    if (stav.hranice) vrstvaHranic.addTo(mapa); else vrstvaHranic.remove();
  }

  function zobrazSpatne() {
    if (!mapa) return;
    if (vrstvaSpatnych) { vrstvaSpatnych.remove(); vrstvaSpatnych = null; }
    if (stav.zvyraznit && obceGeo && stav.obce.length) {
      const kody = new Set(stav.obce.filter((o) => SPATNE.has(o.hodnoceni)).map((o) => o.kod_obce));
      vrstvaSpatnych = L.geoJSON({ type: "FeatureCollection", features: obceGeo.features.filter((f) => kody.has(f.properties.kod_obce)) },
        { pane: "zvyrazneni", style: stylSpatnych, interactive: false }).addTo(mapa);
    }
    prestylujMapu();
    aktualizujSeznamSpatnych();
  }

  function aktualizujSeznamSpatnych() {
    const p = $("#spatne-seznam");
    if (!stav.zvyraznit || !stav.obce.length) { p.hidden = true; return; }
    const spatne = stav.obce.filter((o) => SPATNE.has(o.hodnoceni))
      .sort((a, b) => HODNOCENI[b.hodnoceni].poradi - HODNOCENI[a.hodnoceni].poradi || porovnejText(a.obec, b.obec));
    p.hidden = false;
    p.innerHTML = `<strong>Zvýrazněno ${cislo(spatne.length)} ${sklonuj(spatne.length, "obec", "obce", "obcí")}</strong> (silný obrys, ostatní obce jsou potlačené): ` +
      spatne.map((o) => `${esc(o.obec)} (${esc(o.hodnoceni)})`).join(", ") + ".";
  }

  function zvyrazniVybranou(kod, priblizit) {
    if (!mapa) return;
    if (vrstvaVyberu) { vrstvaVyberu.remove(); vrstvaVyberu = null; }
    const f = hraniceObci.get(kod);
    const o = stav.obcePodleKodu.get(kod);
    if (f) {
      vrstvaVyberu = L.layerGroup([
        L.geoJSON(f, { pane: "vyber", interactive: false, style: { color: B.bg, weight: 8, opacity: 0.95, fill: false } }),
        L.geoJSON(f, { pane: "vyber", interactive: false, style: { color: B.primary, weight: 4, opacity: 1, fill: false } }),
      ]).addTo(mapa);
      if (priblizit) mapa.fitBounds(L.geoJSON(f).getBounds(), { maxZoom: 13, padding: [32, 32], animate: !bezPohybu });
    } else if (priblizit && o && o.stred_lat && o.stred_lon) {
      mapa.setView([o.stred_lat, o.stred_lon], 12, { animate: !bezPohybu });
    }
  }

  function vykresliMetriky() {
    $("#metriky").innerHTML = METRIKY.map((m) => `
      <button type="button" data-metrika="${m.klic}" aria-pressed="${m === stav.metrika}">${esc(m.nazev)}</button>`).join("");
    $("#metriky").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-metrika]");
      if (!b) return;
      stav.metrika = METRIKY.find((m) => m.klic === b.dataset.metrika);
      document.querySelectorAll("#metriky button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      prestylujMapu();
      vykresliLegendu();
      vykresliMedian();
      if (mapa) mapa.closePopup();
      hlas(`Mapa ukazuje dobu mimo domov: ${nazevMetriky(stav.metrika)}.`);
    });
  }

  function vykresliLegendu() {
    $("#legenda-nadpis").textContent = `Doba mimo domov – ${nazevMetriky(stav.metrika)}`;
    const seniori = [0, 0, 0, 0, 0, 0, 0];
    if (h3Data) h3Data.features.forEach((f) => { seniori[D.tridaMapy(minutyMetriky(f.properties, stav.metrika))] += f.properties.obyvatel_65plus || 0; });
    const poradi = [1, 2, 3, 4, 5, 6, 0];
    $("#legenda").innerHTML = poradi.map((t) => `
      <li><i class="m${t}" aria-hidden="true"></i>${esc(D.LEGENDA_MAPY[t])}${h3Data ? `<span class="pocet">, ${cislo(Math.round(seniori[t]))} ${sklonuj(Math.round(seniori[t]), "senior", "senioři", "seniorů")}</span>` : ""}</li>`).join("");
  }

  function vykresliMedian() {
    const p = $("#median");
    const med = stav.statistiky && stav.statistiky.median_mimo_domov_min;
    const v = med ? med[stav.metrika.klic] : null;
    p.textContent = v ? `Medián obcí kraje pro cíl ${nazevMetriky(stav.metrika).toLowerCase()}: ${D.minuty(v)} mimo domov. Počty seniorů jsou odhad podle adres (RÚIAN, ČSÚ).`
      : "Počty seniorů jsou odhad podle adres (RÚIAN, ČSÚ).";
  }

  function nastavPrepinaceMapy() {
    $("#prepinac-hranice").addEventListener("change", async (e) => {
      stav.hranice = e.target.checked;
      if (stav.hranice) { try { await nactiHraniceObci(); } catch { return; } }
      zobrazHranice();
    });
    $("#prepinac-spatne").addEventListener("change", async (e) => {
      stav.zvyraznit = e.target.checked;
      aktualizujSeznamSpatnych();
      prestylujMapu();
      if (stav.zvyraznit) { try { await nactiHraniceObci(); } catch { return; } }
      zobrazSpatne();
    });
    tmavyRezim.addEventListener("change", () => { nactiBarvy(); prestylujMapu(); });
    window.addEventListener("dojedeme:vzhled", () => { nactiBarvy(); prestylujMapu(); });   // přepínač na webu
  }

  // =====================================================================================
  // DETAIL OBCE
  // =====================================================================================
  const lekariCache = new Map();
  let pozadavekDetailu = 0;

  function vyberObec(kod, { priblizit = true, posunout = false, fokus = false } = {}) {
    const o = stav.obcePodleKodu.get(kod);
    if (!o) return;
    stav.vybrana = kod;
    document.querySelectorAll("#obce-telo tr[aria-current]").forEach((tr) => tr.removeAttribute("aria-current"));
    const tr = document.querySelector(`#obce-telo tr[data-kod="${CSS.escape(kod)}"]`);
    if (tr) tr.setAttribute("aria-current", "true");
    $("#vyber-obce").value = kod;
    vykresliDetail(o);
    if (mapa) {
      if (obceGeo) zvyrazniVybranou(kod, priblizit);
      else {
        if (priblizit && o.stred_lat && o.stred_lon) mapa.setView([o.stred_lat, o.stred_lon], 12, { animate: false });
        nactiHraniceObci().then(() => { if (stav.vybrana === kod) zvyrazniVybranou(kod, priblizit); }).catch(() => {});
      }
    }
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("obec", kod);
      u.hash = "";
      window.history.replaceState(null, "", u);
    } catch { /* adresa se nezmění, nevadí */ }
    if (posunout) $("#mapa-sekce").scrollIntoView({ behavior: bezPohybu ? "auto" : "smooth", block: "start" });
    if (fokus) $("#detail-nadpis").focus({ preventScroll: true });
    hlas(`Vybrána obec ${o.obec}.${fokus ? "" : " Detail je u mapy."}`);
    nactiLekare(kod);
  }

  function vykresliDetail(o) {
    const doby = METRIKY.map((m) => {
      const min = minutyMetriky(o, m);
      const t = D.tridaMapy(min);
      const sirka = min === null ? 100 : Math.max(4, Math.min(100, (min / 360) * 100));
      return `<li class="doba${m.hodiny ? " prumer" : ""}">
        <span>${esc(m.hodiny ? m.nazev : nazevMetriky(m))}</span>
        <span class="doba-pruh" aria-hidden="true"><span class="b-m${t}" style="width: ${sirka.toFixed(1)}%"></span></span>
        <span class="doba-hodnota${min === null ? " bez-spojeni" : ""}">${dobaText(min)}</span></li>`;
    }).join("");
    $("#detail-obsah").innerHTML = `
      <div class="detail-hlava">
        <h3 id="detail-nadpis" tabindex="-1">${esc(o.obec)}</h3>
        <p class="male">${o.orp ? `ORP ${esc(o.orp)}` : "bez ORP"}<br>Hlavní zastávka ${esc(o.zastavka || "–")}</p>
        <p class="detail-hodnoceni">Hodnocení dostupnosti: ${hodnoceniHtml(o.hodnoceni)}</p>
      </div>
      <dl class="cisla-radek kompaktni">
        <div class="cislo-polozka"><dt>obyvatel</dt><dd class="hodnota">${cislo(o.obyvatel)}</dd></div>
        <div class="cislo-polozka"><dt>seniorů 65+</dt><dd class="hodnota">${cislo(o.obyvatel_65plus)}</dd><dd class="pozn">${procent(o.podil_65plus)}</dd></div>
        <div class="cislo-polozka"><dt>odjezdů za den</dt><dd class="hodnota">${cislo(o.odjezdu_za_den)}</dd></div>
      </dl>
      ${o.senior_expres ? `<p class="detail-se">${ikona("taxi")}<span><strong>Senior Expres v obci jezdí.</strong></span></p>` : ""}
      <div class="detail-blok">
        <h4>Doba mimo domov</h4>
        <p class="male">Tam, 45 min na místě a zpět, z hlavní zastávky obce. Průměr počítáme z praktického lékaře, zubaře a nemocnice.</p>
        <ul class="doby">${doby}</ul>
      </div>
      <div class="akce-radek">
        <a class="tlacitko" href="${esc(o.letak || `/letaky/${o.kod_obce}.pdf`)}" download>${ikona("file-pdf")}Stáhnout leták (PDF)</a>
        <a class="textovy-odkaz" href="#obce">Zpět na tabulku obcí</a>
      </div>
      <div class="detail-blok" id="detail-lekari" aria-busy="true">
        <h4>Lékaři v dosahu, kteří přijímají nové pacienty</h4>
        <div class="skeleton" style="height: 28px; width: 70%"></div>
        <div class="skeleton" style="height: 120px"></div>
      </div>`;
  }

  async function nactiLekare(kod) {
    const cislo_pozadavku = ++pozadavekDetailu;
    const box = () => $("#detail-lekari");
    try {
      let d = lekariCache.get(kod);
      if (!d) { d = await D.api(`/obce/${encodeURIComponent(kod)}/lekari`); lekariCache.set(kod, d); }
      if (cislo_pozadavku !== pozadavekDetailu || !box()) return;
      box().innerHTML = htmlLekaru(d);
      box().removeAttribute("aria-busy");
    } catch (e) {
      if (cislo_pozadavku !== pozadavekDetailu || !box()) return;
      box().removeAttribute("aria-busy");
      box().innerHTML = `<h4>Lékaři v dosahu, kteří přijímají nové pacienty</h4>${chybaHtml(`Seznam lékařů se nenačetl. ${e.message}`, "lekari")}`;
    }
  }

  function polozkaLekare(l, nabira) {
    const tel = (l.telefon || []).map((t) => `<a href="${esc(D.telefonOdkaz(t))}">${esc(D.telefon(t))}</a>`).join(", ");
    let cesta;
    if (l.pesky) cesta = `${ikona("person-simple-walk")}<span>Pěšky ${D.minuty(l.cesta_min)}</span>`;
    else if (l.odjezd) cesta = `${ikona("bus")}<span>Odjezd <strong>${esc(l.odjezd)}</strong>, příjezd <strong>${esc(l.prijezd)}</strong>, ${D.minuty(l.cesta_min)}, ${D.prestupy(l.prestupy || 0)}</span>`;
    else cesta = `${ikona("bus")}<span>Spoj se nenašel.</span>`;
    const lekari = l.lekari && l.lekari.trim() !== String(l.nazev || "").trim() ? `<p class="male">${esc(l.lekari)}</p>` : "";
    return `<li class="lekar">
      <div class="lekar-hlava">${nabira ? `<span class="odznak nabira">${ikona("check-circle")}Přijímá nové pacienty</span>` : ""}<span class="lekar-typ">${esc(l.typ_nazev)}</span></div>
      <p class="lekar-nazev">${esc(l.nazev)}</p>
      ${lekari}
      <p class="male">${esc(l.adresa || "")}</p>
      <p class="lekar-cesta">${cesta}</p>
      ${tel ? `<p>${ikona("phone")} ${tel}</p>` : ""}
    </li>`;
  }

  function seznamSRozbalenim(polozky, nabira, id, prvnich = 4) {
    if (!polozky.length) return "";
    const vidi = polozky.slice(0, prvnich).map((l) => polozkaLekare(l, nabira)).join("");
    const zbytek = polozky.slice(prvnich);
    return `<ul class="lekari">${vidi}</ul>${zbytek.length ? `
      <ul class="lekari" id="${id}" hidden>${zbytek.map((l) => polozkaLekare(l, nabira)).join("")}</ul>
      <button class="tlacitko vedlejsi" type="button" aria-expanded="false" aria-controls="${id}" data-rozbalit="${id}" data-celkem="${polozky.length}">${ikona("caret-down")}<span>Zobrazit všech ${cislo(polozky.length)}</span></button>` : ""}`;
  }

  function htmlLekaru(d) {
    const n = d.pocet_nabira || 0;
    const pocty = Object.entries(d.pocty || {}).sort((a, b) => b[1] - a[1]);
    const se = (d.senior_expres || []).map((s) => `
      <div class="senior-expres">
        <p><strong>${esc(s.nazev || "Senior Expres")}</strong>${s.provozovatel ? `, ${esc(s.provozovatel)}` : ""}</p>
        ${s.telefon ? `<div class="akce-radek"><a class="tlacitko signal" href="${esc(D.telefonOdkaz(s.telefon))}">${ikona("phone")}Zavolat Senior Expres</a><span class="cislo">${esc(D.telefon(s.telefon))}</span></div>` : ""}
        ${s.podminky ? `<p>Pro koho: ${esc(s.podminky)}</p>` : ""}
        ${s.cena ? `<p>Cena: ${esc(s.cena)}</p>` : ""}
        ${s.provoz ? `<p>Provoz: ${esc(s.provoz)}</p>` : ""}
        ${s.zdroj ? `<p class="zdroj">Zdroj: <a href="${esc(s.zdroj)}" rel="noopener" target="_blank">${esc(s.zdroj.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a>${s.overeno ? ` (${esc(s.overeno.toLowerCase())})` : ""}</p>` : ""}
      </div>`).join("");
    return `
      <h4>Lékaři v dosahu, kteří přijímají nové pacienty</h4>
      <p class="male">Spoje ${d.den ? `na ${esc(d.den)}` : ""} ze zastávky ${esc(d.zastavka || "")}, cesta nejvýš ${D.minuty(d.limit_min)}. Řazeno podle spojení.</p>
      <p><strong>${cislo(n)} ${sklonuj(n, "lékař přijímá", "lékaři přijímají", "lékařů přijímá")} nové pacienty</strong></p>
      ${pocty.length ? `<p class="male pocty">${pocty.map(([obor, k]) => `${esc(obor)} ${cislo(k)}`).join(", ")}</p>` : ""}
      ${n ? seznamSRozbalenim(d.nabira || [], true, "lekari-dalsi") : '<p class="male">V dosahu není lékař, který by podle seznamu kraje přijímal nové pacienty.</p>'}
      ${(d.nejblizsi || []).length ? `
        <h4>Nejbližší lékaři podle spojení</h4>
        <p class="male">Bez ohledu na to, zda přijímají nové pacienty.</p>
        ${seznamSRozbalenim(d.nejblizsi, false, "nejblizsi-dalsi")}` : ""}
      ${se ? `<h4>Senior Expres v obci</h4>${se}` : ""}`;
  }

  function nastavUdalostiDetailu() {
    $("#detail").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-rozbalit]");
      if (b) {
        const cil = document.getElementById(b.dataset.rozbalit);
        const otevrit = cil.hidden;
        cil.hidden = !otevrit;
        b.setAttribute("aria-expanded", String(otevrit));
        b.querySelector("span").textContent = otevrit ? "Zobrazit méně" : `Zobrazit všech ${cislo(Number(b.dataset.celkem))}`;
        b.querySelector("i").className = `ph-bold ${otevrit ? "ph-caret-up" : "ph-caret-down"}`;
      }
    });
  }

  // =====================================================================================
  // SMS SLUŽBA (jen správce, klíč v sessionStorage)
  // =====================================================================================
  const KLIC_UL = "dojedeme-admin-klic";
  let klic = "";
  let casovac = null;
  let posledniObnova = 0;
  const relace = {
    cti() { try { return window.sessionStorage.getItem(KLIC_UL) || ""; } catch { return ""; } },
    zapis(v) { try { window.sessionStorage.setItem(KLIC_UL, v); } catch { /* klíč zůstane jen v paměti stránky */ } },
    smaz() { try { window.sessionStorage.removeItem(KLIC_UL); } catch { /* nic */ } },
  };

  async function adminApi(cesta) {
    let r;
    try { r = await fetch(cesta, { headers: { "X-Admin-Token": klic }, cache: "no-store" }); }
    catch { const e = new Error("Nepodařilo se spojit se serverem. Zkontrolujte připojení k internetu a zkuste to znovu."); e.kod = 0; throw e; }
    if (r.status === 403) { const e = new Error("Přístupový klíč nesedí."); e.kod = 403; throw e; }
    let data = null;
    try { data = await r.json(); } catch { /* prázdná odpověď */ }
    if (!r.ok) { const e = new Error((data && data.chyba) || "Server teď neodpovídá. Zkuste to prosím za chvíli."); e.kod = r.status; throw e; }
    return data;
  }

  function ukazChybuPrihlaseni(text) {
    $("#prihlaseni-chyba").innerHTML = text ? `<div class="blok chyba"><i class="ph-bold ph-warning ikona" aria-hidden="true"></i><span>${esc(text)}</span></div>` : "";
    $("#klic").setAttribute("aria-invalid", text ? "true" : "false");
  }

  async function prihlasit(e) {
    e.preventDefault();
    const pole = $("#klic");
    const k = pole.value.trim();
    if (!k) { ukazChybuPrihlaseni("Zadejte přístupový klíč správce."); pole.focus(); return; }
    const tl = $("#prihlasit");
    tl.disabled = true;
    tl.querySelector("span").textContent = "Ověřuji klíč…";
    klic = k;
    try {
      const log = await adminApi("/sms/log");
      relace.zapis(k);
      pole.value = "";
      ukazChybuPrihlaseni("");
      prihlaseno(log, true);
    } catch (err) {
      klic = "";
      ukazChybuPrihlaseni(err.kod === 403 ? "Přístupový klíč nesedí. Zkontrolujte ho a zadejte znovu." : err.message);
      pole.focus();
      pole.select();
    } finally {
      tl.disabled = false;
      tl.querySelector("span").textContent = "Přihlásit se";
    }
  }

  function prihlaseno(log, presunoutFokus) {
    $("#prihlaseni-form").hidden = true;
    $("#prihlaseno").hidden = false;
    $("#sms-zamceno").hidden = true;
    $("#sms-obsah").hidden = false;
    vykresliLog(log);
    nactiSmsInfo();
    spustCasovac();
    if (presunoutFokus) { $("#prihlaseni-nadpis").focus(); hlas("Jste přihlášeni jako správce. Log SMS je v sekci SMS služba."); }
  }

  function odhlasit(zprava) {
    klic = "";
    relace.smaz();
    zastavCasovac();
    $("#sms-telo").innerHTML = "";
    $("#sms-info").innerHTML = "";
    $("#sms-chyba").innerHTML = "";
    $("#sms-stav").textContent = "";
    $("#sms-obsah").hidden = true;
    $("#sms-zamceno").hidden = false;
    $("#prihlaseno").hidden = true;
    $("#prihlaseni-form").hidden = false;
    ukazChybuPrihlaseni(typeof zprava === "string" ? zprava : "");
    $("#klic").focus();
    hlas(typeof zprava === "string" ? zprava : "Odhlásili jste se.");
  }

  async function nactiSmsInfo() {
    let info = null;
    try { info = await D.api("/sms/info"); } catch { /* zobrazí se jen to, co víme */ }
    const BRANY = { simulator: "Simulátor", gosms: "GoSMS", android: "Android (SMS Gate)", twilio: "Twilio", iphone: "iPhone (Zkratky)" };
    const brana = info && info.brana;
    const popisBrany = brana === "simulator" ? "SMS se opravdu neodesílají." : brana ? "SMS se odesílají přes tuto bránu." : "";
    $("#sms-info").innerHTML = `
      <div class="cislo-polozka"><dt>Číslo služby</dt><dd class="hodnota slovo">Nastaveno na serveru</dd><dd class="pozn">Z bezpečnostních důvodů se tady nezobrazuje.</dd></div>
      <div class="cislo-polozka"><dt>Brána</dt><dd class="hodnota slovo">${brana ? esc(BRANY[brana] || brana) : "–"}</dd>${popisBrany ? `<dd class="pozn">${popisBrany}</dd>` : ""}</div>
      <div class="cislo-polozka"><dt>Odpovědí denně na jedno číslo</dt><dd class="hodnota">${info && info.limit_sms_den ? cislo(info.limit_sms_den) : "–"}</dd><dd class="pozn">ochrana kreditu</dd></div>`;
  }

  /** „+420736102877“ → „+420 *** *** 877“ (vidět jsou jen poslední 3 číslice). */
  function maskujTelefon(t) {
    const s = String(t || "").replace(/\s/g, "");
    if (!s) return "–";
    const m = s.match(/^(\+\d{3})(\d{9})$/);
    if (m) return `${m[1]} *** *** ${m[2].slice(-3)}`;
    return s.slice(0, -3).replace(/\d/g, "*") + s.slice(-3);
  }

  function formatujCasLogu(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return esc(iso || "–");
    const dnes = new Date(); dnes.setHours(0, 0, 0, 0);
    const den = new Date(d); den.setHours(0, 0, 0, 0);
    const rozdil = Math.round((dnes - den) / 864e5);
    const datum = rozdil === 0 ? "dnes" : rozdil === 1 ? "včera" : D.datum(iso);
    return `<time datetime="${esc(iso)}">${datum} ${predlozkaCasu(d)} ${D.cas(d)}</time>`;
  }

  function vykresliLog(data) {
    const zpravy = (data && data.zpravy) || [];
    $("#sms-popis").textContent = zpravy.length ? `Posledních ${cislo(zpravy.length)} SMS, nejnovější nahoře` : "Log SMS";
    $("#sms-telo").innerHTML = zpravy.length ? zpravy.map((z) => {
      const prijata = z.smer === "in";
      return `<tr>
        <td>${formatujCasLogu(z.cas)}</td>
        <td><span class="smer ${prijata ? "prijata" : "odeslana"}">${ikona(prijata ? "arrow-down-left" : "arrow-up-right")}${prijata ? "Přijatá" : "Odeslaná"}</span></td>
        <td class="telefon">${esc(maskujTelefon(z.telefon))}</td>
        <td class="sms-text">${esc(z.text || "")}</td>
        <td>${esc(z.brana || "–")}</td>
        <td class="stav">${esc(z.stav || "–")}</td></tr>`;
    }).join("") : '<tr><td class="prazdno" colspan="6">Zatím tu nejsou žádné SMS. Jakmile senior pošle SMS na číslo služby, objeví se tady i s odpovědí.</td></tr>';
    posledniObnova = Date.now();
    $("#sms-stav").textContent = `Aktualizováno ${predlozkaCasu(new Date())} ${D.cas(new Date())}.`;
  }

  async function obnovLog(rucne) {
    if (!klic) return;
    const tl = $("#sms-obnovit");
    if (rucne) { tl.disabled = true; tl.querySelector("span").textContent = "Obnovuji…"; }
    try {
      const log = await adminApi("/sms/log");
      $("#sms-chyba").innerHTML = "";
      vykresliLog(log);
      if (rucne) hlas(`Log obnoven, ${cislo(((log && log.zpravy) || []).length)} zpráv.`);
    } catch (err) {
      if (err.kod === 403) { odhlasit("Klíč správce přestal platit. Přihlaste se prosím znovu."); return; }
      $("#sms-chyba").innerHTML = chybaHtml(`Log se nepodařilo obnovit. ${err.message}`);
      $("#sms-stav").textContent = "Poslední pokus o obnovení se nepovedl. Zobrazený log může být starší.";
    } finally {
      if (rucne) { tl.disabled = false; tl.querySelector("span").textContent = "Obnovit log"; }
    }
  }

  function spustCasovac() {
    zastavCasovac();
    if (!klic || !$("#sms-auto").checked) return;
    casovac = window.setInterval(() => { if (!document.hidden) obnovLog(false); }, 30000);
  }
  function zastavCasovac() { if (casovac) { window.clearInterval(casovac); casovac = null; } }

  function nastavUdalostiSms() {
    $("#prihlaseni-form").addEventListener("submit", prihlasit);
    $("#odhlasit").addEventListener("click", () => odhlasit());
    $("#sms-obnovit").addEventListener("click", () => obnovLog(true));
    $("#sms-auto").addEventListener("change", spustCasovac);
    $("#odkaz-prihlaseni").addEventListener("click", (e) => {
      e.preventDefault();
      $("#klic").scrollIntoView({ behavior: bezPohybu ? "auto" : "smooth", block: "center" });
      $("#klic").focus({ preventScroll: true });
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && klic && $("#sms-auto").checked && Date.now() - posledniObnova > 30000) obnovLog(false);
    });
  }

  async function obnovPrihlaseni() {
    const k = relace.cti();
    if (!k) return;
    klic = k;
    try { prihlaseno(await adminApi("/sms/log"), false); }
    catch (err) {
      if (err.kod === 403) { klic = ""; relace.smaz(); ukazChybuPrihlaseni("Uložený klíč už neplatí. Zadejte ho prosím znovu."); }
      else {
        // server je dočasně nedostupný – klíč necháme a ukážeme chybu v sekci SMS
        prihlaseno({ zpravy: [] }, false);
        $("#sms-chyba").innerHTML = chybaHtml(`Log se nepodařilo načíst. ${err.message}`);
      }
    }
  }

  // =====================================================================================
  // START
  // =====================================================================================
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-znovu]");
    if (!b) return;
    const co = b.dataset.znovu;
    if (co === "prehled") nactiPrehled();
    else if (co === "obce") nactiObce();
    else if (co === "mapa") nactiH3();
    else if (co === "lekari" && stav.vybrana) { lekariCache.delete(stav.vybrana); nactiLekare(stav.vybrana); }
  });

  // skutečná výška lepivé hlavičky (na mobilu se navigace zalamuje) → odsazení kotev a posunu na detail
  const hlavicka = $(".web-hlavicka");
  // (na mobilu hlavička nelepí → stačí malý okraj)
  const nastavVyskuHlavicky = () => {
    const lepi = ["sticky", "fixed"].includes(getComputedStyle(hlavicka).position);
    document.body.style.setProperty("--vyska-hlavicky", `${lepi ? hlavicka.offsetHeight + 8 : 16}px`);
  };
  nastavVyskuHlavicky();
  if ("ResizeObserver" in window) new ResizeObserver(nastavVyskuHlavicky).observe(hlavicka);
  window.addEventListener("resize", D.zpozdeni(nastavVyskuHlavicky, 150));

  vykresliMetriky();
  vykresliLegendu();
  nastavUdalostiTabulky();
  nastavUdalostiDetailu();
  nastavPrepinaceMapy();
  nastavUdalostiSms();
  $("#stahnout-csv").addEventListener("click", stahniCsv);
  $("#letaky-zip").addEventListener("click", stahniZip);
  aktualizujZahlavi();

  nactiPrehled();
  nactiObce();
  if (vytvorMapu()) nactiH3();
  obnovPrihlaseni();
})();
