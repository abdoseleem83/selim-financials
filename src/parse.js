/* قراءة ملفات الإكسل وحساب الزكاة — كود خالص من غير React ولا DOM.
 *
 * ده المكان اللي البيانات بتدخل منه للتطبيق: أي غلط هنا معناه أرقام غلط في
 * كل القوائم بعد كده، من غير أي مؤشر إن فيه حاجة حصلت.
 * الاختبارات في tests/parse.test.js و tests/zakat.test.js.
 */
import { cleanAccName, parseAmountCell, parseSignedNum, numericFromCell, guessCategory, computeFigures } from "./calc.js";

// معرّفات المستندات في Firestore: Math.random بـ8 محارف مش مضمونة التفرّد،
// وتصادم واحد معناه فترة بتكتب فوق فترة تانية. crypto.randomUUID أقوى بكتير،
// والبديل بيستخدم getRandomValues (مدعوم في كل المتصفحات اللي بيشتغل عليها التطبيق).
export const uid = () => {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      const b = crypto.getRandomValues(new Uint8Array(16));
      return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    }
  } catch (e) {}
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
};

export function detectFlatColumns(rows) {
  const isOpening = (c) => /افتتاح|أول المدة|اول المدة|بداية/.test(c);
  const isClosing = (c) => /نهائي|نهاية|آخر المدة|اخر المدة|ختامي/.test(c);
  for (let r = 0; r < Math.min(rows.length, 8); r++) {
    const row = rows[r].map((c) => String(c ?? "").trim());
    let code = -1, name = -1, debit = -1, credit = -1;
    let openingDebit = -1, openingCredit = -1, closingDebit = -1, closingCredit = -1;
    // صيغة مختصرة/إنجليزية شائعة في تصدير برامج الحسابات:
    // p_d/p_c = رصيد افتتاحي، m_d/m_c = حركة الفترة، c_d/c_c = رصيد نهائي
    row.forEach((cell, i) => {
      const k = cell.toLowerCase();
      if (/^account_?code$/.test(k) || /^acc_?code$/.test(k)) code = i;
      if (/^account_?name$/.test(k) || /^acc_?name$/.test(k)) name = i;
      if (k === "p_d") openingDebit = i;
      if (k === "p_c") openingCredit = i;
      if (k === "m_d") debit = i;
      if (k === "m_c") credit = i;
      if (k === "c_d") closingDebit = i;
      if (k === "c_c") closingCredit = i;
    });
    if (name !== -1 && (debit !== -1 || closingDebit !== -1)) {
      return { headerRow: r, code, name, debit, credit, openingDebit, openingCredit, closingDebit, closingCredit };
    }
    row.forEach((cell, i) => {
      if (code === -1 && /كود|رقم/.test(cell)) code = i;
      if (name === -1 && /اسم|بيان/.test(cell)) name = i;
      const hasDebit = /مدين/.test(cell), hasCredit = /دائن/.test(cell);
      if (hasDebit && isOpening(cell)) { if (openingDebit === -1) openingDebit = i; return; }
      if (hasCredit && isOpening(cell)) { if (openingCredit === -1) openingCredit = i; return; }
      if (hasDebit && isClosing(cell)) { if (closingDebit === -1) closingDebit = i; return; }
      if (hasCredit && isClosing(cell)) { if (closingCredit === -1) closingCredit = i; return; }
      // حركة الفترة: عمود مدين/دائن عادي (مش افتتاحي ولا نهائي)
      if (debit === -1 && hasDebit) debit = i;
      if (credit === -1 && hasCredit) credit = i;
    });
    if (name !== -1 && (debit !== -1 || credit !== -1 || closingDebit !== -1 || closingCredit !== -1)) {
      return { headerRow: r, code, name, debit, credit, openingDebit, openingCredit, closingDebit, closingCredit };
    }
  }
  return null;
}

