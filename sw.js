/* Selim Finance — Service Worker
 *
 * الهدف: التطبيق يفتح من غير إنترنت بعد أول زيارة، من غير ما يعلّق المستخدم
 * على نسخة قديمة من الكود.
 *
 * الاستراتيجية: الشبكة أولاً ثم الكاش (network-first) لملفات التطبيق نفسه.
 * يعني وانت أونلاين بتاخد آخر نسخة دايمًا، ولو مفيش نت بيفتح من الكاش.
 * ده أأمن من cache-first في تطبيق محاسبي: مستخدم شغّال على كود قديم فيه
 * خطأ حسابي اتصلّح خلاص = أرقام غلط وهو مش واخد باله.
 *
 * ملاحظة مهمة: إحنا مابنعترضش أي حاجة غير ملفات التطبيق من نفس الأصل.
 * طلبات Firestore والمصادقة والـ CDN بتعدّي للشبكة زي ما هي —
 * تخزين استجابات فايربيز في الكاش ممكن يورّي المستخدم بيانات قديمة.
 */

const VERSION = "7.34";
const CACHE = "selim-shell-" + VERSION;

const SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

// المكتبات الخارجية المثبّتة — لازم تتخزّن من أول زيارة كمان، مش من التانية.
// لو استنّينا لحد ما الـ SW يمسك الصفحة، أول زيارة بتعدّي من غيره والمستخدم
// اللي يقفل النت بعدها على طول يلاقي صفحة بيضا.
// ⚠ الروابط دي لازم تفضل مطابقة للي في index.html بالحرف.
const LIBS = [
  "https://unpkg.com/react@18.3.1/umd/react.production.min.js",
  "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js",
  "https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) =>
        Promise.all([
          c.addAll(SHELL).catch(() => {}),
          // كل مكتبة على حدة وبتسامح مع الفشل — مكتبة واحدة مش لاقية الشبكة
          // ما يصحّش توقّع تثبيت الـ SW كله
          Promise.all(LIBS.map((u) =>
            fetch(new Request(u, { mode: "no-cors", credentials: "omit" }))
              .then((res) => c.put(u, res))
              .catch(() => {})
          )),
        ])
      )
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// زر «تحديث التطبيق» في الواجهة بيبعت الرسالة دي
self.addEventListener("message", (e) => {
  if (e.data === "skip-waiting") self.skipWaiting();
});

// مكتبات خارجية مثبّتة على إصدار محدد — الرابط بنفسه ما بيتغيّرش أبدًا،
// فبنخزّنها cache-first. من غير كده التطبيق مبيقومش أوفلاين أصلاً: القشرة
// بتتحمّل بس React وفايربيز مش موجودين فالصفحة بتفضل بيضا.
// ملاحظة: دي سكربتات المكتبات بس. طلبات فايربيز نفسها (firestore.googleapis.com
// و identitytoolkit.googleapis.com) مش هنا عن قصد — دي بيانات حية ولازم تروح للشبكة.
const LIB_HOSTS = ["unpkg.com", "cdn.jsdelivr.net", "www.gstatic.com"];

function isPinnedLib(url) {
  return LIB_HOSTS.indexOf(url.hostname) !== -1 && /\.js$/.test(url.pathname);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // المكتبات الخارجية: من الكاش أولاً، ولو مش موجودة نجيبها ونخزّنها
  if (isPinnedLib(url)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        // الاستجابة هنا غالبًا opaque (cross-origin) — بنخزّنها زي ما هي؛
        // المتصفح بيقدر يعيد تشغيلها كسكربت عادي بعدين
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }))
    );
    return;
  }

  // أي حاجة تانية من أصل مختلف (فايربيز، APIs) تعدّي للشبكة زي ما هي
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || caches.match("./index.html"))
      )
  );
});
