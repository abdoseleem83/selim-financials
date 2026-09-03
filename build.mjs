/* خطوة البناء — لازم تشغّلها قبل أي رفع
 *
 *     npm install      (مرة واحدة)
 *     npm run build
 *
 * بتعمل إيه:
 *   1. بتقرأ app.src.jsx (ده الكود اللي بتعدّل فيه)
 *   2. بتترجمه بـ Babel وتطلّع app.js الجاهز للمتصفح
 *   3. بتحدّث رقم النسخة في index.html و sw.js من APP_VERSION تلقائيًا
 *
 * قبل كده كان بابل بيترجم ~490 كيلوبايت في متصفح كل مستخدم مع كل فتحة للتطبيق.
 * دلوقتي الترجمة بتحصل هنا مرة واحدة، والمستخدم بيحمّل جافاسكريبت جاهز.
 *
 * ⚠ متعدّلش app.js بإيدك — بيتولّد تلقائيًا وأي تعديل فيه هيضيع مع أول بناء.
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { transform } from "@babel/standalone";

const SRC = "app.src.jsx";
const CALC = "src/calc.js";
const OUT = "app.js";

const ui = readFileSync(SRC, "utf8");

// src/calc.js وحدة ES عشان الاختبارات تقدر تستوردها، لكن التطبيق سكربت كلاسيكي
// في المتصفح — فبنشيل كلمة export وقت الدمج وبس. التعريفات نفسها ما بتتغيّرش.
const calc = readFileSync(CALC, "utf8").replace(/^export (function |const )/gm, "$1");

const source = calc + "\n\n" + ui;

const vMatch = ui.match(/const\s+APP_VERSION\s*=\s*"([^"]+)"/);
if (!vMatch) {
  console.error(`✗ مش لاقي APP_VERSION في ${SRC}`);
  process.exit(1);
}
const version = vMatch[1];

let code;
try {
  code = transform(source, {
    presets: [["react", { runtime: "classic" }]],
    filename: SRC,
    compact: false,
  }).code;
} catch (e) {
  console.error("✗ فشلت الترجمة:\n" + e.message);
  process.exit(1);
}

// تحقق سريع إن الناتج جافاسكريبت سليم قبل ما نكتبه
try {
  new Function(code);
} catch (e) {
  console.error("✗ الناتج مش جافاسكريبت سليم: " + e.message);
  process.exit(1);
}

// المكتبات الخارجية بتتنسخ من node_modules لمجلد vendor/ ــ التطبيق بيحمّلها
// من نفس الأصل بدل الـ CDN. المكسب: مفيش اعتماد على طرف تالت، مفيش حاجة اسمها
// "نسخة اتغيّرت من تحتينا"، والعمل أوفلاين مضمون من أول زيارة من غير ما يستنى
// وصول الـ CDN. وكمان مفيش داعي لـ SRI أصلاً — الملفات جوّه المستودع.
const VENDOR = [
  ["node_modules/react/umd/react.production.min.js", "vendor/react.production.min.js"],
  ["node_modules/react-dom/umd/react-dom.production.min.js", "vendor/react-dom.production.min.js"],
  ["node_modules/xlsx-js-style/dist/xlsx.bundle.js", "vendor/xlsx.bundle.js"],
  ["node_modules/firebase/firebase-app-compat.js", "vendor/firebase-app-compat.js"],
  ["node_modules/firebase/firebase-auth-compat.js", "vendor/firebase-auth-compat.js"],
  ["node_modules/firebase/firebase-firestore-compat.js", "vendor/firebase-firestore-compat.js"],
];

mkdirSync("vendor", { recursive: true });
for (const [from, to] of VENDOR) {
  try {
    copyFileSync(from, to);
  } catch (e) {
    console.error(`✗ مش لاقي ${from} — شغّل npm install الأول`);
    process.exit(1);
  }
}

writeFileSync(
  OUT,
  `/* مُولَّد تلقائيًا من ${CALC} + ${SRC} — متعدلش هنا. شغّل: npm run build */\n` + code
);

// رقم النسخة في مكان واحد (APP_VERSION) وبيتوزّع على باقي الملفات من هنا
const bump = (file, re, repl) => {
  const before = readFileSync(file, "utf8");
  const after = before.replace(re, repl);
  if (after !== before) writeFileSync(file, after);
  return after !== before;
};

bump("index.html", /app\.js\?v=[^"]*/, `app.js?v=${version}`);
bump("sw.js", /const VERSION = "[^"]*"/, `const VERSION = "${version}"`);

console.log(`✓ اتبنى ${OUT} (${(code.length / 1024).toFixed(0)} كيلوبايت) — نسخة ${version}`);
console.log(`  ارفع: index.html · app.js · sw.js · manifest.json · vendor/ · الأيقونات`);
