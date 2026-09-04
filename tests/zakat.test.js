import { test } from "node:test";
import assert from "node:assert/strict";
import { computeZakatTotal, zakatPartners } from "../src/parse.js";
import { computeFigures, round2 } from "../src/calc.js";

const row = (o) => ({
  code: o.code, name: o.name, category: o.category,
  debit: o.debit || 0, credit: o.credit || 0,
  chain: o.chain || [], subtype: null, bsGroup: o.bsGroup || null,
});

// شركة بشريكين: رأس مال 300,000 (٢٠٠ + ١٠٠)، نقدية 400,000، موردون 100,000
function tb() {
  return [
    row({ code: "1101", name: "الخزينة", category: "asset_current", debit: 400000 }),
    row({ code: "2101", name: "موردون", category: "liability_current", credit: 100000 }),
    row({ code: "3101", name: "رأس مال الشريك أحمد", category: "equity", credit: 200000 }),
    row({ code: "3102", name: "رأس مال الشريك محمود", category: "equity", credit: 100000 }),
    row({ code: "3201", name: "جاري الشريك أحمد", category: "equity", credit: 50000 }),
  ];
}

const zakatData = (over = {}) => ({
  rows: tb(),
  items: [
    { group: "asset", label: "النقدية", amount: 400000 },
    { group: "liability", label: "موردون", amount: 100000 },
  ],
  hawlStart: "",
  hawlEnd: "",
  rate: 2.5,
  goldPrice: 1000,   // النصاب = 85 × 1000 = 85,000
  ...over,
});

test("zakatPartners: رأس المال فقط — جاري الشركاء مستبعد", () => {
  const f = computeFigures(tb(), 0);
  const names = zakatPartners(f).map((p) => p.name);
  assert.ok(names.includes("رأس مال الشريك أحمد"));
  assert.ok(names.includes("رأس مال الشريك محمود"));
  assert.ok(!names.some((n) => n.includes("جاري")), "جاري الشركاء مش رأس مال");
});

test("الزكاة بتتوزّع على الشركاء بنسبة رأس المال", () => {
  // الوعاء = 400,000 − 100,000 = 300,000
  // رأس المال الكلي = 300,000 → أحمد 2/3 = 200,000 · محمود 1/3 = 100,000
  // الاتنين فوق النصاب (85,000) → الزكاة = 300,000 × 2.5% = 7,500
  assert.equal(round2(computeZakatTotal(zakatData())), 7500);
});

test("الشريك اللي حصته تحت النصاب مايتزكّاش عنها", () => {
  const d = zakatData({ goldPrice: 1500 });  // النصاب = 127,500
  // أحمد 200,000 فوق النصاب → يتزكّى. محمود 100,000 تحته → لأ.
  // الزكاة = 200,000 × 2.5% = 5,000
  assert.equal(round2(computeZakatTotal(d)), 5000);
});

test("مفيش سعر ذهب = مفيش نصاب = مفيش زكاة", () => {
  assert.equal(computeZakatTotal(zakatData({ goldPrice: 0 })), 0);
  assert.equal(computeZakatTotal(zakatData({ goldPrice: undefined })), 0);
});

test("تناسب الحول: سنة ميلادية (365 يوم) بترفع النسبة الفعلية", () => {
  // الحول الهجري 354 يوم. لو الفترة 365 يوم، النسبة بتترفع بالتناسب
  // عشان تغطّي الفرق — مش بتتجمّد عند 100%.
  const d = zakatData({ hawlStart: "2025-01-01", hawlEnd: "2026-01-01" });
  const expected = 300000 * 0.025 * (365 / 354);
  assert.equal(round2(computeZakatTotal(d)), round2(expected));
  assert.ok(computeZakatTotal(d) > 7500, "أكبر من زكاة الحول الهجري");
});

test("تناسب الحول: فترة أقصر بتقلّل الزكاة", () => {
  const d = zakatData({ hawlStart: "2025-01-01", hawlEnd: "2025-07-01" });  // 181 يوم
  const expected = 300000 * 0.025 * (181 / 354);
  assert.equal(round2(computeZakatTotal(d)), round2(expected));
  assert.ok(computeZakatTotal(d) < 7500);
});

test("نسبة زكاة مخصّصة", () => {
  assert.equal(round2(computeZakatTotal(zakatData({ rate: 2.577 }))), round2(300000 * 0.02577));
});

test("وعاء سالب (الخصوم أكبر من الأصول) = مفيش زكاة", () => {
  const d = zakatData({
    items: [
      { group: "asset", label: "النقدية", amount: 100000 },
      { group: "liability", label: "موردون", amount: 400000 },
    ],
  });
  assert.equal(computeZakatTotal(d), 0, "حصة سالبة مش هتوصل النصاب");
});

test("بيانات ناقصة بترجّع صفر مش خطأ", () => {
  assert.equal(computeZakatTotal(null), 0);
  assert.equal(computeZakatTotal({}), 0);
  assert.equal(computeZakatTotal({ rows: tb() }), 0, "من غير items");
  assert.equal(computeZakatTotal({ items: [] }), 0, "من غير rows");
});

test("round2: التقريب لخانتين عشريتين", () => {
  assert.equal(round2(7499.995), 7500);
  assert.equal(round2(1234.5678), 1234.57);
  assert.equal(round2(-0.005), -0);
});
