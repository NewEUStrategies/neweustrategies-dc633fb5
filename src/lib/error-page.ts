// Emergency HTML fallback. Never a dead end: performs a bounded number of
// auto-retries (transient SSR crashes during dev/module reloads or cold worker
// starts should self-heal within a second or two) before showing manual
// controls. Copy stays bilingual-neutral and dependency-free — this page must
// render even when the app bundle failed to boot.
export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Reloading…</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font: 15px/1.5 system-ui, -apple-system, sans-serif; background: #fafafa; color: #111; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 28rem; width: 100%; text-align: center; padding: 2rem; }
      h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
      p { color: #4b5563; margin: 0 0 1.5rem; }
      .actions { display: none; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      .actions.visible { display: flex; }
      .spinner { width: 28px; height: 28px; border-radius: 50%; border: 3px solid #e5e7eb; border-top-color: #111; margin: 0 auto 1rem; animation: spin 0.8s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
      a, button { padding: 0.5rem 1rem; border-radius: 0.375rem; font: inherit; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
      .primary { background: #111; color: #fff; }
      .secondary { background: #fff; color: #111; border-color: #d1d5db; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="spinner" id="spinner"></div>
      <h1 id="title">Reloading…</h1>
      <p id="msg">One moment — retrying the page.</p>
      <div class="actions" id="actions">
        <button class="primary" onclick="location.reload()">Try again</button>
        <a class="secondary" href="/">Go home</a>
      </div>
    </div>
    <script>
      (function () {
        try {
          var KEY = '__ssr_retry_count';
          var MAX = 3;
          var n = parseInt(sessionStorage.getItem(KEY) || '0', 10) || 0;
          if (n < MAX) {
            sessionStorage.setItem(KEY, String(n + 1));
            var delay = 600 + n * 700;
            setTimeout(function () { location.reload(); }, delay);
            return;
          }
          sessionStorage.removeItem(KEY);
        } catch (e) { /* storage disabled — fall through to manual */ }
        document.getElementById('spinner').style.display = 'none';
        document.getElementById('title').textContent = "This page didn't load";
        document.getElementById('msg').textContent = 'Something went wrong on our end. Try refreshing or head back home.';
        document.getElementById('actions').classList.add('visible');
      })();
      // Clear the retry counter once the app successfully boots on a later navigation.
      window.addEventListener('pageshow', function () {
        try { sessionStorage.removeItem('__ssr_retry_count'); } catch (e) {}
      });
    </script>
  </body>
</html>`;
}
