import { test } from "node:test";
import assert from "node:assert/strict";
import { computePartnersReport, partnerKey } from "../src/parse.js";

const eq = (name, amount) => ({ code: "x", name, amount, chain: [] });
test("ربط جاري الشريك برأس ماله وحساب الصافي", () => {
  const r = computePartnersReport({
    netProfit: 90000,
    equityRows: [eq("رأس مال أحمد", 200000), eq("رأس مال محمد", 100000), eq("جاري أحمد", -20000), eq("جاري محمد", 5000)],
    zakatPartners: [{ name: "رأس مال أحمد", due: 3000 }, { name: "رأس مال محمد", due: 1500 }],
    adjustments: { "رأس مال محمد": 1000 },
  });
  const [a, m] = r.partners;
  assert.equal(a.profitShare, 60000); assert.equal(a.currentBal, -20000); assert.equal(a.net, 40000);
  assert.equal(a.zakat, 3000);
  assert.equal(m.profitShare, 30000); assert.equal(m.net, 36000);
  assert.equal(r.totals.net, 76000); assert.equal(r.unmatched.length, 0);
});
test("جاري غير منسوب بيتوزّع بالنسب ويتعلّم", () => {
  const r = computePartnersReport({ netProfit: 0, equityRows: [eq("رأس مال أ", 50), eq("رأس مال ب", 50), eq("جاري الشركاء", -100)], zakatTotal: 10 });
  assert.equal(r.unmatched.length, 1); assert.equal(r.partners[0].currentBal, -50); assert.equal(r.partners[0].zakat, 5);
});
test("partnerKey", () => { assert.equal(partnerKey("جاري الشريك أحمد"), partnerKey("رأس مال أحمد")); });
