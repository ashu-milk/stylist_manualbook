/*
 * スタイリスト教本 — オフラインキャッシュ + 自動更新用 Service Worker
 *
 * 方針(network-first, falling back to cache):
 *  - ネットワークに接続できるときは、常に最新の index.html を取得して表示する
 *    (取得できたレスポンスはそのままキャッシュに保存し、次回オフライン時に使う)。
 *  - ネットワークが無い/タイムアウトした場合は、直近にキャッシュした版を表示する。
 *  - これにより「Wi-Fi等に接続していれば開いた瞬間に最新内容へ自動更新され、
 *    オフラインでも直近の内容を確実に開ける」を実現する。
 *
 * このファイルは index.html と同じディレクトリに置いて公開すること(GitHub Pagesなど)。
 * index.html 側は `navigator.serviceWorker.register('./sw.js')` を試みるが、
 * このファイルが存在しないホスト(例: 単一HTMLとして配布した場合)では
 * 登録が静かに失敗するだけで、アプリ自体は変わらず動作する。
 */

const CACHE_NAME = 'stylist-textbook-cache-v1';
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', () => {
  // 新しいSWをできるだけ早くアクティブにする(待機させない)
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 旧バージョンのキャッシュ(将来キャッシュ名を変えた場合の掃除用)を削除
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 他オリジンには関与しない

  event.respondWith(networkFirst(req));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  // ネットワーク取得を試みつつ、成功したらキャッシュを更新する
  // (ブラウザのHTTPキャッシュを経由せず、常に実際のネットワークへ問い合わせる)
  const networkRequest = new Request(request, { cache: 'no-store' });
  const networkPromise = fetch(networkRequest)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS);
  });

  // 先に応答が来た方(ただしタイムアウトは「まだ分からない」扱い)を使う
  const early = await Promise.race([networkPromise, timeoutPromise]);
  if (early) return early;

  // ネットワークが遅い/オフライン → キャッシュ済みの版を返す
  const cached = await cache.match(request);
  if (cached) return cached;

  // キャッシュも無い(初回アクセスがオフライン等) → ネットワーク応答を最後まで待つ
  const late = await networkPromise;
  if (late) return late;

  return new Response(
    'オフラインです。一度ネットワークに接続した状態でアプリを開くと、次回からオフラインでも閲覧できるようになります。',
    { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
  );
}
