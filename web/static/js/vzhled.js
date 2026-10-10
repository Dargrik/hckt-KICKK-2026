// Dojedeme – web má jen světlý vzhled (tmavý režim je zrušený). Načítá se v <head> synchronně: data-theme="light"
// vypne tmavé barvy z tokens.css i při tmavém nastavení systému. Starou uloženou volbu přepínače mažeme.
(function () {
  document.documentElement.setAttribute("data-theme", "light");
  try { localStorage.removeItem("dojedeme.vzhled"); } catch (e) { /* bez úložiště to jde i tak */ }
})();
