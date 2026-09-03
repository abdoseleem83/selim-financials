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
import { readFileSync, writeFileSync } from "node:fs";
import { transform } from "@babel/standalone";

const SRC = "app.src.jsx";
const OUT = "app.js";

const source = readFileSync(SRC, "utf8");

const vMatch = source.match(/const\s+APP_VERSION\s*=\s*"([^"]+)"/);
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

writeFileSync(
  OUT,
  `/* مُولَّد تلقائيًا من ${SRC} — متعدلش هنا. شغّل: npm run build */\n` + code
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
console.log(`  ارفع: index.html · app.js · sw.js · manifest.json · الأيقونات`);
