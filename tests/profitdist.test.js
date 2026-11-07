import { test } from "node:test";
import assert from "node:assert/strict";
import { computeProfitDistribution } from "../src/parse.js";

const eq = (name, amount) => ({ code: "x", name, amount, chain: [] });
const rows = [eq("شركاء- محمد شبل", 500000), eq("شركاء- احمد شبل", 500000), eq("شركاء- احمد عادل", 500000), eq("شركاء- عبد الخالق عادل", 500000), eq("جاري- عبد الخالق عادل", -11695.41), eq("جاري- احمد عادل", -31407.66)];

test("تقسيم رأس مال شريك على اسمين ونسب الربح", () => {
  const d = computeProfitDistribution({ netProfit: 888172.24, equityRows: rows, splits: { "شركاء- عبد الخالق عادل": [{ name: "عبد الخالق عادل", amount: 201000 }, { name: "د/ احمد حسان", amount: 299000 }] } });
  assert.equal(d.partners.length, 5);
  const ak = d.partners.find((p) => p.name === "عبد الخالق عادل"), ah = d.partners.find((p) => p.name === "د/ احمد حسان");
  assert.ok(Math.abs(ak.pct - 0.1005) < 1e-9); assert.ok(Math.abs(ah.pct - 0.1495) < 1e-9);
  assert.equal(ak.currentBal, -11695.41); assert.equal(ah.currentBal, 0);
  assert.equal(d.totals.profitShare, 888172.24); assert.equal(d.totals.capital, 2000000);
  assert.equal(d.warnings.length, 0);
});
test("تحذير لو مجموع التقسيم مش بيساوي رأس المال", () => {
  const d = computeProfitDistribution({ netProfit: 100, equityRows: rows, splits: { "شركاء- عبد الخالق عادل": [{ name: "أ", amount: 100000 }, { name: "ب", amount: 100000 }] } });
  assert.equal(d.warnings.length, 1);
});
test("من غير تقسيم: 25% لكل شريك", () => {
  const d = computeProfitDistribution({ netProfit: 400, equityRows: rows, splits: {} });
  assert.deepEqual(d.partners.map((p) => p.profitShare), [100, 100, 100, 100]);
});

test("زكاة السنة المالية للجزء المقسوم بنسبة رأس ماله", () => {
  const d = computeProfitDistribution({
    netProfit: 1000, equityRows: rows,
    splits: { "شركاء- عبد الخالق عادل": [{ name: "عبد الخالق عادل", amount: 200000 }, { name: "د/ احمد حسان", amount: 300000 }] },
    zakatPartners: [{ name: "شركاء- عبد الخالق عادل", due: 1000 }, { name: "شركاء- محمد شبل", due: 1000 }, { name: "شركاء- احمد شبل", due: 1000 }, { name: "شركاء- احمد عادل", due: 1000 }],
  });
  assert.equal(d.partners.find((p) => p.name === "عبد الخالق عادل").zakat, 400);
  assert.equal(d.partners.find((p) => p.name === "د/ احمد حسان").zakat, 600);
  assert.equal(d.totals.zakat, 4000);
});
