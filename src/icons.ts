const icon = (paths: string): string =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const ICONS = {
  reset: icon('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'),
  rotate: icon('<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>'),
  wireframe: icon(
    '<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="m3 7 9 5 9-5"/><path d="M12 12v10"/>',
  ),
  texture: icon(
    '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 8h.01"/><path d="M12 10h.01"/><path d="M16 8h.01"/><path d="M9 14h.01"/><path d="M15 13h.01"/><path d="M12 17h.01"/>',
  ),
  dimensions: icon(
    '<path d="M3 8V3h5"/><path d="M16 3h5v5"/><path d="M21 16v5h-5"/><path d="M8 21H3v-5"/>',
  ),
  section: icon('<path d="M12 3 2 8l10 5 10-5z"/><path d="m2 16 10 5 10-5"/>'),
  measure: icon(
    '<path d="M3 17 17 3l4 4L7 21z"/><path d="m7 13 2 2"/><path d="m10 10 2 2"/><path d="m13 7 2 2"/>',
  ),
  plate: icon(
    '<rect x="2" y="16" width="20" height="4" rx="1"/><path d="M7 16V8h10v8"/>',
  ),
};
