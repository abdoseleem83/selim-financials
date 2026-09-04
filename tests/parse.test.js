import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectFlatColumns, detectTreeColumns, buildFlatRows, buildTreeRows,
  rowsToLeaves, parentsFromLeaves, seedClassMapFrom, uid,
} from "../src/parse.js";

/* ===== اكتشاف الأعمدة ===== */

test("detectFlatColumns: الصيغة المختصرة اللي بتصدّرها برامج الحسابات", () => {
  const rows = [["account_code", "account_name", "p_d", "p_c", "m_d", "m_c", "c_d", "c_c"]];
  const m = detectFlatColumns(rows);
  assert.deepEqual(m, {
    headerRow: 0, code: 0, name: 1,
    debit: 4, credit: 5,            // m_d / m_c = حركة الفترة
    openingDebit: 2, openingCredit: 3,
    closingDebit: 6, closingCredit: 7,
  });
});

test("detectFlatColumns: العناوين العربية", () => {
  const rows = [["كود الحساب", "اسم الحساب", "مدين", "دائن"]];
  const m = detectFlatColumns(rows);
  assert.equal(m.code, 0);
  assert.equal(m.name, 1);
  assert.equal(m.debit, 2);
  assert.equal(m.credit, 3);
});

test("detectFlatColumns: بيفرّق بين الافتتاحي والحركة والنهائي", () => {
  const rows = [["كود", "اسم", "مدين أول المدة", "دائن أول المدة", "مدين", "دائن", "مدين نهاية المدة", "دائن نهاية المدة"]];
  const m = detectFlatColumns(rows);
  assert.equal(m.openingDebit, 2, "أول المدة");
  assert.equal(m.debit, 4, "حركة الفترة");
  assert.equal(m.closingDebit, 6, "نهاية المدة");
});

test("detectFlatColumns: بيدوّر على العنوان في أول 8 صفوف", () => {
  const rows = [["تقرير ميزان المراجعة"], [], ["من 1/1 إلى 31/1"], [], ["كود", "اسم", "مدين", "دائن"]];
  assert.equal(detectFlatColumns(rows).headerRow, 4);
});

test("detectFlatColumns: بترجّع null لو مفيش عنوان مفهوم", () => {
  assert.equal(detectFlatColumns([["a", "b", "c"]]), null);
});

test("detectTreeColumns: صيغة الشجرة", () => {
  const rows = [["رقم الحساب", "اسم الحساب", "رصيد بداية المدة", "صافي الحركة مدين", "صافي الحركة دائن", "رصيد نهاية المدة"]];
  const h = detectTreeColumns(rows);
  assert.equal(h.code, 0);
  assert.equal(h.name, 1);
  assert.equal(h.opening, 2);
  assert.equal(h.netDebit, 3);
  assert.equal(h.netCredit, 4);
  assert.equal(h.ending, 5);
});

/* ===== قراءة الصيغة المسطّحة ===== */

const FLAT_HEADER = ["account_code", "account_name", "p_d", "p_c", "m_d", "m_c", "c_d", "c_c"];

test("buildFlatRows: بيستبعد الحسابات التجميعية عشان الأرصدة ماتتجمعش مرتين", () => {
  const raw = [
    FLAT_HEADER,
    ["1", "الأصول", 0, 0, 0, 0, 150000, 0],           // أب
    ["11", "الأصول المتداولة", 0, 0, 0, 0, 150000, 0], // أب
    ["1101", "الخزينة", 0, 0, 0, 0, 50000, 0],         // ورقة
    ["1102", "البنك", 0, 0, 0, 0, 100000, 0],          // ورقة
  ];
  const out = buildFlatRows(raw, detectFlatColumns(raw));
  assert.deepEqual(out.map((r) => r.code), ["1101", "1102"], "الآباء لازم يتستبعدوا");
  assert.equal(out.reduce((s, r) => s + r.debit, 0), 150000);
});

test("buildFlatRows: سلسلة الآباء بتتبني من الأكواد", () => {
  const raw = [
    FLAT_HEADER,
    ["1", "الأصول", 0, 0, 0, 0, 0, 0],
    ["11", "الأصول المتداولة", 0, 0, 0, 0, 0, 0],
    ["1101", "الخزينة", 0, 0, 0, 0, 50000, 0],
  ];
  const out = buildFlatRows(raw, detectFlatColumns(raw));
  assert.equal(out.length, 1);
  assert.equal(out[0].parentName, "الأصول المتداولة", "الأب المباشر");
  assert.deepEqual(out[0].chain.map((c) => c.name), ["الأصول المتداولة", "الأصول"]);
});

test("buildFlatRows: الرصيد النهائي للمركز المالي والحركة لقائمة الدخل", () => {
  const raw = [
    FLAT_HEADER,
    ["4101", "المبيعات", 0, 0, 0, 400000, 0, 900000],
  ];
  const out = buildFlatRows(raw, detectFlatColumns(raw));
  assert.equal(out[0].credit, 900000, "الرصيد النهائي (c_c)");
  assert.equal(out[0].netCredit, 400000, "حركة الفترة (m_c)");
});