export function detectTreeColumns(rows) {
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const row = rows[r].map((c) => String(c ?? ""));
    let code = -1, name = -1, ending = -1, opening = -1, netDebit = -1, netCredit = -1;
    row.forEach((cell, i) => {
      if (name === -1 && /اسم الحساب/.test(cell)) name = i;
      if (code === -1 && /رقم الحساب/.test(cell)) code = i;
      if (ending === -1 && /رصيد نهاية/.test(cell)) ending = i;
      if (opening === -1 && /رصيد بداية/.test(cell)) opening = i;
      if (netDebit === -1 && /صافي الحركة/.test(cell) && /مدين/.test(cell)) netDebit = i;
      if (netCredit === -1 && /صافي الحركة/.test(cell) && /دائن/.test(cell)) netCredit = i;
    });
    if (name !== -1 && ending !== -1) return { headerRow: r, code, name, ending, opening, netDebit, netCredit };
  }
  return null;
}

export function buildTreeRows(rawRows, h) {
  // اقرأ كل الصفوف مع الكود والاسم والأرصدة (افتتاحي/حركة/نهائي)
  const all = [];
  for (let r = h.headerRow + 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!row) continue;
    const nameRaw = h.name >= 0 ? row[h.name] : "";
    if (nameRaw === undefined || nameRaw === "") continue;
    let code = String((h.code >= 0 ? row[h.code] : "") ?? "").trim();
    if (!code || code === "nan") continue;
    const name = cleanAccName(nameRaw);
    const closing = parseAmountCell(row[h.ending]);
    const opening = h.opening >= 0 ? parseAmountCell(row[h.opening]) : { value: 0, nature: null };
    let netDebit = 0, netCredit = 0;
    if (h.netDebit >= 0) netDebit = parseSignedNum(row[h.netDebit]);
    if (h.netCredit >= 0) netCredit = parseSignedNum(row[h.netCredit]);
    all.push({
      code, name,
      closingValue: closing.value, closingNature: closing.nature,
      openingValue: opening.value, openingNature: opening.nature,
      netDebit, netCredit,
    });
  }

  // بعض الملفات بتكتب الجذر برقم واحد ("1") والأبناء بصيغة من رقمين ("0101")،
  // فبنكمّل صفر عشان العلاقة تبان. بس في ملفات تانية الجذر "1" وأبناؤه "11" و"1101" —
  // وهناك إكمال الصفر بيكسر العلاقة: "01" مش بادئة لـ "11"، فالحساب التجميعي
  // بيتحسب ورقة ورصيده بيتجمع مرتين مع أبنائه.
  // فبنكمّل الصفر بس لما يكون هو اللي بيوصّل الحساب بأبنائه فعلاً.
  const rawCodes = new Set(all.map((a) => a.code));
  const hasChildren = (c) => {
    for (const o of rawCodes) if (o !== c && o.length > c.length && o.startsWith(c)) return true;
    return false;
  };
  all.forEach((a) => {
    if (/^\d$/.test(a.code) && !hasChildren(a.code) && hasChildren("0" + a.code)) {
      a.code = "0" + a.code;
    }
  });

  const nameByCode = {};
  all.forEach((a) => { nameByCode[a.code] = a.name; });
  const codeSet = new Set(all.map((a) => a.code));
  // بعض الشركات بتستخدم ترقيم بـ"/" (1/1/1) وبعضها بيستخدم ترقيم متلاصق بالبادئة الرقمية
  // (1 ثم 11 ثم 1101 ثم 11010001، من غير أي فاصل) — نكتشف صيغة الملف تلقائيًا ونتعامل مع الاثنين
  const usesSlash = all.some((a) => a.code.includes("/"));
  const isLeaf = usesSlash
    ? (code) => !all.some((a) => a.code !== code && a.code.startsWith(code + "/"))
    : (code) => !all.some((a) => a.code !== code && a.code.length > code.length && a.code.startsWith(code));
  const parentChain = usesSlash
    ? (code) => {
        const parts = code.split("/");
        const chain = [];
        for (let i = parts.length - 1; i >= 1; i--) {
          const anc = parts.slice(0, i).join("/");
          if (nameByCode[anc]) chain.push({ code: anc, name: nameByCode[anc] });
        }
        return chain; // من الأقرب للأبعد
      }
    : (code) => {
        const chain = [];
        for (let len = code.length - 1; len > 0; len--) {
          const anc = code.slice(0, len);
          if (anc !== code && codeSet.has(anc) && nameByCode[anc]) chain.push({ code: anc, name: nameByCode[anc] });
        }
        return chain; // من الأقرب للأبعد
      };
  // المستوى الحقيقي = طول سلسلة الآباء الموجودين فعليًا في الملف (مش عدد خانات الكود) —
  // كده شغالة صح مع الصيغتين حتى لو في قفزات في عدد الخانات بين مستوى وتاني
  const depthOf = (code) => parentChain(code).length + 1;

  // الأوراق فقط (التفاصيل النهائية) هي اللي فيها الأرقام الحقيقية — تفادي الازدواج
  const leaves = [];
  all.forEach((a) => {
    if (!isLeaf(a.code)) return;
    if (!a.closingValue && !a.netDebit && !a.netCredit && !a.openingValue) return;
    const chain = parentChain(a.code);
    // نوع الرصيد النهائي: من suffix (م/د) أو من الحركة
    let nature = a.closingNature;
    if (!nature) {
      const netMove = a.netDebit - a.netCredit;
      const openSigned = a.openingNature === "credit" ? -a.openingValue : a.openingValue;
      nature = (openSigned + netMove) >= 0 ? "debit" : "credit";
    }
    leaves.push({
      code: a.code, name: a.name, chain,
      // الحساب الأب المباشر اللي المستخدم هيصنّفه (level chosen elsewhere)
      closingValue: a.closingValue, nature,
      opening: a.openingNature === "credit" ? -a.openingValue : a.openingValue,
      netDebit: a.netDebit, netCredit: a.netCredit,
    });
  });

  // قائمة الحسابات "الأب" القابلة للتصنيف (كل المستويات ماعدا الأوراق)، مع رصيدها المجمّع من الأوراق
  const parentCodes = [...new Set(all.map((a) => a.code).filter((c) => !isLeaf(c)))];
  const parents = parentCodes.map((code) => {
    const kids = leaves.filter((l) => l.chain.some((a) => a.code === code));
    const debitSum = kids.filter((k) => k.nature === "debit").reduce((s, k) => s + k.closingValue, 0);
    const creditSum = kids.filter((k) => k.nature === "credit").reduce((s, k) => s + k.closingValue, 0);
    return {
      code, name: nameByCode[code], depth: depthOf(code),
      leafCount: kids.length, debitSum, creditSum,
      chain: parentChain(code),
    };
  }).filter((p) => p.leafCount > 0);
  // الحسابات التفصيلية النهائية (الأوراق) نفسها كمان بتظهر كعناصر قابلة للتصنيف في أعمق مستوى بتاعها —
  // عشان تقدر تصنّف حساب معيّن بنفسه مباشرة (استثناء عن تصنيف أبوه العام) لو محتاج تحكم أدق
  const leafItems = leaves.map((l) => ({
    code: l.code, name: l.name, depth: l.chain.length + 1,
    leafCount: 1, debitSum: l.nature === "debit" ? l.closingValue : 0, creditSum: l.nature === "credit" ? l.closingValue : 0,
    chain: l.chain, isLeafItem: true,
  }));
  const allClassifiable = [...parents, ...leafItems];

  return { leaves, parents: allClassifiable, nameByCode };
}

