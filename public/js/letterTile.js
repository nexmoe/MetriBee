// Letter tile for a site with no favicon: first letter on a chart series color.
// Shared by the browser (globe.js) and node (tests), like clusterMarks.js.
(function (g) {
  const SERIES = ["#4f46e5", "#0891b2", "#d97706", "#7c3aed"];
  function letterTile(name, index) {
    const letter = (String(name || "").replace(/^(https?:\/\/)?(www\.)?/i, "").match(/[a-z0-9]/i) || ["?"])[0].toUpperCase();
    const i = Math.abs(Number(index) || 0) % SERIES.length;
    return { letter, color: SERIES[i] };
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { letterTile };
  else g.letterTile = letterTile;
})(this);
