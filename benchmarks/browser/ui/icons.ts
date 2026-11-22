const icon = (paths: string): string =>
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const icons = {
  play: icon('<path d="m8 5 12 7-12 7V5Z"/>'),
  x: icon('<path d="m18 6-12 12M6 6l12 12"/>'),
  download: icon(
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' + '<path d="m7 10 5 5 5-5M12 15V3"/>',
  ),
} as const;
