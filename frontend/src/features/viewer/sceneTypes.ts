// Shared by the page and the lazily loaded Three.js scene; must not import three.
import type { BarVariant } from "./geometry";

export interface SceneHandle {
  reset: () => void;
  zoom: (factor: number) => void; // >1 zooms in, <1 zooms out
}

export const BAR_COLORS: Record<BarVariant, string> = {
  original: "#475569", // slate: staple, original sequence
  "selected-variant": "#d97706", // amber: staple where the optimizer chose a supplied variant
  "not-optimized": "#94a3b8", // light slate: staple without variants (fixed)
};

export const MOLECULAR_COLORS = {
  scaffold: "#2563eb", // blue: strand verified as the design's scaffold (exact sequence match)
  staple: "#64748b", // slate: strand verified as a design staple
  unassigned: "#a78bfa", // violet: strand with no verified identity in the linked design
  variantSelected: "#d97706", // amber: optimizer chose a supplied variant for this (verified) staple
  variantIncompatible: "#dc2626", // red: chosen variant length differs from the modelled strand
} as const;
