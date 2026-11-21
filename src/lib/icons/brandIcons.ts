/**
 * Ikony marek (Facebook, LinkedIn, X/Twitter, Instagram, YouTube, GitHub, Google).
 * Lucide 1.x usunęło ikony marek z pakietu; zachowujemy identyczną geometrię
 * z lucide-react 0.577.0 (ISC), więc wygląd i API (`LucideIcon`) bez zmian.
 */
import { createLucideIcon } from "lucide-react";
import { BRAND_ICON_NODES } from "./brandIconNodes.mjs";

export const Facebook = createLucideIcon("facebook", BRAND_ICON_NODES.facebook);
export const Linkedin = createLucideIcon("linkedin", BRAND_ICON_NODES.linkedin);
export const Twitter = createLucideIcon("twitter", BRAND_ICON_NODES.twitter);
export const Instagram = createLucideIcon("instagram", BRAND_ICON_NODES.instagram);
export const Youtube = createLucideIcon("youtube", BRAND_ICON_NODES.youtube);
export const Github = createLucideIcon("github", BRAND_ICON_NODES.github);
export const Google = createLucideIcon("google", BRAND_ICON_NODES.google);
