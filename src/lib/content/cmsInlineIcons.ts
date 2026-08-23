// Bezpieczne, dekoracyjne ikony statusu dla treści CMS. Funkcja działa dopiero
// PO sanityzacji HTML, a wstawiany markup jest stałą aplikacji - nigdy wejściem
// użytkownika. Dzięki temu Elementor-style i renderer bloków używają jednego
// kontraktu bez dopuszczania SVG do polityki sanitizera.

const ICONS: Readonly<Record<string, string>> = {
  "✅": '<svg class="cms-inline-status-icon cms-inline-status-icon--success" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>',
  "❌": '<svg class="cms-inline-status-icon cms-inline-status-icon--error" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>',
  "⚠️": '<svg class="cms-inline-status-icon cms-inline-status-icon--warning" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
};

const STATUS_EMOJI_RE = /✅|❌|⚠️/g;

export function decorateCmsStatusIcons(sanitizedHtml: string): string {
  return sanitizedHtml.replace(STATUS_EMOJI_RE, (emoji) => ICONS[emoji] ?? emoji);
}