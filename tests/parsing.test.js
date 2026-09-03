import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDigits, numericFromCell, parseAmountCell, parseSignedNum, cleanAccName } from "../src/calc.js";

test("normalizeDigits: أرقام هندية وفارسية وفواصل عربية", () => {
  assert.equal(normalizeDigits("١٢٣٤"), "1234");
  assert.equal(normalizeDigits("۱۲۳۴"), "1234");
  assert.equal(normalizeDigits("١٢٣٤٫٥٠"), "1234.50");   // الفاصلة العشرية العربية
  assert.equal(normalizeDigits("١٢٣٬٤٥٦"), "123456");     // فاصلة الآلاف العربية
  assert.equal(normalizeDigits("1 234"), "1234");    // مسافة غير قابلة للكسر
});

test("numericFromCell: الأشكال المحاسبية للسالب", () => {
  assert.equal(numericFromCell("(1,234.50)"), -1234.5, "الأقواس = سالب");
  assert.equal(numericFromCell("1,234-"), -1234, "السالب اللاحق");
  assert.equal(numericFromCell("-1,234"), -1234);
  assert.equal(numericFromCell("+1,234"), 1234);
  assert.equal(numericFromCell("(٥٠٠)"), -500, "أقواس + أرقام هندية");
  assert.equal(numericFromCell("1234.5"), 1234.5);
  assert.ok(Number.isNaN(numericFromCell("مش رقم")));
});

test("numericFromCell: الحالات دي كانت بترجّع صفر بصمت قبل الإصلاح", () => {
  // ده كان أخطر عيب في قراءة الإكسل: بند بمليون جنيه يتحوّل صفر والميزان يبان متزن
  for (const bad of ["(1,000,000.00)", "١٠٠٠", "5,000-"]) {
    assert.notEqual(numericFromCell(bad), 0, `${bad} لازم ميرجعش صفر`);
    assert.ok(!Number.isNaN(numericFromCell(bad)), `${bad} لازم يتقري`);
  }
});

test("parseAmountCell: تحديد طبيعة الرصيد", () => {
  assert.deepEqual(parseAmountCell("1000 م"), { value: 1000, nature: "debit" });
  assert.deepEqual(parseAmountCell("1000 د"), { value: 1000, nature: "credit" });
  assert.deepEqual(parseAmountCell("1000"), { value: 1000, nature: "debit" });
  assert.deepEqual(parseAmountCell("(1000)"), { value: 1000, nature: "credit" },
    "السالب بالأقواس = رصيد دائن");
  assert.deepEqual(parseAmountCell(""), { value: 0, nature: null });
  assert.deepEqual(parseAmountCell(null), { value: 0, nature: null });
  assert.deepEqual(parseAmountCell("0"), { value: 0, nature: null });
});

test("parseAmountCell: القيمة دايمًا موجبة والاتجاه في nature", () => {
  const r = parseAmountCell("-2,500.75");
  assert.equal(r.value, 2500.75);
  assert.equal(r.nature, "credit");
});

test("parseSignedNum", () => {
  assert.equal(parseSignedNum("(300)"), -300);
  assert.equal(parseSignedNum("300 م"), 300);
  assert.equal(parseSignedNum(""), 0);
  assert.equal(parseSignedNum("خالص"), 0);
});

test("cleanAccName", () => {
  assert.equal(cleanAccName("[1010]"), "1010");
  // خلايا الإكسل بتيجي بمسافات زايدة — القوس الأخير كان بيفضل تايه قبل الإصلاح
  assert.equal(cleanAccName("  [1010]  "), "1010");
  assert.equal(cleanAccName("[1010] "), "1010");
  assert.equal(cleanAccName("النقدية بالخزينة ---"), "النقدية بالخزينة");
  assert.equal(cleanAccName(null), "");
});
