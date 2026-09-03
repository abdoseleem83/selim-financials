import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFigures, mergeFigures, periodFigures, yearFigures } from "../src/calc.js";

/* ميزان مراجعة مبسّط لكن كامل ومتزن، بأرقام محسوبة يدويًا.
   debit/credit = رصيد نهاية المدة (للمركز المالي)
   netDebit/netCredit = حركة الفترة (لقائمة الدخل) */
const row = (o) => ({
  code: o.code, name: o.name, category: o.category,
  debit: o.debit || 0, credit: o.credit || 0,
  netDebit: o.nd, netCredit: o.nc,
  chain: o.chain || [], subtype: o.subtype || null, bsGroup: o.bsGroup || null,
  opening: o.opening,
});

function baseTB() {
  return [
    // أصول متداولة
    row({ code: "1010", name: "النقدية بالخزينة", category: "asset_current", debit: 50000 }),
    row({ code: "1020", name: "البنك الأهلي", category: "asset_current", debit: 120000 }),
    row({ code: "1030", name: "مخزون البضاعة", category: "asset_current", debit: 80000, opening: 60000 }),
    // أصول ثابتة
    row({ code: "1500", name: "سيارات", category: "asset_noncurrent", debit: 200000 }),
    // خصوم
    row({ code: "2010", name: "موردون", category: "liability_current", credit: 70000 }),
    // حقوق ملكية
    row({ code: "3010", name: "رأس المال", category: "equity", credit: 300000 }),
    // قائمة الدخل (حركة الفترة)
    row({ code: "4010", name: "المبيعات", category: "revenue", credit: 400000, nd: 0, nc: 400000 }),
    row({ code: "4020", name: "مردودات المبيعات", category: "sales_returns", debit: 10000, nd: 10000, nc: 0 }),
    row({ code: "5010", name: "المشتريات", category: "purchases", debit: 250000, nd: 250000, nc: 0 }),
    row({ code: "6010", name: "رواتب", category: "opex", debit: 40000, nd: 40000, nc: 0 }),
    row({ code: "6020", name: "إهلاك السيارات", category: "opex", debit: 20000, nd: 20000, nc: 0 }),
  ];
}

test("قائمة الدخل: صافي المبيعات ومجمل الربح بطريقة المعادلة", () => {
  const f = computeFigures(baseTB(), 0);
  assert.equal(f.grossSales, 400000);
  assert.equal(f.salesReturns, 10000);
  assert.equal(f.netSales, 390000, "صافي المبيعات = 400,000 − 10,000");

  // مفيش حسابات تكلفة بضاعة مباعة مباشرة، فالمفروض يستخدم المعادلة
  assert.equal(f.cogsMethod, "formula");
  // مخزون أول (من opening) 60,000 + مشتريات 250,000 − مخزون آخر 80,000
  assert.equal(f.openInv, 60000);
  assert.equal(f.cogs, 230000);
  assert.equal(f.grossProfit, 160000, "390,000 − 230,000");
});

test("المصروفات: حسابات الإهلاك بتتجمّع في سطر واحد", () => {
  const f = computeFigures(baseTB(), 0);
  assert.equal(f.opex, 60000, "40,000 رواتب + 20,000 إهلاك");
  const dep = f.opexRows.find((r) => r.name === "إهلاك الأصول الثابتة");
  assert.ok(dep, "لازم يبقى فيه سطر إهلاك مجمّع");
  assert.equal(dep.amount, 20000);
  assert.ok(!f.opexRows.some((r) => r.name === "إهلاك السيارات"), "الحساب الأصلي مايتكررش");
});

test("صافي الربح وهوامش الربحية", () => {
  const f = computeFigures(baseTB(), 0);
  assert.equal(f.operatingProfit, 100000, "160,000 − 60,000");
  assert.equal(f.netProfit, 100000, "مفيش إيرادات/مصروفات أخرى ولا ضرائب");
  assert.equal(f.netMargin.toFixed(4), (100000 / 390000).toFixed(4));
  assert.equal(f.grossMargin.toFixed(4), (160000 / 390000).toFixed(4));
});