// حوّل الأوراق + تصنيفات الآباء إلى صفوف القوائم النهائية (تجميع أرصدة الأوراق تحت كل أب)
export function leavesToRows(parsed, classMap, savedMap) {
  // classMap: { code(parent) -> category }.  كل ورقة تاخد تصنيف أقرب أب مصنّف.
  const rows = [];
  parsed.leaves.forEach((leaf) => {
    // لو الحساب نفسه اتصنّف مباشرة (استثناء عن تصنيف أبوه) — ده أعلى أولوية، وبيتخطى
    // حتى فحص عملاء/موردين التلقائي، لأنه اختيار صريح من المستخدم لحساب بعينه
    let directOverride = !!classMap[leaf.code];
    // دور على أقرب أب في السلسلة له تصنيف
    let category = classMap[leaf.code] || null, parentName = leaf.name, manuallyClassified = directOverride;
    if (!category) {
      for (const anc of leaf.chain) {
        if (classMap[anc.code]) { category = classMap[anc.code]; parentName = anc.name; manuallyClassified = true; break; }
      }
    }
    if (!category) category = guessCategory(leaf.name, leaf.code, leaf.chain.map((c) => c.name).join(" "), leaf.nature);

    // تصحيحات دقيقة حسب اسم الورقة أو مسارها — بس للحسابات اللي ملهاش تصنيف يدوي (تخمين تلقائي فقط)؛
    // لو المستخدم صنّف أب (أي مستوى من 1 لـ5) بنفسه، تصنيفه هو اللي يتحسب ومايتلغيش بتخمين تلقائي
    const path = `${leaf.name} ${leaf.chain.map((c) => c.name).join(" ")}`;
    let cat = category;
    if (!manuallyClassified) {
      // حسابات لا تدخل القوائم: التحويلات بين المخازن، والتغيير في المخزون (قيود تسوية)
      if (/تحويلات داخلة|تحويلات خارجة|تحويل بين المخازن|التحويلات بين المخازن/.test(path)) cat = "ignore";
      else if (/التغيير في المخزون|المخزون الحالي \(متاجرة\)|مخزون اول المدة/.test(path)) cat = "ignore";
      // بنود قائمة الدخل التفصيلية لازم تتفصل عن بعضها
      else if (/مردود|مرتجع/.test(path) && /مبيعات|مبيع/.test(path)) cat = "sales_returns";
      else if (/خصم.*مسموح|خصم مسموح|خصومات مسموح/.test(path)) cat = "sales_discounts";
      else if (/مردود|مرتجع/.test(path) && /مشتريات|مشتري/.test(path)) cat = "purchase_returns";
      else if (/المبيعات|مبيعات/.test(path) && !/مردود|مرتجع|تكلفة|مقابل/.test(path) && (category === "revenue" || /ايرادات متاجرة|إيرادات متاجرة/.test(path))) cat = "revenue";
      else if (/مشتريات|بضاعة مشتراة/.test(path) && !/مردود|مرتجع/.test(path)) cat = "purchases";
      else if (/خصم مكتسب/.test(path)) cat = "other_income";
    }

    // فصل العملاء/الموردين حسب طبيعة الرصيد (له الأولوية على أي تصنيف) — بس نعتمد على
    // موقع الحساب في الشجرة (هل أبوه المباشر هو فعلاً مجموعة "العملاء"/"الموردين")
    // مش على مجرد وجود الكلمة في الاسم في أي مكان — عشان حساب زي "فروق قروش العملاء"
    // (أبوه المباشر "إيرادات متنوعة" مثلاً) مايتحسبش ذمة عميل غلط
    const directParentName = leaf.chain.length ? leaf.chain[0].name : "";
    const isCustomer = !directOverride && /عملاء|عميل/.test(directParentName);
    const isSupplier = !directOverride && /موردين|مورد/.test(directParentName);
    if (isCustomer) cat = leaf.nature === "debit" ? "asset_current" : "liability_current";
    else if (isSupplier) cat = leaf.nature === "credit" ? "liability_current" : "asset_current";

    // رصيد نهاية المدة (للمركز المالي)
    let debit = 0, credit = 0;
    if (leaf.nature === "debit") debit = leaf.closingValue; else credit = leaf.closingValue;
    // صافي حركة الشهر (لقائمة الدخل) — الفرق بين حركة مدين وحركة دائن
    const netDebit = leaf.netDebit || 0;
    const netCredit = leaf.netCredit || 0;
    let subtype = null;
    if (isCustomer) subtype = leaf.nature === "debit" ? "customer_debt" : "customer_prepaid";
    else if (isSupplier) subtype = leaf.nature === "credit" ? "supplier_debt" : "supplier_prepaid";
    // تجاوز محفوظ من تعديل المستخدم السابق
    let bsGroup = null;
    if (savedMap) {
      const og = savedMap[`bsgroup:${leaf.name}`];
      if (og) {
        bsGroup = og === "ignore" ? null : og;
        const gc = { cash: "asset_current", debtors: "asset_current", inventory: "asset_current", noncurrent: "asset_noncurrent", creditors: "liability_current", equity: "equity", ignore: "ignore" }[og];
        if (gc) cat = gc;
        // لو الحساب عميل/مورد بطبيعته، يفضل محتفظ بتصنيفه الفرعي مهما كانت المجموعة اللي اتنقل لها
        // يدويًا — غير كده بيختفي من إجمالي «ذمم العملاء المدينة»/«موردون» في كل رفع جديد كل شهر
        if (!(isCustomer || isSupplier)) subtype = null;
      }
    }
    rows.push({ id: uid(), code: leaf.code, name: leaf.name, debit, credit, category: cat,
      netDebit, netCredit, isCustomer, isSupplier, subtype, bsGroup, opening: leaf.opening || 0, parentName, chain: leaf.chain });
  });
  return rows;
}

