import { test } from "node:test";
import assert from "node:assert/strict";
import { computeZakatTotal, zakatPartners } from "../src/parse.js";
import { computeFigures, round2 } from "../src/calc.js";

const row = (o) => ({
  code: o.code, name: o.name, category: o.category,
  debit: o.debit || 0, credit: o.credit || 0,
  chain: o.chain || [], subtype: o.subtype || null, bsGroup: o.bsGroup || null,
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

test("النصاب على الوعاء كله — حكم الخلطة (الافتراضي)", () => {
  // معيار AAOIFI الشرعي 35 ومجمع الفقه الإسلامي: الشركة وحدة واحدة،
  // النصاب يُقاس على وعائها كله ثم الزكاة تتوزّع على الشركاء بحصصهم.
  const d = zakatData({ goldPrice: 1500 });  // النصاب = 127,500
  // الوعاء 300,000 فوق النصاب → الزكاة على الوعاء كله
  assert.equal(round2(computeZakatTotal(d)), 7500);
});

test("خيار القياس على حصة كل شريك لمن يرى ذلك", () => {
  const d = zakatData({ goldPrice: 1500, nisabMode: "partner" });
  // أحمد 200,000 فوق النصاب يتزكّى، محمود 100,000 تحته لأ
  assert.equal(round2(computeZakatTotal(d)), 5000);
});

test("القياس على الحصة ممكن يسقط الزكاة كلها رغم إن مال الشركة فوق النصاب", () => {
  // أربع شركاء بالتساوي، وعاء 400,000 فوق نصاب 150,000 — لكن حصة كل واحد تحته
  const rows = [
    row({ code: "1101", name: "الخزينة", category: "asset_current", debit: 400000 }),
    row({ code: "3101", name: "شركاء- أ", category: "equity", credit: 100000 }),
    row({ code: "3102", name: "شركاء- ب", category: "equity", credit: 100000 }),
    row({ code: "3103", name: "شركاء- ج", category: "equity", credit: 100000 }),
    row({ code: "3104", name: "شركاء- د", category: "equity", credit: 100000 }),
  ];
  const base = { rows, items: [{ group: "asset", label: "نقدية", amount: 400000 }], rate: 2.5, goldPrice: 1764.7058823529412 };
  assert.equal(round2(computeZakatTotal({ ...base })), 10000, "الخلطة: الزكاة واجبة");
  assert.equal(round2(computeZakatTotal({ ...base, nisabMode: "partner" })), 0, "على الحصة: بتسقط تمامًا");
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

/* ===== بناء بنود الوعاء من الميزان ===== */
import { buildZakatItems } from "../src/parse.js";

const acc = (o) => ({
  code: o.code, name: o.name, category: o.category,
  debit: o.debit || 0, credit: o.credit || 0,
  chain: o.chain || [], subtype: o.subtype || null, bsGroup: o.bsGroup || null,
});

function build(rows) {
  let n = 0;
  const items = buildZakatItems(computeFigures(rows, 0), rows, () => "i" + (++n));
  return items;
}
const sumSources = (it) => round2((it.sources || []).reduce((s, x) => s + x.amount, 0));

test("قاعدة حاكمة: مبلغ كل بند = مجموع تفاصيله بالظبط", () => {
  // مستند رسمي: لو الإجمالي جاي من مصدر والتفاصيل من مصدر تاني بيناقض نفسه
  const items = build([
    acc({ code: "1101", name: "الخزينة", category: "asset_current", debit: 50000 }),
    acc({ code: "1201", name: "عميل أ", category: "asset_current", debit: 30000, subtype: "customer_debt" }),
    acc({ code: "1301", name: "المخزون", category: "asset_current", debit: 80000 }),
    acc({ code: "2101", name: "مورد س", category: "liability_current", credit: 20000, subtype: "supplier_debt" }),
    acc({ code: "3101", name: "رأس المال", category: "equity", credit: 140000 }),
  ]);
  for (const it of items) {
    if (!it.sources || !it.sources.length) continue;
    assert.equal(it.amount, sumSources(it), `البند «${it.label}» إجماليه مش مساوي تفاصيله`);
  }
});

test("اتجاه الإشارة واحد في قسم الخصوم — الخصم بيبان موجب", () => {
  const items = build([
    acc({ code: "1101", name: "الخزينة", category: "asset_current", debit: 50000 }),
    acc({ code: "2101", name: "مورد س", category: "liability_current", credit: 20000, subtype: "supplier_debt" }),
    acc({ code: "2201", name: "عميل دفع مقدم", category: "liability_current", credit: 5000, subtype: "customer_prepaid" }),
    acc({ code: "3101", name: "رأس المال", category: "equity", credit: 25000 }),
  ]);
  const sup = items.find((i) => i.label.includes("موردون"));
  const cp = items.find((i) => i.label.includes("دفعات مقدمة من العملاء"));
  assert.equal(sup.amount, 20000, "الرصيد الدائن للمورد خصم موجب");
  assert.equal(cp.amount, 5000);
  assert.ok(sup.sources.every((s) => s.amount > 0), "التفاصيل موجبة زي الإجمالي");
});

test("مفيش حساب بيتحسب في بندين — الازدواج كان بيخصم مرتين", () => {
  const rows = [
    acc({ code: "1101", name: "الخزينة", category: "asset_current", debit: 50000 }),
    acc({ code: "2101", name: "مورد س", category: "liability_current", credit: 20000, subtype: "supplier_debt" }),
    acc({ code: "2201", name: "عميل دفع مقدم", category: "liability_current", credit: 5000, subtype: "customer_prepaid" }),
    acc({ code: "2301", name: "دائنون متنوعون", category: "liability_current", credit: 3000 }),
    acc({ code: "3101", name: "رأس المال", category: "equity", credit: 22000 }),
  ];
  const items = build(rows);
  const keys = new Map();
  for (const it of items) {
    for (const s of it.sources || []) {
      const k = s.code || s.name;
      assert.ok(!keys.has(k), `الحساب «${s.name}» موجود في «${keys.get(k)}» و«${it.label}»`);
      keys.set(k, it.label);
    }
  }
  // «دائنون آخرون» لازم يشيل المتنوعون بس — مش المورد ولا دفعة العميل
  const other = items.find((i) => i.label === "دائنون آخرون");
  assert.equal(other.amount, 3000);
});

test("المصادر بتحمل كود الحساب مش الاسم بس", () => {
  const items = build([
    acc({ code: "1101", name: "الخزينة", category: "asset_current", debit: 50000 }),
    acc({ code: "3101", name: "رأس المال", category: "equity", credit: 50000 }),
  ]);
  const cash = items.find((i) => i.label.includes("النقدية"));
  assert.ok(cash.sources.length > 0);
  assert.equal(cash.sources[0].code, "1101", "الكود لازم يتحفظ مع المصدر");
});

test("حسابان بنفس الاسم في فرعين مايندمجوش", () => {
  const items = build([
    acc({ code: "1101", name: "الخزينة", category: "asset_current", debit: 30000 }),
    acc({ code: "1102", name: "الخزينة", category: "asset_current", debit: 20000 }),
    acc({ code: "3101", name: "رأس المال", category: "equity", credit: 50000 }),
  ]);
  const cash = items.find((i) => i.label.includes("النقدية"));
  assert.equal(cash.sources.length, 2, "الاتنين لازم يفضلوا منفصلين");
  assert.equal(cash.amount, 50000);
});

test("الأصول الثابتة مش داخلة في وعاء الزكاة", () => {
  const items = build([
    acc({ code: "1101", name: "الخزينة", category: "asset_current", debit: 50000 }),
    acc({ code: "1501", name: "سيارات", category: "asset_noncurrent", debit: 200000 }),
    acc({ code: "3101", name: "رأس المال", category: "equity", credit: 250000 }),
  ]);
  const all = items.flatMap((i) => (i.sources || []).map((s) => s.name));
  assert.ok(!all.includes("سيارات"), "الأصول الثابتة مش زكوية");
  const assets = items.filter((i) => i.group === "asset").reduce((s, i) => s + i.amount, 0);
  assert.equal(assets, 50000);
});

/* ===== الحساب الموحّد: الشاشة والمستند ولوحة القيادة ===== */
import { computeZakatDetail } from "../src/parse.js";

test("مجموع زكاة الشركاء = الإجمالي المعروض بالظبط", () => {
  // كان الإجمالي مجموع قيم غير مقرّبة والحصص معروضة مقرّبة، فالمستند الرسمي
  // كان بيعرض حصصًا مجموعها يخالف الإجمالي المكتوب بقرش.
  const d = computeZakatDetail(zakatData({ hawlStart: "2026-01-01", hawlEnd: "2026-12-31" }));
  const sumShown = round2(d.partners.reduce((s, p) => s + p.due, 0));
  assert.equal(sumShown, d.totalDue, "مجموع الحصص لازم يساوي الإجمالي");
  for (const p of d.partners) assert.equal(p.due, round2(p.due), "كل حصة مقرّبة لقرشين");
});

test("computeZakatTotal بيستخدم نفس الحساب — مستحيل يفترقوا", () => {
  const d = zakatData();
  assert.equal(computeZakatTotal(d), computeZakatDetail(d).totalDue);
});

test("الوعاء = الأصول − الخصوم من البنود", () => {
  const d = computeZakatDetail(zakatData());
  assert.equal(d.totalAssets, 400000);
  assert.equal(d.totalLiab, 100000);
  assert.equal(d.base, 300000);
});

test("جاري الشركاء مايتحسبش رأس مال — كان بيتخصم ويتحسب في نفس الوقت", () => {
  const rows = tb();
  // حساب مسحوبات: equityBucketOf بتشوفه «جاري شركاء» رغم إن اسمه مفيهوش «جاري»
  rows.push(row({ code: "3301", name: "مسحوبات الشريك أحمد", category: "equity", credit: 40000 }));
  const f = computeFigures(rows, 0);
  const names = zakatPartners(f).map((p) => p.name);
  assert.ok(!names.some((n) => n.includes("مسحوبات")), "المسحوبات مش رأس مال");
  assert.equal(names.length, 2, "الشريكين بس");
});

test("التعديل اليدوي (bsGroup) بيتحترم في تحديد الشركاء", () => {
  const rows = tb();
  rows.push(row({ code: "3401", name: "حساب غامض", category: "equity", credit: 60000, bsGroup: "equity_partners" }));
  const names = zakatPartners(computeFigures(rows, 0)).map((p) => p.name);
  assert.ok(!names.includes("حساب غامض"), "المستخدم علّمه جاري شركاء فيتستبعد");
});

test("الأرباح المحتجزة مش شريك", () => {
  const rows = tb();
  rows.push(row({ code: "3501", name: "أرباح محتجزة", category: "equity", credit: 90000 }));
  const names = zakatPartners(computeFigures(rows, 0)).map((p) => p.name);
  assert.ok(!names.includes("أرباح محتجزة"), "مش شخص عشان يتحسبله حصة وزكاة");
});

test("تواريخ حول مقلوبة بتحذّر وترجع للحول الهجري", () => {
  const d = computeZakatDetail(zakatData({ hawlStart: "2026-12-31", hawlEnd: "2026-01-01" }));
  assert.ok(d.hawlWarning, "لازم يحذّر");
  assert.equal(d.days, 354, "يرجع للحول الهجري");
  assert.equal(d.proration, 1);
});

test("مدة حول أطول من سنة بتحذّر بس بتتحسب", () => {
  const d = computeZakatDetail(zakatData({ hawlStart: "2024-01-01", hawlEnd: "2026-01-01" }));
  assert.ok(d.hawlWarning && d.hawlWarning.includes("أطول"), "لازم ينبّه");
  assert.ok(d.days > 400);
});

test("تناسب الحول: سنة ميلادية بترفع النسبة الفعلية لـ2.577%", () => {
  const d = computeZakatDetail(zakatData({ hawlStart: "2025-01-01", hawlEnd: "2026-01-01" }));
  assert.equal(d.days, 365);
  const effective = d.rate * d.proration;
  assert.equal(effective.toFixed(3), "2.578", "المعدل الفعلي للسنة الميلادية");
});

/* ===== القواعد الفقهية المطبَّقة ===== */

test("المصروفات المدفوعة مقدمًا لا تُزكّى، والدفعات للموردين تُزكّى", () => {
  const items = buildZakatItems(computeFigures([
    row({ code: "1101", name: "الخزينة", category: "asset_current", debit: 50000 }),
    row({ code: "1401", name: "مدينين- ايجار مقدم المخزن", category: "asset_current", debit: 13000 }),
    row({ code: "1402", name: "مدينين- تامين لدى الغير", category: "asset_current", debit: 18000 }),
    row({ code: "1403", name: "موردين- دفعة مقدمة", category: "asset_current", debit: 7000, subtype: "supplier_prepaid" }),
    row({ code: "3101", name: "رأس المال", category: "equity", credit: 88000 }),
  ], 0), [
    row({ code: "1101", name: "الخزينة", category: "asset_current", debit: 50000 }),
    row({ code: "1401", name: "مدينين- ايجار مقدم المخزن", category: "asset_current", debit: 13000 }),
    row({ code: "1402", name: "مدينين- تامين لدى الغير", category: "asset_current", debit: 18000 }),
    row({ code: "1403", name: "موردين- دفعة مقدمة", category: "asset_current", debit: 7000, subtype: "supplier_prepaid" }),
    row({ code: "3101", name: "رأس المال", category: "equity", credit: 88000 }),
  ], () => "x");

  const debtors = items.find((i) => i.label.includes("المدينون"));
  const names = (debtors.sources || []).map((s) => s.name);
  assert.ok(!names.some((n) => n.includes("ايجار مقدم")), "الإيجار المقدم منفعة تُستهلك — مش زكوي");
  assert.ok(names.some((n) => n.includes("تامين")), "التأمين المسترد ديْن — زكوي");
  assert.ok(debtors.note && debtors.note.includes("مقدمًا"), "لازم يوضّح إيه اللي اتستبعد وليه");

  const sup = items.find((i) => i.label.includes("دفعات مقدمة للموردين"));
  assert.equal(sup.amount, 7000, "الدفعة للمورد ديْن ببضاعة — زكوية");
});

test("مخصص الديون المشكوك فيها بيتخصم من ذمم العملاء", () => {
  const rows = [
    row({ code: "1201", name: "عميل أ", category: "asset_current", debit: 100000, subtype: "customer_debt" }),
    row({ code: "1299", name: "مخصص ديون مشكوك في تحصيلها", category: "asset_current", credit: 15000 }),
    row({ code: "3101", name: "رأس المال", category: "equity", credit: 85000 }),
  ];
  const items = buildZakatItems(computeFigures(rows, 0), rows, () => "x");
  const cust = items.find((i) => i.label.includes("ذمم العملاء"));
  assert.equal(cust.amount, 85000, "100,000 − 15,000 مخصص");
  assert.ok(cust.note && cust.note.includes("المرجوة"));
});

test("حول أقل من سنة بيتنبّه إنه تقدير مش استحقاق واجب", () => {
  const d = computeZakatDetail(zakatData({ hawlStart: "2026-01-01", hawlEnd: "2026-07-01" }));
  assert.ok(d.hawlWarning && d.hawlWarning.includes("تجب بتمام الحول"), "لازم يوضّح الحكم الشرعي");
});

/* ===== اقتراح الحسابات: الكود والتصنيف قبل الاسم ===== */
import { suggestZakatAccounts, zakatParentCode } from "../src/parse.js";

const CASH_RX = /نقد|بنك|صندوق|صناديق|خزين|خزائن|خزنة|خزينه|عهد|كاش|محفظ/;

test("مصروف اسمه فيه «بنك» مايتقترحش لبند النقدية", () => {
  // اتكشف من شاشة حقيقية: «مصاريف- عمولات بنكيه» كان بيتقترح لبند النقدية
  // لمجرد إن اسمه فيه «بنك» — وهو مصروف مش نقدية.
  const accounts = [
    { code: "01/1/1/3", name: "صناديق- صندوق وي كاش", category: "asset_current", amount: 8049 },
    { code: "11/3/7", name: "مصاريف- عمولات بنكيه", category: "opex", amount: 2467 },
    { code: "01/1/2/1", name: "بنوك- البنك الأهلي", category: "asset_current", amount: 500000 },
  ];
  const out = suggestZakatAccounts({ group: "asset", sources: [] }, accounts, CASH_RX);
  const names = out.map((a) => a.name);
  assert.ok(!names.some((n) => n.includes("عمولات بنكيه")), "المصروف مايتقترحش لبند أصول");
  assert.ok(names.some((n) => n.includes("وي كاش")));
  assert.ok(names.some((n) => n.includes("البنك الأهلي")));
});

test("إخوة الحساب في دليل الحسابات بيتقترحوا الأول — الكود أقوى من الاسم", () => {
  const accounts = [
    { code: "01/1/1/4", name: "صندوق فرعي", category: "asset_current", amount: 1000 },
    { code: "01/1/9/1", name: "خزينة بعيدة", category: "asset_current", amount: 2000 },
  ];
  // البند فيه حساب تحت 01/1/1 — فأخوه المفروض يتقدّم
  const item = { group: "asset", sources: [{ code: "01/1/1/3", name: "صندوق النقدي", amount: 5000 }] };
  const out = suggestZakatAccounts(item, accounts, CASH_RX);
  assert.equal(out[0].code, "01/1/1/4", "الأخ في نفس الأب أولاً");
});

test("بند خصوم مايتقترحلوش أصول", () => {
  const accounts = [
    { code: "01/1/1/3", name: "صندوق النقدي", category: "asset_current", amount: 5000 },
    { code: "21/1/1", name: "موردين- أحمد", category: "liability_current", amount: -3000 },
  ];
  const out = suggestZakatAccounts({ group: "liability", sources: [] }, accounts, /مورد|موردين|صندوق/);
  assert.deepEqual(out.map((a) => a.name), ["موردين- أحمد"]);
});

test("الحسابات المضافة خلاص مايتكررش اقتراحها", () => {
  const accounts = [{ code: "01/1/1/3", name: "صندوق النقدي", category: "asset_current", amount: 5000 }];
  const item = { group: "asset", sources: [{ code: "01/1/1/3", name: "صندوق النقدي", amount: 5000 }] };
  assert.equal(suggestZakatAccounts(item, accounts, CASH_RX).length, 0);
});

test("zakatParentCode بيشتغل مع الترقيم بالشرطة وبالتلاصق", () => {
  assert.equal(zakatParentCode("01/1/1/3"), "01/1/1");
  assert.equal(zakatParentCode("11010001"), "110100");
  assert.equal(zakatParentCode("01"), "");
  assert.equal(zakatParentCode(""), "");
});