test("buildFlatRows: العملاء والموردين بيتفصلوا حسب طبيعة الرصيد", () => {
  const raw = [
    FLAT_HEADER,
    ["12", "العملاء", 0, 0, 0, 0, 0, 0],
    ["1201", "عميل أ", 0, 0, 0, 0, 30000, 0],   // مدين = مستحق علينا نحصّله
    ["1202", "عميل ب", 0, 0, 0, 0, 0, 5000],    // دائن = دفع مقدمًا
    ["13", "الموردين", 0, 0, 0, 0, 0, 0],
    ["1301", "مورد س", 0, 0, 0, 0, 0, 20000],   // دائن = مستحق عليه
  ];
  const out = buildFlatRows(raw, detectFlatColumns(raw));
  const by = Object.fromEntries(out.map((r) => [r.code, r]));
  assert.equal(by["1201"].subtype, "customer_debt");
  assert.equal(by["1201"].category, "asset_current");
  assert.equal(by["1202"].subtype, "customer_prepaid");
  assert.equal(by["1202"].category, "liability_current");
  assert.equal(by["1301"].subtype, "supplier_debt");
  assert.equal(by["1301"].category, "liability_current");
});

test("buildFlatRows: الأكواد اللي بتتقري أرقام عشرية بترجع نص نظيف", () => {
  const raw = [FLAT_HEADER, [11010001.0, "الخزينة", 0, 0, 0, 0, 50000, 0]];
  const out = buildFlatRows(raw, detectFlatColumns(raw));
  assert.equal(out[0].code, "11010001", "مش 11010001.0");
});

test("buildFlatRows: الصفوف الفاضية واللي من غير اسم بتتخطى", () => {
  const raw = [
    FLAT_HEADER,
    [],
    ["", "", "", "", "", "", "", ""],
    ["1101", "", 0, 0, 0, 0, 50000, 0],
    ["1102", "البنك", 0, 0, 0, 0, 100000, 0],
  ];
  const out = buildFlatRows(raw, detectFlatColumns(raw));
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "البنك");
});

test("buildFlatRows: الحسابات اللي كل أرصدتها صفر بتتستبعد", () => {
  const raw = [FLAT_HEADER, ["1101", "حساب مقفول", 0, 0, 0, 0, 0, 0]];
  assert.equal(buildFlatRows(raw, detectFlatColumns(raw)).length, 0);
});

/* ===== الباج اللي كان بيفسد الأرقام في الصيغة المسطّحة ===== */

test("buildFlatRows: الأرقام النصية بتتقري صح — parseFloat كان بيفسدها", () => {
  // parseFloat("1,234.50") بترجّع 1 — مش صفر. يعني رقم كبير بيتحوّل لرقم
  // صغير شكله معقول، والميزان يبان مقبول وهو غلط تمامًا. ده كان أخطر من
  // إنه يرجّع صفر لأن مفيش أي مؤشر إن فيه حاجة حصلت.
  const raw = [
    FLAT_HEADER,
    ["1101", "الخزينة", "0", "0", "0", "0", "1,234.50", "0"],
    ["1102", "البنك", "0", "0", "0", "0", "١٢٣٤", "0"],
    ["1103", "عهدة", "0", "0", "0", "0", "(500)", "0"],
  ];
  const out = buildFlatRows(raw, detectFlatColumns(raw));
  const by = Object.fromEntries(out.map((r) => [r.code, r]));
  assert.equal(by["1101"].debit, 1234.5, "فاصلة الآلاف");
  assert.equal(by["1102"].debit, 1234, "أرقام هندية");
  assert.equal(by["1103"].debit, -500, "سالب بالأقواس");
});

test("buildFlatRows: الأرقام العادية شغالة زي ما هي", () => {
  const raw = [FLAT_HEADER, ["1101", "الخزينة", 0, 0, 0, 0, 50000.75, 0]];
  assert.equal(buildFlatRows(raw, detectFlatColumns(raw))[0].debit, 50000.75);
});

/* ===== صيغة الشجرة ===== */

const TREE_HEADER = ["رقم الحساب", "اسم الحساب", "رصيد بداية المدة", "صافي الحركة مدين", "صافي الحركة دائن", "رصيد نهاية المدة"];

test("buildTreeRows: بيقرا التسلسل من الأكواد والأرصدة بطبيعتها", () => {
  const raw = [
    TREE_HEADER,
    ["1", "الأصول", "", "", "", "150000 م"],
    ["11", "الأصول المتداولة", "", "", "", "150000 م"],
    ["1101", "الخزينة", "20000 م", "30000", "0", "50000 م"],
    ["1102", "البنك", "", "100000", "0", "100000 م"],
  ];
  const parsed = buildTreeRows(raw, detectTreeColumns(raw));
  const names = parsed.leaves.map((l) => l.name);
  assert.deepEqual(names.sort(), ["البنك", "الخزينة"]);
  assert.ok(!names.includes("الأصول"), "الحسابات التجميعية مش أوراق");

  const cash = parsed.leaves.find((l) => l.name === "الخزينة");
  assert.equal(cash.closingValue, 50000);
  assert.equal(cash.nature, "debit", "«م» = مدين");
  assert.equal(cash.opening, 20000, "الرصيد الافتتاحي");
  assert.equal(cash.netDebit, 30000, "حركة الفترة");
});