export function buildFlatRows(rawRows, mapping) {
  // اقرأ كل الصفوف الأول عشان نعرف مين حساب أب ومين حساب فرعي (ورقة)
  const raw = [];
  for (let r = mapping.headerRow + 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!row || row.every((c) => c === undefined || c === "")) continue;
    const name = mapping.name >= 0 ? row[mapping.name] : "";
    if (!name) continue;
    let codeCell = mapping.code >= 0 ? row[mapping.code] : "";
    // الأكواد بتتقري أحيانًا كأرقام عشرية (11010001.0) — نرجّعها نص نظيف
    if (typeof codeCell === "number") codeCell = String(Math.round(codeCell));
    raw.push({ row, name: String(name).trim(), code: String(codeCell ?? "").trim() });
  }
  // الحساب يُعد "أب" لو فيه حساب تاني كوده يبدأ بنفس كوده وأطول منه —
  // ولازم نستبعد الآباء عشان أرصدتهم مكرّرة في أبنائهم (وإلا الميزان يتجمع مرتين ويختل)
  const codes = raw.map((x) => x.code).filter(Boolean);
  const codeSet = new Set(codes);
  const isParent = (c) => !!c && codes.some((o) => o !== c && o.startsWith(c) && o.length > c.length);
  // سلسلة الأجداد كاملة (من الأقرب للأبعد) — كل كود فعليًا موجود كصف مستقل في الملف
  const codeToName = {};
  raw.forEach((x) => { if (!codeToName[x.code]) codeToName[x.code] = x.name; });
  const chainOf = (c) => {
    const chain = [];
    if (!c) return chain;
    for (let len = c.length - 1; len > 0; len--) {
      const anc = c.slice(0, len);
      if (codeSet.has(anc) && codeToName[anc]) chain.push({ code: anc, name: codeToName[anc] });
    }
    return chain;
  };
  const parentNameOf = (c) => {
    const chain = chainOf(c);
    return chain.length ? chain[0].name : null;
  };
  const hasCodes = codes.length > 0;
  // القرار ده على مستوى الملف كله مش سطر بسطر — لو الملف فيه أعمدة رصيد نهائي،
  // نستخدمها لكل الحسابات حتى اللي رصيدها صفر، وإلا الميزان بيختل
  const useClosing = mapping.closingDebit >= 0 || mapping.closingCredit >= 0;
  const out = [];
  raw.forEach(({ row, name: nm, code }) => {
    if (hasCodes && isParent(code)) return; // حساب تجميعي — أرصدته موجودة في أبنائه
    // لازم numericFromCell مش parseFloat: خلايا الإكسل بتيجي نصوص كتير،
    // و parseFloat("1,234.50") بترجّع 1 (بيقف عند الفاصلة) — يعني رقم كبير بيتحوّل
    // لرقم صغير شكله معقول والميزان يبان مقبول وهو غلط تمامًا.
    // و parseFloat("(500)") و parseFloat("١٢٣٤") بيرجّعوا NaN → صفر.
    // وضع الشجرة كان متعالج خلاص عبر parseAmountCell؛ ده كان الفرع الناقص.
    const num = (idx) => {
      if (idx < 0) return 0;
      const v = numericFromCell(row[idx]);
      return isNaN(v) ? 0 : v;
    };
    const movDebit = num(mapping.debit);
    const movCredit = num(mapping.credit);
    const openDebit = num(mapping.openingDebit);
    const openCredit = num(mapping.openingCredit);
    const closeDebit = num(mapping.closingDebit);
    const closeCredit = num(mapping.closingCredit);
    // لو الملف فيه أعمدة رصيد نهائي منفصلة: الرصيد النهائي هو اللي يظهر في المركز المالي،
    // وحركة الفترة تفضل منفصلة لقائمة الدخل — زي ما بيحصل بالظبط في وضع الشجرة
    const debit = useClosing ? closeDebit : movDebit;
    const credit = useClosing ? closeCredit : movCredit;
    if (debit === 0 && credit === 0 && movDebit === 0 && movCredit === 0 && openDebit === 0 && openCredit === 0) return;
    const chain = chainOf(code);
    const pName = chain.length ? chain[0].name : null;
    const nature = debit >= credit ? "debit" : "credit";
    let cat = guessCategory(nm, code, "", nature) || (pName ? guessCategory(pName, code, "", nature) : null);
    // نفس منطق فصل العملاء/الموردين المستخدم في وضع الشجرة — بس بالاعتماد على اسم الأب
    // المباشر فقط (مش اسم الحساب نفسه ولا أي أب بعيد)، عشان حساب زي "فروق قروش العملاء"
    // (أبوه المباشر مش "العملاء") ما يتحسبش ذمة عميل غلط
    const isCustomer = pName ? /عملاء|عميل/.test(pName) : false;
    const isSupplier = pName ? /موردين|مورد/.test(pName) : false;
    if (isCustomer) cat = nature === "debit" ? "asset_current" : "liability_current";
    else if (isSupplier) cat = nature === "credit" ? "liability_current" : "asset_current";
    let subtype = null;
    if (isCustomer) subtype = nature === "debit" ? "customer_debt" : "customer_prepaid";
    else if (isSupplier) subtype = nature === "credit" ? "supplier_debt" : "supplier_prepaid";
    out.push({ id: uid(), code, name: nm, debit, credit, category: cat,
      isCustomer, isSupplier, subtype,
      netDebit: movDebit, netCredit: movCredit,
      opening: openDebit - openCredit,
      parentName: pName || nm, chain });
  });
  return out;
}

