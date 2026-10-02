// ── Search Helpers ──────────────────────────────────────────────────────────
// Every employee search box in the app runs its text through here first, so a
// query typed on a plain keyboard finds names that carry diacritics: "josias"
// finds "Josías", "munoz" finds "Muñoz", "jesus" finds "Jesús".
//
// Decomposing to NFD splits an accented letter into its base letter plus a
// combining mark, and dropping the marks leaves the base — which beats listing
// character pairs, because it covers every accent, tilde and cedilla at once.
export const normalizeForSearch = (value) =>
    (value || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
