// src/components/GoogleSignInButton.tsx
//
// Google's own rendered "Sign in with Google" button. Deterministic by
// construction: it always opens the account chooser on click, unlike
// `google.accounts.id.prompt()` (One Tap), whose display Google can suppress
// based on session/cooldown/FedCM state that varies by browser and profile —
// which is why sign-in used to appear to open "randomly" in dev.
//
// Renders itself into a container div once the Google SDK is ready. If
// `width` isn't given, it measures its wrapper and clamps to a sensible
// range, so it can drop into a full-width card or a compact header slot.
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { auth } from "../lib/apiClient";

interface GoogleSignInButtonProps {
  width?: number;
  className?: string;
  style?: React.CSSProperties;
}

const MIN_WIDTH = 200;
const MAX_WIDTH = 400;

export function GoogleSignInButton({ width, className, style }: GoogleSignInButtonProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLDivElement | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number | undefined>(width);

  // Measure the wrapper when no explicit width is given, and keep it in sync
  // as the layout changes (card resize, responsive breakpoint).
  useLayoutEffect(() => {
    if (width !== undefined) return;
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;

    const apply = () => {
      const w = Math.round(wrap.getBoundingClientRect().width);
      if (w > 0) setMeasuredWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w)));
    };
    apply();

    const ro = new ResizeObserver(apply);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [width]);

  const effectiveWidth = width ?? measuredWidth;

  useEffect(() => {
    if (effectiveWidth === undefined) return;
    let cancelled = false;

    auth.renderGoogleButton(btnRef.current, { width: effectiveWidth }).catch(err => {
      if (!cancelled) console.error("Failed to render Google Sign-In button:", err);
    });

    return () => {
      cancelled = true;
    };
  }, [effectiveWidth]);

  return (
    <div ref={wrapRef} className={className} style={{ width: "100%", ...style }}>
      <div ref={btnRef} style={{ display: "flex", justifyContent: "center" }} />
    </div>
  );
}