// حوّل صفوف محفوظة (leaf rows فيها chain) لشكل "leaf" اللي بتفهمه leavesToRows
export function rowsToLeaves(rows) {
  return (rows || []).map((r) => {
    const nature = r.debit ? "debit" : (r.credit ? "credit" : (r.nature || "debit"));
    return {
      code: r.code, name: r.name, chain: r.chain || [],
      closingValue: r.debit || r.credit || 0, nature,
      opening: r.opening || 0, netDebit: r.netDebit || 0, netCredit: r.netCredit || 0,
    };
  });
}

// ابنِ قائمة الحسابات "الأب" (كل المستويات) من سلاسل chain المخزّنة على كل ورقة —
// بتشتغل بغض النظر عن مصدر الأوراق (شجري أو مسطّح) طول ما كل ورقة فيها chain
export function parentsFromLeaves(leaves) {
  const nameByCode = {};
  leaves.forEach((l) => (l.chain || []).forEach((a) => { if (!nameByCode[a.code]) nameByCode[a.code] = a.name; }));
  const parentCodesSet = new Set();
  leaves.forEach((l) => (l.chain || []).forEach((a) => parentCodesSet.add(a.code)));
  const parents = [...parentCodesSet].map((code) => {
    const kids = leaves.filter((l) => (l.chain || []).some((a) => a.code === code));
    const debitSum = kids.filter((k) => k.nature === "debit").reduce((s, k) => s + k.closingValue, 0);
    const creditSum = kids.filter((k) => k.nature === "credit").reduce((s, k) => s + k.closingValue, 0);
    // العمق: بنحسبه من موضع الكود جوه سلسلة أول ورقة لاقيناها تحته — الجذر = 1، وكل ما قربنا من الورقة زاد
    let depth = 1, chain = [];
    for (const l of leaves) {
      const idx = (l.chain || []).findIndex((a) => a.code === code);
      if (idx >= 0) { depth = l.chain.length - idx; chain = l.chain.slice(idx + 1); break; }
    }
    return { code, name: nameByCode[code], depth, leafCount: kids.length, debitSum, creditSum, chain };
  }).filter((p) => p.leafCount > 0);
  // الحسابات التفصيلية النهائية (الأوراق) نفسها كمان بتظهر كعناصر قابلة للتصنيف في أعمق مستوى بتاعها —
  // عشان تقدر تصنّف حساب معيّن بنفسه مباشرة (زي استثناء عن تصنيف أبوه العام) لو محتاج تحكم أدق
  const leafItems = leaves.map((l) => ({
    code: l.code, name: l.name, depth: (l.chain ? l.chain.length : 0) + 1,
    leafCount: 1, debitSum: l.nature === "debit" ? l.closingValue : 0, creditSum: l.nature === "credit" ? l.closingValue : 0,
    chain: l.chain || [], isLeafItem: true,
  }));
  return { parents: [...parents, ...leafItems], nameByCode };
}

