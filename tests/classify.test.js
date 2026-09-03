import { test } from "node:test";
import assert from "node:assert/strict";
import { normAr, arMatch, guessCategory, equityBucketOf, computeFigures } from "../src/calc.js";

test("normAr: توحيد الهمزات والتاء المربوطة والتشكيل", () => {
  assert.equal(normAr("إهلاك"), normAr("اهلاك"));
  assert.equal(normAr("أرباح"), normAr("ارباح"));
  assert.equal(normAr("تكلفة"), normAr("تكلفه"));
  assert.equal(normAr("علي"), normAr("على"));
  assert.equal(normAr("مُبَاعَة"), "مباعه", "التشكيل بيتشال");
  assert.equal(normAr("خــزينة"), "خزينه", "التطويل بيتشال");
  assert.equal(normAr("  نقدية   بالخزينة "), "نقديه بالخزينه", "المسافات بتتوحّد");
});

test("arMatch: أوسع من الأصلي ومش مختلف عنه", () => {
  // كل ما كان بيطابق قبل كده لسه بيطابق
  assert.ok(arMatch(/إهلاك/, "إهلاك السيارات"));
  // والأشكال الإملائية التانية بقت تطابق كمان
  assert.ok(arMatch(/إهلاك/, "اهلاك السيارات"));
  assert.ok(arMatch(/تكلفة البضاعة/, "تكلفه البضاعه المباعه"));
  // واللي مالوش علاقة يفضل مش مطابق
  assert.ok(!arMatch(/إهلاك/, "رواتب وأجور"));
});

test("guessCategory: نفس التصنيف مهما اختلف الإملاء", () => {
  const variants = [
    [["المشتريات", "المشتريات"], "purchases"],
    [["مردودات المبيعات", "مردودات المبيعات"], "sales_returns"],
    [["تكلفة البضاعة المباعة", "تكلفه البضاعه المباعه"], "cogs"],
    [["مجمع إهلاك السيارات", "مجمع اهلاك السيارات"], "asset_noncurrent"],
    [["رأس المال", "راس المال"], "equity"],
  ];
  for (const [[a, b], expected] of variants) {
    assert.equal(guessCategory(a), expected, `«${a}» لازم تبقى ${expected}`);
    assert.equal(guessCategory(b), expected, `«${b}» لازم تبقى ${expected} برضه`);
  }
});

test("guessCategory: التخمين من طبيعة الرصيد لما مفيش قاعدة مطابقة", () => {
  assert.equal(guessCategory("حساب مش معروف", "", "", "debit"), "opex");
  assert.equal(guessCategory("حساب مش معروف", "", "", "credit"), "other_income");
  assert.equal(guessCategory("حساب مش معروف"), "asset_current");
});

test("equityBucketOf: توزيع حقوق الملكية", () => {
  assert.equal(equityBucketOf({ name: "رأس المال" }), "capital");
  assert.equal(equityBucketOf({ name: "أرباح محتجزة" }), "retained");
  assert.equal(equityBucketOf({ name: "ارباح محتجزه" }), "retained", "نفس النتيجة بإملاء مختلف");
  assert.equal(equityBucketOf({ name: "جاري الشريك أحمد" }), "partners");
  // التعديل اليدوي له الأولوية على الاسم
  assert.equal(equityBucketOf({ name: "أرباح محتجزة", bsGroup: "equity_capital" }), "capital");
});

test("equityBucketOf: الحساب التحليلي بياخد تصنيف أبوه من السلسلة", () => {
  const r = { name: "سولار سيارة", chain: [{ name: "جاري الشركاء" }] };
  assert.equal(equityBucketOf(r), "partners");
});

test("مجموعات المركز المالي بتشتغل مع الإملاء المختلف", () => {
  const row = (code, name, debit) => ({
    code, name, category: "asset_current", debit, credit: 0, chain: [], subtype: null, bsGroup: null,
  });
  const f = computeFigures([
    row("1", "الخزينه الرئيسيه", 1000),   // من غير همزات/تاء مربوطة
    row("2", "بنك مصر", 2000),
    row("3", "تأمينات لدى الغير", 500),
    row("4", "تامينات اخرى", 700),        // نفس الكلمة بإملاء تاني
  ], 0);
  assert.equal(f.balanceGroups.treasury.total, 1000);
  assert.equal(f.balanceGroups.banks.total, 2000);
  assert.equal(f.balanceGroups.deposits.total, 1200, "الشكلين لازم يقعوا في التأمين");
});
