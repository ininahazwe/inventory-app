// src/lib/sections.ts
//
// Single source of truth for the app's four sections: used by the hub grid
// (HomePage) to draw its tiles, and by SectionRevealCover to paint each
// destination page with the same color/icon the tile expanded from — that
// reuse is what makes the transition read as one continuous motion.
//
// Colors are pulled from identities the app already uses elsewhere, not
// invented: bordeaux/"green" already color the Auctions/Supplies nav pills
// in Layout.tsx, amber is the existing --repair status color in theme.css.
export interface SectionDef {
  key: string;
  path: string;
  label: string;
  description: string;
  icon: string;
  color: string;
}

// Pastel tints in the same hue family as each section's existing saturated
// identity color (the header pill / status-chip colors below, unchanged) —
// softer on the hub's tile grid, still recognizably "that section's color"
// everywhere else in the app.
export const SECTIONS: SectionDef[] = [
  {
    key: 'inventory',
    path: '/inventory',
    label: 'Inventory',
    description: 'IT equipment & assets',
    icon: '🖥︎',
    color: '#E2E0F2', // tint of --brand #242038
  },
  {
    key: 'supplies',
    path: '/supplies',
    label: 'Supplies',
    description: 'Consumables & stock',
    icon: '📋︎',
    color: '#DCEAE6', // tint of .pill.green #213547
  },
  {
    key: 'auctions',
    path: '/auctions',
    label: 'Auctions',
    description: 'Retired asset sales',
    icon: '⏱︎',
    color: '#F4DEE0', // tint of .pill.bordeaux #6d071a
  },
  {
    key: 'incidents',
    path: '/incidents',
    label: 'Incidents',
    description: 'Damage & repair reports',
    icon: '🛠︎',
    color: '#F6E4C7', // tint of .chip--repair #b98b46
  },
];

export const getSection = (key: string): SectionDef | undefined =>
  SECTIONS.find(s => s.key === key);