// نسخة من buildFlatRows بترجّع بنية زي الشجري بالظبط (leaves + parents) لو الملف المسطّح فيه أكواد
// هرمية حقيقية (حسابات "أب" لها صفوف مستقلة في الملف) — عشان تصنيف الآباء ينتشر تلقائيًا لأبنائهم
// بدل ما المستخدم يصنّف كل حساب تفصيلي لوحده
export function buildFlatParsed(rawRows, mapping) {
  const raw = [];
  for (let r = mapping.headerRow + 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!row || row.every((c) => c === undefined || c === "")) continue;
    const name = mapping.name >= 0 ? row[mapping.name] : "";
    if (!name) continue;
    let codeCell = mapping.code >= 0 ? row[mapping.code] : "";
    if (typeof codeCell === "number") codeCell = String(Math.round(codeCell));
    raw.push({ row, name: String(name).trim(), code: String(codeCell ?? "").trim() });
  }
  const codes = raw.map((x) => x.code).filter(Boolean);
  if (!codes.length) return null;
  const codeSet = new Set(codes);
  const isParentCode = (c) => !!c && codes.some((o) => o !== c && o.startsWith(c) && o.length > c.length);
  const codeToName = {};
  raw.forEach((x) => { if (!codeToName[x.code]) codeToName[x.code] = x.name; });
  const chainOf = (c) => {
    const chain = [];
    if (!c) return chain;
    for (let len = c.length - 1; len > 0; len--) {
      const anc = c.slice(0, len);
      if (codeSet.has(anc) && codeToName[anc]) chain.push({ code: anc, name: codeToName[anc] });
    }
    return chain;
  };
  const useClosing = mapping.closingDebit >= 0 || mapping.closingCredit >= 0;
  const leaves = [];
  raw.forEach(({ row, name: nm, code }) => {
    if (isParentCode(code)) return;
    const num = (idx) => (idx >= 0 ? (parseFloat(row[idx]) || 0) : 0);
    const movDebit = num(mapping.debit);
    const movCredit = num(mapping.credit);
    const openDebit = num(mapping.openingDebit);
    const openCredit = num(mapping.openingCredit);
    const closeDebit = num(mapping.closingDebit);
    const closeCredit = num(mapping.closingCredit);
    const debit = useClosing ? closeDebit : movDebit;
    const credit = useClosing ? closeCredit : movCredit;
    if (debit === 0 && credit === 0 && movDebit === 0 && movCredit === 0 && openDebit === 0 && openCredit === 0) return;
    leaves.push({
      code, name: nm, chain: chainOf(code),
      closingValue: Math.abs(debit - credit), nature: debit >= credit ? "debit" : "credit",
      opening: openDebit - openCredit, netDebit: movDebit, netCredit: movCredit,
    });
  });
  if (!leaves.length) return null;
  const { parents, nameByCode } = parentsFromLeaves(leaves);
  if (!parents.length) return null; // مفيش حسابات أب حقيقية في الملف — سيب الوضع المسطّح القديم
  return { leaves, parents, nameByCode: { ...codeToName, ...nameByCode } };
}

