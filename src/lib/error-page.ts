// Self-contained HTML fallback for catastrophic SSR failures. Zero imports
// from the app: if module init or a dependency crashes, importing anything
// project-related here would take the error page down too. System font stack
// + inline CSS + inline SVG only. i18n bilingual (PL/EN) tekst obok siebie -
// nie wiemy, czy locale detektor przeżył awarię.
export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="pl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Coś poszło nie tak - Something went wrong</title>
    <style>
      *,*::before,*::after{box-sizing:border-box}
      html,body{margin:0;padding:0;height:100%}
      body{font-family:"Red Hat Display",system-ui,-apple-system,"Segoe UI",sans-serif;color:#141414;background:#f8f6f4;display:flex;align-items:center;justify-content:center;padding:24px;line-height:1.5}
      @media (prefers-color-scheme: dark){body{color:#f5f5f5;background:#0a0a0a}}
      main{max-width:520px;width:100%;text-align:center}
      .icon{width:56px;height:56px;margin:0 auto 20px;color:#b3261e}
      h1{font-size:22px;font-weight:700;margin:0 0 8px;letter-spacing:-0.01em}
      p{font-size:14px;margin:0 0 6px;opacity:.85}
      .actions{margin-top:24px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
      button,a.btn{appearance:none;border:1px solid currentColor;background:transparent;color:inherit;font:inherit;font-size:13px;font-weight:600;padding:8px 16px;border-radius:6px;cursor:pointer;text-decoration:none;transition:opacity .15s}
      button:hover,a.btn:hover{opacity:.75}
      a.btn.primary{background:#141414;color:#f8f6f4;border-color:#141414}
      @media (prefers-color-scheme: dark){a.btn.primary{background:#f5f5f5;color:#0a0a0a;border-color:#f5f5f5}}
    </style>
  </head>
  <body>
    <main>
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
      <h1>Coś poszło nie tak</h1>
      <p>Wystąpił nieoczekiwany błąd serwera. Spróbuj odświeżyć stronę.</p>
      <p style="font-size:12px;opacity:.6;margin-top:12px">An unexpected server error occurred. Please try again.</p>
      <div class="actions">
        <button type="button" onclick="location.reload()">Odśwież / Refresh</button>
        <a class="btn primary" href="/">Strona główna / Home</a>
      </div>
    </main>
  </body>
</html>`;
}
