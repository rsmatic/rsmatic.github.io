/* ===========================================================
   Saan nakatira ang API.

   Kapag na-deploy mo na ang Cloudflare Worker, i-paste dito ang
   URL nito, i-commit, at i-push. Iyon lang ang kailangang baguhin
   para gumana ang https://rsmatic.github.io/booking/

   Iwanang '' kung lokal kang tumatakbo (node server/server.js) —
   ibig sabihin, kaparehong origin ng page.
   =========================================================== */

window.ABY_CONFIG = {
  api: 'https://aby41-api.rsmatic-dev.workers.dev',
};