// يبني خريطة تصنيف للآباء من التصنيفات المحفوظة، مع تخمين تلقائي اختياري
export function seedClassMapFrom(parsed, savedMap, autoGuess) {
  const cm = {};
  parsed.parents.forEach((p) => {
    // الحسابات التفصيلية النهائية (الأوراق) ما بتاخدش تصنيفها من الذاكرة العالمية المحفوظة بالاسم/الكود —
    // لو أخدت، أي مرة تتصنّف فيها هتفضل "مصنّفة مباشرة" للأبد وتوقف انتشار تصنيف أبوها ليها تاني
    // (لو غيّرت تصنيف الأب بعد كده، الورقة مش هتتبع التغيير). وكمان بما إن الذاكرة دي عالمية لكل
    // شركات المستخدم، حساب بنفس الاسم (زي "صافي المشتريات") في شركة تانية كان ممكن يسرّب تصنيفه هنا.
    // فالأوراق تاخد تصنيفها بس من: (1) اختيار المستخدم المباشر ليها في الجلسة الحالية، أو (2) أقرب أب مصنّف.
    if (p.isLeafItem) return;
    const byCode = savedMap && savedMap[`code:${p.code}`];
    const byName = savedMap && savedMap[`name:${p.name}`];
    if (byCode) cm[p.code] = byCode;
    else if (byName) cm[p.code] = byName;
    else if (autoGuess) cm[p.code] = guessCategory(p.name, p.code, p.chain.map((c) => c.name).join(" "), p.debitSum >= (p.creditSum || 0) ? "debit" : "credit");
  });
  return cm;
}

