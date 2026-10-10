// Dojedeme – Letáky pro obce: 134 obcí z /obce. Název obce = stažení letáku (PDF), „Zobrazit lékaře“ = lékaři v dosahu
// přímo u obce (/obce/{kod}/lekari). Hodnocení dostupnosti je jen v administraci.
(function () {
  "use strict";
  const D = window.Dojedeme;
  const esc = D.esc;
  const razeni = new Intl.Collator("cs");

  const seznam = document.getElementById("seznam-obci");
  const hledani = document.getElementById("hledat-obec");
  const pocet = document.getElementById("pocet-obci");
  const stavSeznamu = document.getElementById("seznam-stav");
  let obce = [];
  const nactene = new Map(); // kod -> Promise s daty letáku

  /** Text bez diakritiky a velkých písmen (pro hledání). */
  function normalizuj(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim(); }
  function slug(s) { return normalizuj(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  function obciSlovy(n) { return n === 1 ? "1 obec" : n >= 2 && n <= 4 ? `${n} obce` : `${n} obcí`; }
  function lekaruSlovy(n) { return n === 1 ? "1 lékař" : n >= 2 && n <= 4 ? `${n} lékaři` : `${n} lékařů`; }
  /** Zastávka „Teplá,nám.“ → „Teplá, nám.“ */
  function zastavka(s) { return String(s || "").replace(/,(?=\S)/g, ", "); }
  /** Počáteční písmeno pro rozdělení seznamu (Ch je v češtině samostatné písmeno). */
  function pismeno(nazev) { return /^ch/i.test(nazev) ? "Ch" : nazev.charAt(0).toUpperCase(); }

  /* ---------- Výška hlavičky (aby skok na obec nezajel pod lepivou hlavičku) ---------- */
  function nastavVyskuHlavicky() {
    const h = document.querySelector(".web-hlavicka");
    const lepi = h && getComputedStyle(h).position === "sticky";
    document.documentElement.style.setProperty("--vyska-hlavicky", lepi ? `${Math.ceil(h.getBoundingClientRect().height) + 16}px` : "16px");
  }

  /* ---------- Seznam obcí ---------- */
  function radekObce(o) {
    const nazev = esc(o.obec);
    const kod = esc(o.kod_obce);
    return `
      <li class="obec" id="obec-${kod}" data-kod="${kod}" data-hledat="${esc(normalizuj(o.obec))}">
        <div class="obec-radek">
          <a class="obec-letak" href="${esc(o.letak)}" download="dojedeme-lekari-${esc(slug(o.obec))}.pdf" type="application/pdf"
             aria-label="${nazev}, stáhnout leták (PDF)"><i class="ph-bold ph-file-pdf" aria-hidden="true"></i><span>${nazev}</span></a>
          <button type="button" class="odkryt" aria-expanded="false" aria-controls="lekari-${kod}" aria-label="Zobrazit lékaře pro obec ${nazev}">
            <span class="odkryt-text">Zobrazit lékaře</span><i class="ph-bold ph-caret-down" aria-hidden="true"></i></button>
        </div>
        <div class="lekari-panel" id="lekari-${kod}" hidden>
          <p class="panel-stav" role="status"></p>
          <div class="panel-obsah"></div>
        </div>
      </li>`;
  }

  function vykresliSeznam() {
    const skupiny = new Map();
    for (const o of obce) {
      const p = pismeno(o.obec);
      if (!skupiny.has(p)) skupiny.set(p, []);
      skupiny.get(p).push(o);
    }
    seznam.innerHTML = [...skupiny].map(([p, os]) => `
      <section class="skupina" aria-label="Obce na ${esc(p)}">
        <h3 class="pismeno" aria-hidden="true">${esc(p)}</h3>
        <ul class="obce">${os.map(radekObce).join("")}</ul>
      </section>`).join("");
    filtruj(true);
  }

  const oznamPocet = D.zpozdeni((text) => { pocet.textContent = text; }, 600);
  function filtruj(hned = false) {
    const q = normalizuj(hledani.value);
    let n = 0;
    seznam.querySelectorAll(".obec").forEach((li) => {
      const shoda = !q || li.dataset.hledat.split(/[\s-]+/).some((slovo) => slovo.startsWith(q)) || li.dataset.hledat.startsWith(q);
      li.hidden = !shoda;
      if (shoda) n++;
    });
    seznam.querySelectorAll(".skupina").forEach((s) => { s.hidden = !s.querySelector(".obec:not([hidden])"); });
    let text;
    if (!q) text = `${obciSlovy(n)} podle abecedy.`;
    else if (n === 0) text = `Žádná obec nezačíná na „${hledani.value.trim()}“. Zkontrolujte název.`;
    else text = n === 1 ? "Nalezena 1 obec." : n <= 4 ? `Nalezeny ${obciSlovy(n)}.` : `Nalezeno ${obciSlovy(n)}.`;
    if (hned) pocet.textContent = text; else oznamPocet(text);
  }

  /* ---------- Lékaři v dosahu ---------- */
  function telefonyHtml(tel) {
    const t = (tel || []).filter(Boolean);
    if (!t.length) return "";
    return `<p class="telefony">${t.map((x) => `<a class="telefon" href="${esc(D.telefonOdkaz(x))}"><i class="ph-bold ph-phone" aria-hidden="true"></i>${esc(D.telefon(x))}</a>`).join("")}</p>`;
  }

  function spojHtml(l) {
    if (l.pesky) return `<p class="lekar-spoj">Pěšky ${esc(D.minuty(l.cesta_min))}.</p>`;
    if (!l.odjezd) return `<p class="lekar-spoj">Spoj se nepodařilo najít.</p>`;
    const odkud = l.zastavka ? ` ze zastávky ${esc(zastavka(l.zastavka))}` : "";
    return `<p class="lekar-spoj">Spojem: odjezd <b>${esc(l.odjezd)}</b>${odkud}, příjezd <b>${esc(l.prijezd)}</b>.<br>
      Cesta ${esc(D.minuty(l.cesta_min))}, ${esc(D.prestupy(l.prestupy || 0))}.</p>`;
  }

  function lekarHtml(l) {
    const jmena = l.lekari && l.lekari !== l.nazev ? `<p>${esc(l.lekari)}</p>` : "";
    return `
      <li class="lekar">
        <p class="lekar-obor">${esc(l.typ_nazev || "Lékař")}</p>
        <p class="lekar-nazev">${esc(l.nazev)}</p>
        ${jmena}
        ${l.adresa ? `<p>${esc(l.adresa)}</p>` : ""}
        ${telefonyHtml(l.telefon)}
        ${spojHtml(l)}
      </li>`;
  }

  /** Senior Expres jen tam, kde v obci jezdí. */
  function seniorExpresHtml(d) {
    const se = d.senior_expres || [];
    if (!se.length) return "";
    return `<section class="senior-expres" aria-label="Odvoz pro seniory v obci"><h4>Odvoz pro seniory v obci</h4>
      ${se.map((s) => {
        const jmeno = s.nazev || "Senior Expres";
        const podrobnosti = [s.podminky, s.provoz ? `Jezdí: ${s.provoz}.` : "", s.cena ? `Cena: ${s.cena}.` : ""]
          .filter(Boolean).map((x) => x.trim().replace(/\.?$/, ".")).join(" ");
        return `<div class="se-karta">
          <p class="se-nazev">${esc(jmeno)}</p>
          ${podrobnosti ? `<p>${esc(podrobnosti)}</p>` : ""}
          ${s.telefon ? `<p><a class="tlacitko signal" href="${esc(D.telefonOdkaz(s.telefon))}"><i class="ph-bold ph-phone" aria-hidden="true"></i>Zavolat ${esc(D.telefon(s.telefon))}</a></p>` : ""}
        </div>`;
      }).join("")}</section>`;
  }

  function panelHtml(d) {
    const nabira = d.nabira || [];
    const nejblizsi = d.nejblizsi || [];
    const uvod = `<p class="panel-uvod">Lékaři, ke kterým se ze zastávky ${esc(zastavka(d.zastavka || ""))} dostanete do ${esc(D.minuty(d.limit_min))}.
      Nahoře jsou ti, ke kterým dojedete nejrychleji. Spoje platí pro běžný pracovní den.</p>`;
    const sekceNabira = nabira.length
      ? `<section aria-label="Přijímají nové pacienty"><h4>Přijímají nové pacienty: ${esc(lekaruSlovy(nabira.length))}</h4>
          <ul class="lekari">${nabira.map(lekarHtml).join("")}</ul></section>`
      : `<p>V dosahu jsme nenašli lékaře, o kterém víme, že přijímá nové pacienty.</p>`;
    const sekceNejblizsi = nejblizsi.length
      ? `<section aria-label="Nejbližší praktický lékař a zubař"><h4>Nejbližší praktický lékař a zubař</h4>
          <p class="panel-uvod">Nemusí přijímat nové pacienty, zeptejte se telefonem.</p>
          <ul class="lekari">${nejblizsi.map(lekarHtml).join("")}</ul></section>` : "";
    return `${uvod}${sekceNabira}${sekceNejblizsi}${seniorExpresHtml(d)}`;
  }

  async function nactiLekare(li, obec) {
    const panel = li.querySelector(".lekari-panel");
    const stav = panel.querySelector(".panel-stav");
    const obsah = panel.querySelector(".panel-obsah");
    if (panel.dataset.nacteno === "1") return;
    stav.textContent = `Načítám lékaře pro obec ${obec.obec}…`;
    panel.setAttribute("aria-busy", "true");
    obsah.innerHTML = '<div class="skeleton sk-radek"></div><div class="skeleton sk-radek"></div><div class="skeleton sk-radek kratsi"></div>';
    try {
      if (!nactene.has(obec.kod_obce)) nactene.set(obec.kod_obce, D.api(`/obce/${encodeURIComponent(obec.kod_obce)}/lekari`));
      const d = await nactene.get(obec.kod_obce);
      obsah.innerHTML = panelHtml(d);
      panel.dataset.nacteno = "1";
      stav.textContent = "Lékaři načteni.";
      stav.classList.add("sr");
    } catch (e) {
      nactene.delete(obec.kod_obce);
      stav.textContent = "";
      obsah.innerHTML = `<div class="blok chyba" role="alert"><i class="ph-bold ph-warning ikona" aria-hidden="true"></i>
        <div><strong>Lékaře se nepodařilo načíst.</strong>${esc(e.message)} Zkuste to znovu, nebo si stáhněte leták.</div></div>
        <p class="znovu-obal"><button type="button" class="tlacitko vedlejsi znovu">Načíst znovu</button></p>`;
      obsah.querySelector(".znovu").addEventListener("click", () => nactiLekare(li, obec));
    } finally {
      panel.removeAttribute("aria-busy");
    }
  }

  function prepniPanel(li, otevrit) {
    const tlacitko = li.querySelector(".odkryt");
    const panel = li.querySelector(".lekari-panel");
    const obec = obce.find((o) => o.kod_obce === li.dataset.kod);
    const otevreno = otevrit ?? tlacitko.getAttribute("aria-expanded") !== "true";
    tlacitko.setAttribute("aria-expanded", String(otevreno));
    tlacitko.querySelector(".odkryt-text").textContent = otevreno ? "Skrýt lékaře" : "Zobrazit lékaře";
    tlacitko.setAttribute("aria-label", `${otevreno ? "Skrýt" : "Zobrazit"} lékaře pro obec ${obec.obec}`);
    panel.hidden = !otevreno;
    li.classList.toggle("otevrena", otevreno);
    if (otevreno) {
      try { history.replaceState(null, "", `#${obec.kod_obce}`); } catch (e) { /* nic */ }
      nactiLekare(li, obec);
    } else if (location.hash === `#${obec.kod_obce}`) {
      try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { /* nic */ }
    }
  }

  /* ---------- Odkaz /pro-obce#kod ---------- */
  function otevriZOdkazu() {
    const kod = decodeURIComponent(location.hash.replace(/^#/, "")).trim();
    if (!/^\d{6}$/.test(kod)) return;
    const li = document.getElementById(`obec-${kod}`);
    if (!li) return;
    if (li.hidden) { hledani.value = ""; filtruj(true); }
    prepniPanel(li, true);
    try { if ("scrollRestoration" in history) history.scrollRestoration = "manual"; } catch (e) { /* nic */ }
    li.scrollIntoView({ block: "start", behavior: "auto" });
    li.querySelector(".obec-letak").focus({ preventScroll: true });
  }

  /* ---------- Start ---------- */
  async function start() {
    nastavVyskuHlavicky();
    window.addEventListener("resize", D.zpozdeni(nastavVyskuHlavicky, 200));
    pocet.textContent = "Načítám seznam obcí…";
    try {
      const d = await D.api("/obce");
      obce = (d.obce || []).slice().sort((a, b) => razeni.compare(a.obec, b.obec));
      vykresliSeznam();
      otevriZOdkazu();
    } catch (e) {
      seznam.innerHTML = "";
      pocet.textContent = "";
      stavSeznamu.innerHTML = `<div class="blok chyba" role="alert"><i class="ph-bold ph-warning ikona" aria-hidden="true"></i>
        <div><strong>Seznam obcí se nepodařilo načíst.</strong>${esc(e.message)} Zkuste stránku načíst znovu.</div></div>`;
    }
  }

  hledani.addEventListener("input", () => filtruj(false));
  hledani.addEventListener("search", () => filtruj(false));
  seznam.addEventListener("click", (e) => {
    const b = e.target.closest(".odkryt");
    if (b) prepniPanel(b.closest(".obec"));
  });
  window.addEventListener("hashchange", otevriZOdkazu);
  start();
})();
