// src/components/MemoSpinner.tsx
// Retour visuel partagé du module Memos : spinner et animations (chargement, étape qui change).
import React from 'react';

export const MEMO_ANIMATIONS = `
@keyframes memo-spin { to { transform: rotate(360deg); } }
@keyframes memo-pulse { 0%,100% { background: #fffbeb; } 50% { background: #fde68a; } }
@keyframes memo-flash { from { background: #bbf7d0; } to { background: transparent; } }
@keyframes memo-bar { 0% { left: -40%; } 100% { left: 100%; } }
@media (prefers-reduced-motion: reduce) { .memo-anim { animation: none !important; } }
`;

export const Spinner = ({ color = '#fff', size = 14 }: { color?: string; size?: number }) => (
  <span aria-hidden="true" className="memo-anim" style={{
    display: 'inline-block', width: size, height: size, marginRight: 8, verticalAlign: '-2px', borderRadius: '50%',
    border: `2px solid ${color}55`, borderTopColor: color, animation: 'memo-spin .7s linear infinite',
  }} />
);