test("المركز المالي: الأصول والخصوم وحقوق الملكية", () => {
  const f = computeFigures(baseTB(), 0);
  assert.equal(f.currentAssets, 250000, "50,000 + 120,000 + 80,000");
  assert.equal(f.nonCurrentAssets, 200000);
  assert.equal(f.totalAssets, 450000);
  assert.equal(f.totalLiab, 70000);
  assert.equal(f.equityAccounts, 300000);
  assert.equal(f.totalEquity, 400000, "رأس المال 300,000 + صافي الربح 100,000");
  assert.equal(f.totalLiabEquity, 470000);
});

test("النقدية والمخزون بيتجمّعوا صح في مجموعات المركز المالي", () => {
  const f = computeFigures(baseTB(), 0);
  assert.equal(f.cash, 170000, "خزينة + بنك");
  assert.equal(f.closingInventory, 80000);
  assert.equal(f.balanceGroups.treasury.total, 50000);
  assert.equal(f.balanceGroups.banks.total, 120000);
  assert.equal(f.balanceGroups.inventory.total, 80000);
});

test("حساب برصيد دائن غير طبيعي بيتخصم مش بيتجمع", () => {
  const tb = baseTB();
  // خزينة برصيد دائن (سحب زيادة) — لازم تنقص من إجمالي النقدية
  tb.push(row({ code: "1011", name: "خزينة الفرع", category: "asset_current", credit: 5000 }));
  const f = computeFigures(tb, 0);
  assert.equal(f.cash, 165000, "170,000 − 5,000");
});

test("تكلفة البضاعة المباعة المباشرة بتتغلّب على المعادلة", () => {
  const tb = baseTB();
  tb.push(row({ code: "5100", name: "تكلفة البضاعة المباعة", category: "cogs", debit: 200000, nd: 200000, nc: 0 }));
  const f = computeFigures(tb, 0);
  assert.equal(f.cogsMethod, "direct");
  assert.equal(f.cogs, 200000);
  assert.equal(f.grossProfit, 190000, "390,000 − 200,000");
});

test("الطريقة المفروضة من إعدادات الشركة بتتغلّب على الاكتشاف التلقائي", () => {
  const tb = baseTB();
  tb.push(row({ code: "5100", name: "تكلفة البضاعة المباعة", category: "cogs", debit: 200000, nd: 200000, nc: 0 }));
  const f = computeFigures(tb, 0, "formula");
  assert.equal(f.cogsMethod, "formula", "المستخدم فرض المعادلة");
  assert.equal(f.cogs, 230000);
});

test("حسابان بنفس الاسم في فرعين مايتلغبطوش (المفتاح بقى الكود)", () => {
  // ده كان الباج: البحث بالاسم كان بيرجّع الحساب الأول، فالتجاوز اليدوي
  // (bsGroup) على حساب واحد كان بيتطبّق على التاني كمان
  const tb = baseTB();
  tb.push(row({ code: "1040", name: "عهدة", category: "asset_current", debit: 3000 }));
  tb.push(row({ code: "1041", name: "عهدة", category: "asset_current", debit: 7000, bsGroup: "banks" }));
  const f = computeFigures(tb, 0);
  assert.equal(f.balanceGroups.custody.total, 3000, "الأولى تفضل في العهد");
  assert.equal(f.balanceGroups.banks.total, 127000, "120,000 + التانية اللي المستخدم حوّلها للبنوك");
});

test("mergeFigures: التدفقات بتتجمع والأرصدة بتاخد آخر شهر", () => {
  const jan = computeFigures(baseTB(), 0);
  const febTB = baseTB();
  febTB.find((r) => r.code === "1030").debit = 90000;   // مخزون آخر المدة اتغيّر
  const feb = computeFigures(febTB, 0);

  const y = mergeFigures([jan, feb]);
  assert.equal(y.grossSales, 800000, "المبيعات بتتجمع على الشهرين");
  assert.equal(y.salesReturns, 20000);
  assert.equal(y.netSales, 780000);
  assert.equal(y.openInv, jan.openInv, "مخزون أول السنة من أول شهر");
  assert.equal(y.closingInventory, 90000, "مخزون آخر السنة من آخر شهر");
  assert.equal(y.opex, 120000);
});

