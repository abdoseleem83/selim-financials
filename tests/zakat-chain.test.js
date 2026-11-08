import { test } from "node:test";
import assert from "node:assert/strict";
import { buildZakatItems, computeZakatDetail } from "../src/parse.js";
import { computeFigures } from "../src/calc.js";

/* بنود وعاء الزكاة بتتحدد بمكان الحساب في الشجرة (الكود/الأب) مش باسمه هو.
 * الأمثلة من ميزان حقيقي بنظام ERP (أكواد هرمية بـ "/"). */
const P = (code, name) => ({ code, name });
const row = (o) => ({
  code: o.code, name: o.name, category: o.category || "asset_current",
  debit: o.debit || 0, credit: o.credit || 0, chain: o.chain || [], subtype: o.subtype || null, bsGroup: null,
});
const CASH = [P("01/1/1", "الصندوق"), P("01/1", "اصول متداولة"), P("01", "[ الأصول ]")];
const DEBT = [P("01/1/5", "مدينين اخرين"), P("01/1", "اصول متداولة"), P("01", "[ الأصول ]")];
const CRED = [P("02/1/3", "دائنين اخرين"), P("02/1", "خصوم متداولة"), P("02", "[ الخصوم ]")];

function tb() {
  return [
    row({ code: "01/1/1/6", name: "صناديق- حساب الشركه احمد شبل", debit: 700000, chain: CASH }),
    // اسمه فيه «كاش» لكن أبوه «مدينين اخرين» → مدين مش نقدية
    row({ code: "01/1/5/6", name: "مدينين- امانات الكاش محمود شتله", debit: 33150, chain: DEBT }),
    // اسمه فيه «مدين» لكنه تحت الصندوق → نقدية
    row({ code: "01/1/1/9", name: "صناديق- عهده نقديه باليد", debit: 500, chain: CASH }),
    // «ضرائب» بصيغة الجمع لازم تتحسب ضرائب مستحقة مش دائنين آخرين
    row({ code: "02/1/3/3", name: "دائنين- ضرائب عامه وقيمه مضافه", category: "liability_current", credit: 10019.35, chain: CRED }),
    row({ code: "02/1/3/4", name: "دائنين- مصروفات مستحقه", category: "liability_current", credit: 2000, chain: CRED }),
    row({ code: "02/2/2", name: "شركاء- احمد", category: "equity", credit: 500000, chain: [P("02/2", "رأس المال (حقوق الملكية)")] }),
  ];
}
const items = () => buildZakatItems(computeFigures(tb(), 0), tb(), () => Math.random().toString(36).slice(2));
const byLabel = (label) => items().find((i) => i.label === label);

test("النقدية: بالأب (الصندوق) — «امانات الكاش» تحت «مدينين» مش نقدية", () => {
  const cash = byLabel("النقدية والخزائن");
  assert.equal(cash.amount, 700500);
  assert.ok(!cash.sources.some((s) => s.code === "01/1/5/6"));
  assert.ok(cash.sources.some((s) => s.code === "01/1/1/9"));
});

test("المدينون الآخرون: «امانات الكاش» تحت «مدينين اخرين» بتفضل مدين", () => {
  const d = byLabel("المدينون الآخرون والأمانات");
  assert.equal(d.amount, 33150);
  assert.deepEqual(d.sources.map((s) => s.code), ["01/1/5/6"]);
});

test("ضرائب بصيغة الجمع بتدخل «ضرائب مستحقة» مش «دائنون آخرون»", () => {
  assert.equal(byLabel("ضرائب مستحقة").amount, 10019.35);
  assert.equal(byLabel("دائنون آخرون").amount, 2000);
});

test("إجمالي وعاء الزكاة مايتأثرش بمكان البند (التصنيف بالأب بيغيّر التوزيع بس)", () => {
  const it = items();
  const assets = it.filter((i) => i.group === "asset").reduce((s, i) => s + i.amount, 0);
  assert.equal(Math.round(assets * 100) / 100, 733650);   // 700000 + 33150 + 500
});

/* عيار الذهب: النصاب = 85 جرام × سعر جرام العيار المختار. دار الإفتاء المصرية = عيار 21. */
test("عيار الذهب: القديم من غير اختيار = 24، والمختار 21 بيتسجّل", () => {
  const base = { rows: tb(), items: [{ group: "asset", label: "x", amount: 1000000 }], goldPrice: 6000 };
  assert.equal(computeZakatDetail(base).karat, 24);
  const z = computeZakatDetail({ ...base, goldKarat: 21 });
  assert.equal(z.karat, 21);
  assert.equal(z.nisab, 6000 * 85);
  assert.equal(computeZakatDetail({ ...base, goldKarat: 99 }).karat, 24);   // قيمة غريبة → 24
});
