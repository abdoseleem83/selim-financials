import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* قواعد React: كل الـhooks لازم تتنادى بنفس العدد والترتيب في كل رندر.
 *
 * لو فيه `return` مبكر على مستوى الكمبوننت قبل أي hook، الرندر اللي بيخرج
 * بدري بينادي hooks أقل من الرندر اللي بيكمّل — و React بيرمي الخطأ #310
 * و"التطبيق كله" بيقع على شاشة الخطأ، مش الشاشة دي بس.
 *
 * ده حصل فعلاً: useState اتحطّت تحت `if (!annual) return ...` في
 * HomeDashboard، فأول ما المستخدم فتح شركة لسه مرفعش ليها ميزان السنة
 * دي التطبيق وقع. الاختبار ده بيمنع رجوع نفس النوع من الغلط.
 *
 * الفحص ثابت (static): بيقرا الكود من غير متصفح، فبيشتغل في CI على طول.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "..", "app.src.jsx"), "utf8");

const HOOK = /\b(useState|useEffect|useMemo|useCallback|useRef|useReducer|useLayoutEffect|useImperativeHandle)\s*\(/;

/* بيرجّع كل الكمبوننتس اللي فيها hook بعد return على مستوى الكمبوننت.
   مُصدَّرة عشان نقدر نختبر إن الفحص نفسه بيكتشف الغلط فعلاً. */
export function findHookOrderViolations(src) {
  const lines = src.split("\n");
  const bad = [];

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^function\s+([A-Z][\w$]*)\s*\(/);
    if (!m) continue;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j] === "}") { end = j; break; }
    }

    // المهم مش عمق الأقواس — الـreturn المبكر دايمًا جوّه `if { ... }`.
    // المهم هو إحنا جوّه دالة متداخلة (callback) ولا لأ: `return` جوّه
    // .map(() => ...) مش بيخرج من الكمبوننت، لكن `return` جوّه if بيخرج.
    // فبنمسك ستاك للأقواس ونعلّم اللي بيفتح نطاق دالة.
    // المهم مش عمق الأقواس — الـreturn المبكر دايمًا جوّه `if { ... }`.
    // المهم هو إحنا جوّه دالة متداخلة (callback) ولا لأ: `return` جوّه
    // .map(() => ...) مش بيخرج من الكمبوننت، لكن `return` جوّه if بيخرج.
    //
    // ولازم المسح يبقى حرف بحرف مش سطر بسطر: سطر زي
    //   const f = (id) => { ...; return x; };
    // بيفتح ويقفل نطاق دالة في نفس السطر، ولو فحصنا السطر كله مرة واحدة
    // هنعتبر الـreturn ده خروج مبكر من الكمبوننت وهو مش كده.
    const stack = [];                       // true = القوس ده فتح دالة
    const inNestedFn = () => stack.some(Boolean);
    let returnAt = -1;
    let flagged = false;

    for (let k = i + 1; k < end && !flagged; k++) {
      const code = lines[k].replace(/\/\/.*$/, "");
      const isDecl = /^\s*(const|let|var)\s/.test(code);

      for (let c = 0; c < code.length; c++) {
        const ch = code[c];
        if (ch === "{") {
          const before = code.slice(0, c);
          stack.push(/=>\s*$|function\s*[\w$]*\s*\([^)]*\)\s*$/.test(before));
          continue;
        }
        if (ch === "}") { stack.pop(); continue; }
        if (inNestedFn()) continue;

        if (code.startsWith("return", c) && !/[\w$]/.test(code[c - 1] || " ") && !/[\w$]/.test(code[c + 6] || " ")) {
          if (returnAt === -1) returnAt = k;
          continue;
        }
        if (returnAt !== -1 && isDecl) {
          const rest = code.slice(c);
          const h = rest.match(/^(useState|useEffect|useMemo|useCallback|useRef|useReducer|useLayoutEffect|useImperativeHandle)\s*\(/);
          if (h && !/[\w$.]/.test(code[c - 1] || " ")) {
            bad.push({ component: m[1], line: k + 1, returnLine: returnAt + 1, code: code.trim() });
            flagged = true;
            break;
          }
        }
      }
    }
  }
  return bad;
}

test("مفيش hook بعد return مبكر في أي كمبوننت (React #310)", () => {
  const bad = findHookOrderViolations(SRC);
  const msg = bad.map((b) =>
    `${b.component}: return عند سطر ${b.returnLine}، وبعده hook عند سطر ${b.line} — ${b.code}`
  ).join("\n");
  assert.equal(bad.length, 0, "\n" + msg);
});

test("الفحص نفسه بيكتشف الغلط لما يرجع", () => {
  // نفس شكل الغلط اللي وقّع التطبيق: hook تحت return مبكر
  const broken = `
function Dash({ a }) {
  const x = useMemo(() => a, [a]);
  if (!x) {
    return (
      <div>فاضي</div>
    );
  }
  const [open, setOpen] = useState(false);
  return <div>{open}</div>;
}
`;
  const bad = findHookOrderViolations(broken);
  assert.equal(bad.length, 1, "لازم يلاقي المخالفة");
  assert.equal(bad[0].component, "Dash");

  // ونفس الكمبوننت بعد التصحيح لازم يعدّي
  const fixed = `
function Dash({ a }) {
  const [open, setOpen] = useState(false);
  const x = useMemo(() => a, [a]);
  if (!x) {
    return (
      <div>فاضي</div>
    );
  }
  return <div>{open}</div>;
}
`;
  assert.equal(findHookOrderViolations(fixed).length, 0, "المصحّح لازم يعدّي");
});