test("buildTreeRows: الجذر برقم واحد مايتحسبش ورقة — كان بيتجمع مرتين", () => {
  // إكمال الصفر كان بيحوّل "1" لـ "01"، و"01" مش بادئة لـ "11" —
  // فالجذر كان بيبقى ورقة ورصيده يتجمع فوق أبنائه (300,000 بدل 150,000)
  const raw = [
    TREE_HEADER,
    ["1", "الأصول", "", "", "", "150000 م"],
    ["11", "الأصول المتداولة", "", "", "", "150000 م"],
    ["1101", "الخزينة", "", "", "", "50000 م"],
    ["1102", "البنك", "", "", "", "100000 م"],
  ];
  const parsed = buildTreeRows(raw, detectTreeColumns(raw));
  assert.equal(parsed.leaves.reduce((s, l) => s + l.closingValue, 0), 150000,
    "مجموع الأوراق لازم يساوي رصيد الجذر مرة واحدة");
});

test("buildTreeRows: إكمال الصفر لسه شغال لما يكون هو الصح فعلاً", () => {
  // هنا الجذر "1" وأبناؤه "0101" — إكمال الصفر هو اللي بيوصّلهم
  const raw = [
    TREE_HEADER,
    ["1", "الأصول", "", "", "", "150000 م"],
    ["0101", "الخزينة", "", "", "", "50000 م"],
    ["0102", "البنك", "", "", "", "100000 م"],
  ];
  const parsed = buildTreeRows(raw, detectTreeColumns(raw));
  const names = parsed.leaves.map((l) => l.name).sort();
  assert.deepEqual(names, ["البنك", "الخزينة"], "الجذر لازم يفضل أب");
  assert.equal(parsed.leaves.reduce((s, l) => s + l.closingValue, 0), 150000);
});

test("buildTreeRows: الترقيم بالشرطة المائلة (1/1/1)", () => {
  const raw = [
    TREE_HEADER,
    ["1", "الأصول", "", "", "", "150000 م"],
    ["1/1", "الأصول المتداولة", "", "", "", "150000 م"],
    ["1/1/1", "الخزينة", "", "", "", "50000 م"],
    ["1/1/2", "البنك", "", "", "", "100000 م"],
  ];
  const parsed = buildTreeRows(raw, detectTreeColumns(raw));
  assert.deepEqual(parsed.leaves.map((l) => l.name).sort(), ["البنك", "الخزينة"]);
  assert.equal(parsed.leaves.reduce((s, l) => s + l.closingValue, 0), 150000);
});

/* ===== أدوات مساعدة ===== */

test("rowsToLeaves ثم parentsFromLeaves بيرجّعوا الآباء", () => {
  const rows = [
    { code: "1101", name: "الخزينة", debit: 50000, credit: 0, category: "asset_current",
      chain: [{ code: "11", name: "الأصول المتداولة" }, { code: "1", name: "الأصول" }] },
  ];
  const leaves = rowsToLeaves(rows);
  assert.equal(leaves.length, 1);
  assert.equal(leaves[0].closingValue, 50000);
  assert.equal(leaves[0].nature, "debit");

  const { parents, nameByCode } = parentsFromLeaves(leaves);
  const byCode = Object.fromEntries(parents.map((p) => [p.code, p]));
  assert.ok(byCode["11"], "الأب المباشر");
  assert.ok(byCode["1"], "الجد");
  assert.equal(byCode["11"].debitSum, 50000, "أرصدة الأوراق بتتجمّع على الأب");
  assert.equal(byCode["1101"].isLeafItem, true, "الورقة نفسها متعلّمة");
  assert.equal(nameByCode["11"], "الأصول المتداولة");
});

test("seedClassMapFrom: بيقرا التصنيف المحفوظ بالكود قبل الاسم", () => {
  const parsed = { parents: [{ code: "11", name: "الأصول المتداولة" }] };
  const saved = { "code:11": "asset_current", "name:الأصول المتداولة": "liability_current" };
  const map = seedClassMapFrom(parsed, saved, false);
  assert.equal(map["11"], "asset_current", "الكود له الأولوية على الاسم");
});

test("uid: معرّف فريد وطويل بما يكفي", () => {
  const a = uid(), b = uid();
  assert.notEqual(a, b);
  assert.ok(a.length >= 16, "قصير أوي = خطر تصادم");
  const many = new Set(Array.from({ length: 5000 }, () => uid()));
  assert.equal(many.size, 5000, "مفيش تكرار في 5000 معرّف");
});
