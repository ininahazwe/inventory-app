// src/components/SectionRevealCover.tsx
//
// Mounted at the top of each of the 4 section pages. Paints the viewport in
// that section's color (same config HomePage's tiles use) for a beat, then
// fades away to reveal the real page — the second half of the hub's
// expand-to-fullscreen tile animation, picked up on the other side of the
// route change. Purely decorative: unmounts itself once done, and does
// nothing at all under prefers-reduced-motion.
import React, { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { getSection } from "../lib/sections";

const REVEAL_DELAY = 0.08;
const REVEAL_DURATION = 0.42;

export function SectionRevealCover({ sectionKey }: { sectionKey: string }) {
  const section = getSection(sectionKey);
  const reduceMotion = useReducedMotion();
  const [visible, setVisible] = useState(!reduceMotion);

  useEffect(() => {
    if (reduceMotion) return;
    // Matches REVEAL_DELAY + REVEAL_DURATION below, plus a small buffer.
    const t = setTimeout(() => setVisible(false), (REVEAL_DELAY + REVEAL_DURATION) * 1000 + 80);
    return () => clearTimeout(t);
  }, [reduceMotion]);

  if (!visible || !section) return null;

  return (
    <motion.div
      aria-hidden="true"
      initial={{ opacity: 1, scale: 1 }}
      animate={{ opacity: 0, scale: 1.04 }}
      transition={{ delay: REVEAL_DELAY, duration: REVEAL_DURATION, ease: [0.4, 0, 0.2, 1] }}
      onAnimationComplete={() => setVisible(false)}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        background: section.color,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <span style={{ fontSize: "min(18vw, 140px)", filter: "brightness(0)", opacity: 0.8 }}>
        {section.icon}
      </span>
    </motion.div>
  );
}
