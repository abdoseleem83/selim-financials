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

const VERSION = "7.37";
const CACHE = "selim-shell-" + VERSION;

const SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

// المكتبات مستضافة محليًا في vendor/ — بتتخزّن من أول زيارة زي باقي القشرة.
// قبل كده كانت من CDN، فأول زيارة كانت بتعدّي من غير تخزين والمستخدم اللي يقفل
// النت بعدها على طول كان يلاقي صفحة بيضا.
const LIBS = [
  "./vendor/react.production.min.js",
  "./vendor/react-dom.production.min.js",
  "./vendor/xlsx.bundle.js",
  "./vendor/firebase-app-compat.js",
  "./vendor/firebase-auth-compat.js",
  "./vendor/firebase-firestore-compat.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.concat(LIBS)))
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

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // ملفات التطبيق (بما فيها vendor/) بس. طلبات فايربيز الحية
  // (firestore.googleapis.com و identitytoolkit.googleapis.com) بتعدّي للشبكة
  // زي ما هي عن قصد — تخزينها معناه إن المستخدم يشوف بيانات قديمة.
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