test("mergeFigures: المصروفات بتتجمّع بمفتاح الكود مش الاسم", () => {
  const mk = (amt) => {
    const tb = baseTB();
    tb.push(row({ code: "6030", name: "مصروفات فرع", category: "opex", debit: amt, nd: amt, nc: 0 }));
    tb.push(row({ code: "6031", name: "مصروفات فرع", category: "opex", debit: amt, nd: amt, nc: 0 }));
    return computeFigures(tb, 0);
  };
  const y = mergeFigures([mk(1000), mk(2000)]);
  const branchRows = y.opexRows.filter((r) => r.name === "مصروفات فرع");
  assert.equal(branchRows.length, 2, "الحسابين يفضلوا منفصلين على مدار السنة");
  assert.deepEqual(branchRows.map((r) => r.amount).sort((a, b) => a - b), [3000, 3000]);
});

test("periodFigures: مخزون أول الشهر من رصيد آخر الشهر السابق", () => {
  const jan = { id: "p1", year: 2025, month: 1, rows: baseTB(), openingInventory: 0 };
  const febRows = baseTB();
  febRows.find((r) => r.code === "1030").opening = undefined;
  const feb = { id: "p2", year: 2025, month: 2, rows: febRows, openingInventory: 0 };
  const sorted = [jan, feb];

  const f = periodFigures(sorted, feb, 0);
  // مخزون فبراير الافتتاحي جاي من الحقل opening في الميزان نفسه لو موجود،
  // وهنا شيلناه، فالمفروض يجي من رصيد آخر يناير = 80,000
  assert.equal(f.openInv, 80000);
  assert.equal(f.cogs, 250000, "80,000 + 250,000 − 80,000");
});

test("yearFigures: بيجمع شهور السنة المطلوبة بس", () => {
  const mk = (y, m) => ({ id: `${y}-${m}`, year: y, month: m, rows: baseTB(), openingInventory: 0 });
  const sorted = [mk(2024, 12), mk(2025, 1), mk(2025, 2)];
  const y2025 = yearFigures(sorted, 2025, 0);
  assert.equal(y2025.grossSales, 800000, "شهرين بس من 2025");
  const y2024 = yearFigures(sorted, 2024, 0);
  assert.equal(y2024.grossSales, 400000);
});

test("سنة من غير فترات بترجّع null", () => {
  assert.equal(yearFigures([], 2025, 0), null);
});

test("تحذير خلط طرق حساب تكلفة البضاعة", () => {
  const formulaMonth = computeFigures(baseTB(), 0);

  const directTB = baseTB();
  directTB.push(row({ code: "5100", name: "تكلفة البضاعة المباعة", category: "cogs", debit: 200000, nd: 200000, nc: 0 }));
  const directMonth = computeFigures(directTB, 0);

  assert.equal(formulaMonth.cogsMethod, "formula");
  assert.equal(directMonth.cogsMethod, "direct");

  const mixed = mergeFigures([formulaMonth, directMonth]);
  assert.equal(mixed.mixedCogsMethods, true, "لازم يتحذّر من الخلط");
  assert.deepEqual(mixed.cogsMethodMonths, { direct: 1, formula: 1 });

  // سنة كل شهورها بنفس الطريقة = مفيش تحذير
  const clean = mergeFigures([formulaMonth, computeFigures(baseTB(), 0)]);
  assert.equal(clean.mixedCogsMethods, false);
  assert.equal(clean.cogsMethodMonths, null);

  // شهر واحد بس = مفيش خلط أصلاً
  assert.equal(mergeFigures([directMonth]).mixedCogsMethods, false);
});
