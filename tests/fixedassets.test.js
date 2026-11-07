import { test } from "node:test";
import assert from "node:assert/strict";
import { fixedAssetsMovement } from "../src/calc.js";

const r = (o) => ({ code: o.code, name: o.name, category: o.category || "asset_noncurrent", debit: o.d || 0, credit: o.c || 0, opening: o.op || 0, netDebit: o.nd || 0, netCredit: o.nc || 0, chain: [] });
test("حركة أصول ثابتة عبر شهرين مع مجمع إهلاك", () => {
  const p1 = { id: "1", year: 2026, month: 1, rows: [
    r({ code: "1500", name: "سيارات", d: 220000, op: 200000, nd: 20000 }),
    r({ code: "1590", name: "مجمع إهلاك سيارات", c: 42000, op: -40000, nc: 2000 }),
    r({ code: "6020", name: "إهلاك السيارات", category: "opex", d: 2000, nd: 2000 }),
  ] };
  const p2 = { id: "2", year: 2026, month: 2, rows: [
    r({ code: "1500", name: "سيارات", d: 200000, op: 220000, nc: 20000 }),
    r({ code: "1590", name: "مجمع إهلاك سيارات", c: 44000, op: -42000, nc: 2000 }),
    r({ code: "6020", name: "إهلاك السيارات", category: "opex", d: 2000, nd: 2000 }),
  ] };
  const m = fixedAssetsMovement([p1, p2]);
  const car = m.cost[0], acc = m.acc[0];
  assert.deepEqual([car.open, car.add, car.ded, car.close, car.diff], [200000, 20000, 20000, 200000, 0]);
  assert.deepEqual([acc.open, acc.add, acc.ded, acc.close, acc.diff], [40000, 4000, 0, 44000, 0]);
  assert.equal(m.netBook.open, 160000); assert.equal(m.netBook.close, 156000);
  assert.equal(m.depExpense, 4000); assert.equal(m.hasDiff, false);
});
test("ميزان بدون أعمدة حركة: الحركة من فرق الأرصدة", () => {
  const m = fixedAssetsMovement([
    { id: "1", year: 2026, month: 1, rows: [r({ code: "1500", name: "آلات", d: 100 })] },
    { id: "2", year: 2026, month: 2, rows: [r({ code: "1500", name: "آلات", d: 130 })] },
  ]);
  assert.equal(m.cost[0].add, 30); assert.equal(m.cost[0].close, 130);
});

test("نسبة الإهلاك وتنبيه المجمع الأكبر من التكلفة", () => {
  const m = fixedAssetsMovement([{ id: "1", year: 2026, month: 12, rows: [
    r({ code: "1500", name: "سيارات", d: 100000, op: 100000 }),
    r({ code: "1590", name: "مجمع إهلاك سيارات", c: 130000, op: -110000, nc: 20000 }),
  ] }]);
  assert.equal(m.cost[0].rate, 240); // شهر واحد فقط → تقدير سنوي مبالغ، والتنبيه تحت
  assert.equal(m.warnings.length, 1);
});
