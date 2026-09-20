/* ===========================================================
   The ten themes offered in the admin console.

   `id` must match THEMES in api/core.js — the server refuses any
   other value. `swatch` is [background, primary, secondary] and is
   only used to draw the preview tile.
   =========================================================== */

window.ABY_THEMES = [
  { id: 'rose-gold', name: 'Rose Gold', note: 'Plum and gold', scheme: 'dark',
    swatch: ['#170e14', '#e7c27d', '#e9a6b8'] },
  { id: 'midnight', name: 'Midnight', note: 'Navy and champagne', scheme: 'dark',
    swatch: ['#0b1020', '#d9c18a', '#9db8dd'] },
  { id: 'emerald', name: 'Emerald', note: 'Forest green and gold', scheme: 'dark',
    swatch: ['#0b1512', '#e3c583', '#8fd3ad'] },
  { id: 'burgundy', name: 'Burgundy', note: 'Wine and blush', scheme: 'dark',
    swatch: ['#1a0c10', '#e6b7a1', '#f0a9b8'] },
  { id: 'noir', name: 'Noir', note: 'Black and warm white', scheme: 'dark',
    swatch: ['#0d0d0f', '#ded6c6', '#b9b2a6'] },
  { id: 'tropical', name: 'Tropical', note: 'Teal and coral', scheme: 'dark',
    swatch: ['#07171c', '#f2a48c', '#6fd4cd'] },
  { id: 'ivory', name: 'Ivory', note: 'Cream and gold', scheme: 'light',
    swatch: ['#faf6ef', '#a37a2e', '#c58fa0'] },
  { id: 'blush', name: 'Blush', note: 'Soft pink', scheme: 'light',
    swatch: ['#fdf3f5', '#b0576f', '#d98ca2'] },
  { id: 'sage', name: 'Sage', note: 'Muted green and cream', scheme: 'light',
    swatch: ['#f4f7f0', '#4f7a43', '#86a97a'] },
  { id: 'lavender', name: 'Lavender', note: 'Purple and silver', scheme: 'light',
    swatch: ['#f6f4fb', '#6a4fa3', '#a58cd1'] },
];

window.ABY_DEFAULT_THEME = 'rose-gold';

/** Falls back to the default for an empty or unknown id. */
window.abyApplyTheme = function (id) {
  var known = window.ABY_THEMES.some(function (t) { return t.id === id; });
  document.documentElement.setAttribute('data-theme', known ? id : window.ABY_DEFAULT_THEME);
};
