// Motion presets used by widget enter animations.
import type { CSSProperties } from "react";

export const MOTION_INITIAL: Record<string, (d: number) => CSSProperties> = {
  fade: () => ({ opacity: 0 }),
  "slide-up": (d) => ({ opacity: 0, transform: `translateY(${d}px)` }),
  "slide-down": (d) => ({ opacity: 0, transform: `translateY(-${d}px)` }),
  "slide-left": (d) => ({ opacity: 0, transform: `translateX(${d}px)` }),
  "slide-right": (d) => ({ opacity: 0, transform: `translateX(-${d}px)` }),
  zoom: () => ({ opacity: 0, transform: "scale(0.92)" }),
  "zoom-out": () => ({ opacity: 0, transform: "scale(1.08)" }),
  bounce: (d) => ({ opacity: 0, transform: `translateY(${d}px) scale(0.96)` }),
  "flip-x": () => ({ opacity: 0, transform: "perspective(800px) rotateX(70deg)" }),
  "flip-y": () => ({ opacity: 0, transform: "perspective(800px) rotateY(70deg)" }),
  rotate: () => ({ opacity: 0, transform: "rotate(-12deg) scale(0.96)" }),
  skew: () => ({ opacity: 0, transform: "skewY(6deg) translateY(16px)" }),
  blur: () => ({ opacity: 0, filter: "blur(12px)" }),
  "reveal-up": (d) => ({
    opacity: 0,
    clipPath: "inset(100% 0 0 0)",
    transform: `translateY(${d / 2}px)`,
  }),
  "reveal-down": (d) => ({
    opacity: 0,
    clipPath: "inset(0 0 100% 0)",
    transform: `translateY(-${d / 2}px)`,
  }),
  tilt: () => ({ opacity: 0, transform: "rotate(4deg) translateY(20px)" }),
  swing: () => ({ opacity: 0, transform: "rotate(-6deg)" }),
  pulse: () => ({ opacity: 0, transform: "scale(1.06)" }),
  rubber: () => ({ opacity: 0, transform: "scale(1.1, 0.85)" }),
};

export const MOTION_FINAL: CSSProperties = {
  opacity: 1,
  transform: "translate(0,0) scale(1) rotate(0) skew(0) perspective(800px) rotateX(0) rotateY(0)",
  filter: "blur(0)",
  clipPath: "inset(0 0 0 0)",
};

export const EASING_MAP: Record<string, string> = {
  ease: "ease",
  "ease-in": "ease-in",
  "ease-out": "ease-out",
  "ease-in-out": "ease-in-out",
  linear: "linear",
  spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  bounce: "cubic-bezier(0.68, -0.55, 0.27, 1.55)",
};