export function zakatPartners(f) {
  // حصص الشركاء للزكاة من حسابات رأس المال (شركاء) فقط — نستبعد جاري الشركاء
  const capital = f.equityAccountRows.filter((r) => r.amount > 0 && /شرك|رأس المال|راس المال/.test(r.name) && !/جاري/.test(r.name));
  const list = capital.length ? capital : f.equityAccountRows.filter((r) => r.amount > 0 && !/جاري/.test(r.name));
  return list.length ? list : f.equityAccountRows.filter((r) => r.amount > 0);
}

export function computeZakatTotal(zakatData) {
  if (!zakatData || !zakatData.rows || !zakatData.items) return 0;
  const f = computeFigures(zakatData.rows);
  const assetItems = zakatData.items.filter((i) => i.group === "asset");
  const liabilityItems = zakatData.items.filter((i) => i.group === "liability");
  const zakatBase = assetItems.reduce((s, i) => s + i.amount, 0) - liabilityItems.reduce((s, i) => s + i.amount, 0);
  const days = zakatData.hawlStart && zakatData.hawlEnd ? Math.round((new Date(zakatData.hawlEnd) - new Date(zakatData.hawlStart)) / 86400000) : 354;
  const proration = days > 0 ? days / 354 : 1; // تعديل شرعي: تناسب الحول الهجري (354 يوم) بلا سقف — يعوّض طول السنة الميلادية برفع النسبة الفعلية بدل تجميدها عند 100%
  const rate = zakatData.rate ?? 2.5;
  const nisab = (zakatData.goldPrice ?? 0) > 0 ? zakatData.goldPrice * 85 : 0;
  const partnersRaw = zakatPartners(f);
  const totalEquity = partnersRaw.reduce((s, p) => s + p.amount, 0);
  if (nisab <= 0) return 0;
  return partnersRaw.reduce((s, p) => {
    const share = zakatBase * (totalEquity ? p.amount / totalEquity : 0);
    return s + (share >= nisab ? share * (rate / 100) * proration : 0);
  }, 0);
}
