/* ===========================================================
   The themes offered in the admin console.

   `id` must match THEMES in api/core.js — the server refuses any
   other value, and a test fails if the two lists drift apart.
   `swatch` is [background, primary, secondary] and only draws the
   preview tile. `group` sorts the tiles into sections.
   =========================================================== */

window.ABY_THEME_GROUPS = [
  { id: 'classic', name: 'Classic' },
  { id: 'kids', name: 'Kids' },
  { id: 'debut', name: 'Debut' },
  { id: 'anniversary', name: 'Anniversary' },
  { id: 'christmas', name: 'Christmas' },
  { id: 'occasions', name: 'Other occasions' },
];

window.ABY_THEMES = [
  // ---- classic ----
  { id: 'rose-gold', name: 'Rose Gold', note: 'Plum and gold', group: 'classic', scheme: 'dark',
    swatch: ['#170e14', '#e7c27d', '#e9a6b8'] },
  { id: 'midnight', name: 'Midnight', note: 'Navy and champagne', group: 'classic', scheme: 'dark',
    swatch: ['#0b1020', '#d9c18a', '#9db8dd'] },
  { id: 'emerald', name: 'Emerald', note: 'Forest green and gold', group: 'classic', scheme: 'dark',
    swatch: ['#0b1512', '#e3c583', '#8fd3ad'] },
  { id: 'burgundy', name: 'Burgundy', note: 'Wine and blush', group: 'classic', scheme: 'dark',
    swatch: ['#1a0c10', '#e6b7a1', '#f0a9b8'] },
  { id: 'noir', name: 'Noir', note: 'Black and warm white', group: 'classic', scheme: 'dark',
    swatch: ['#0d0d0f', '#ded6c6', '#b9b2a6'] },
  { id: 'tropical', name: 'Tropical', note: 'Teal and coral', group: 'classic', scheme: 'dark',
    swatch: ['#07171c', '#f2a48c', '#6fd4cd'] },
  { id: 'ivory', name: 'Ivory', note: 'Cream and gold', group: 'classic', scheme: 'light',
    swatch: ['#faf6ef', '#a37a2e', '#c58fa0'] },
  { id: 'blush', name: 'Blush', note: 'Soft pink', group: 'classic', scheme: 'light',
    swatch: ['#fdf3f5', '#b0576f', '#d98ca2'] },
  { id: 'sage', name: 'Sage', note: 'Muted green and cream', group: 'classic', scheme: 'light',
    swatch: ['#f4f7f0', '#4f7a43', '#86a97a'] },
  { id: 'lavender', name: 'Lavender', note: 'Purple and silver', group: 'classic', scheme: 'light',
    swatch: ['#f6f4fb', '#6a4fa3', '#a58cd1'] },

  // ---- kids ----
  { id: 'kids-carnival', name: 'Carnival', note: 'Bright red and blue', group: 'kids', scheme: 'light',
    swatch: ['#fffaf0', '#e8532e', '#1f8fd6'] },
  { id: 'kids-pastel', name: 'Pastel', note: 'Mint and peach', group: 'kids', scheme: 'light',
    swatch: ['#f6fbf8', '#3f9c7c', '#f0907f'] },

  // ---- debut ----
  { id: 'debut-rose', name: 'Debut Rose', note: 'Deep rose and gold', group: 'debut', scheme: 'dark',
    swatch: ['#1b0d14', '#f0c987', '#f2a0c0'] },
  { id: 'debut-pearl', name: 'Debut Pearl', note: 'Pearl and soft taupe', group: 'debut', scheme: 'light',
    swatch: ['#fbfaf8', '#8a7d6b', '#c9a9b5'] },

  // ---- anniversary ----
  { id: 'anniversary-gold', name: 'Golden', note: 'Navy and gold', group: 'anniversary', scheme: 'dark',
    swatch: ['#0a1018', '#e5c15f', '#c9a24a'] },
  { id: 'anniversary-silver', name: 'Silver', note: 'Slate and silver', group: 'anniversary', scheme: 'light',
    swatch: ['#f7f8fa', '#5b6b7d', '#94a3b4'] },

  // ---- christmas ----
  { id: 'christmas-classic', name: 'Noche Buena', note: 'Pine, gold and red', group: 'christmas', scheme: 'dark',
    swatch: ['#0c1a12', '#e3c069', '#e06767'] },
  { id: 'christmas-frost', name: 'Frost', note: 'Icy blue and white', group: 'christmas', scheme: 'light',
    swatch: ['#f4f9fd', '#2f6ea8', '#7fb4d9'] },

  // ---- other occasions ----
  { id: 'christening', name: 'Christening', note: 'Soft blue and cream', group: 'occasions', scheme: 'light',
    swatch: ['#fbfaf5', '#7a9ab5', '#cbb89b'] },
  { id: 'fiesta', name: 'Fiesta', note: 'Mango and magenta', group: 'occasions', scheme: 'dark',
    swatch: ['#1a0f1c', '#ffab4a', '#ff6fae'] },
];

window.ABY_DEFAULT_THEME = 'rose-gold';

/** Falls back to the default for an empty or unknown id. */
window.abyApplyTheme = function (id) {
  var known = window.ABY_THEMES.some(function (t) { return t.id === id; });
  document.documentElement.setAttribute('data-theme', known ? id : window.ABY_DEFAULT_THEME);
};

/**
 * Colour overrides live on :root, so the tokens the whole stylesheet is
 * mixed from pick them up. An empty value hands the token back to the theme.
 */
window.abyApplyColors = function (accent, frame) {
  var root = document.documentElement;
  if (/^#[0-9a-fA-F]{6}$/.test(String(accent || ''))) root.style.setProperty('--gold', accent);
  else root.style.removeProperty('--gold');
  if (/^#[0-9a-fA-F]{6}$/.test(String(frame || ''))) root.style.setProperty('--frame', frame);
  else root.style.removeProperty('--frame');
};
