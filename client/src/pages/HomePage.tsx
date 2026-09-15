// src/pages/HomePage.tsx
//
// Landing hub: one square per section. Clicking a tile expands it to fill
// the viewport (a framer-motion `layout` animation — the same element moves
// from a grid cell to a fixed fullscreen panel, no manual keyframing) while
// the other tiles recede, then navigates. SectionRevealCover picks up the
// same color/icon on the destination page and fades it out, so the two
// independent animations read as one continuous motion across the route
// change.
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import Layout from "../Layout";
import { SECTIONS, type SectionDef } from "../lib/sections";

const EXPAND_DURATION = 0.45;

function SectionTile({
  section,
  state,
  onActivate,
}: {
  section: SectionDef;
  state: "idle" | "active" | "receding";
  onActivate: (section: SectionDef) => void;
}) {
  const isIdle = state === "idle";

  const handleActivate = () => {
    if (state !== "idle") return; // ignore repeat clicks / clicks on receding siblings
    onActivate(section);
  };

  return (
    <motion.div
      layout
      role="button"
      tabIndex={0}
      aria-label={`${section.label} — ${section.description}`}
      onClick={handleActivate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleActivate();
        }
      }}
      initial={false}
      animate={
        state === "receding"
          ? { opacity: 0, scale: 0.92 }
          : { opacity: 1, scale: 1 }
      }
      whileHover={isIdle ? { y: -6, scale: 1.02 } : undefined}
      whileTap={isIdle ? { scale: 0.97 } : undefined}
      transition={
        state === "active"
          ? { layout: { duration: EXPAND_DURATION, ease: [0.65, 0, 0.35, 1] } }
          : { duration: 0.25, ease: "easeOut" }
      }
      style={{
        ...(state === "active"
          ? { position: "fixed", inset: 0, zIndex: 1000, borderRadius: 0 }
          : { position: "relative", borderRadius: 28 }),
        aspectRatio: state === "active" ? undefined : "1",
        background: section.color,
        color: "var(--ink)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        padding: 24,
        cursor: isIdle ? "pointer" : "default",
        outline: "none",
        boxShadow: "0 10px 24px rgba(36,32,56,.10)",
        userSelect: "none",
      }}
      className="section-tile"
    >
      <motion.span
        layout="position"
        style={{ fontSize: state === "active" ? "min(20vw, 160px)" : "min(9vw, 52px)", filter: "brightness(0)", opacity: 0.8 }}
      >
        {section.icon}
      </motion.span>
      <motion.span layout="position" style={{ fontSize: 20, fontWeight: 700, letterSpacing: ".01em" }}>
        {section.label}
      </motion.span>
      {state !== "active" && (
        <span style={{ fontSize: 13, opacity: 0.68, textAlign: "center" }}>{section.description}</span>
      )}
    </motion.div>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const handleActivate = (section: SectionDef) => {
    if (reduceMotion) {
      navigate(section.path);
      return;
    }
    setActiveKey(section.key);
    // Timed to EXPAND_DURATION rather than an onLayoutAnimationComplete
    // callback: deterministic regardless of framer-motion internals, and
    // navigation can't get stuck waiting on a callback that fails to fire.
    setTimeout(() => navigate(section.path), EXPAND_DURATION * 1000 + 30);
  };

  return (
    <Layout>
      <div style={{ padding: "12px 4px 4px", maxWidth: 900, margin: "0 auto" }}>
        <h2 style={{ margin: "4px 0 4px", letterSpacing: 0.2 }}>Welcome back</h2>
        <p style={{ margin: "0 0 28px", color: "var(--muted)" }}>Choose a section to get started.</p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 20,
          }}
        >
          {SECTIONS.map((section) => (
            <SectionTile
              key={section.key}
              section={section}
              state={
                activeKey === null ? "idle" : activeKey === section.key ? "active" : "receding"
              }
              onActivate={handleActivate}
            />
          ))}
        </div>
      </div>
    </Layout>
  );
}
