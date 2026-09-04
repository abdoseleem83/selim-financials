/* دوال الحساب والتحليل — كود خالص من غير React ولا DOM.
 *
 * اتفصلت هنا عشان تبقى قابلة للاختبار: ده تطبيق بيطلع قوائم مالية وزكاة،
 * وأي غلط في الدوال دي بيطلع أرقام غلط في مستندات رسمية.
 * الاختبارات في tests/calc.test.js — شغّلها بـ npm test.
 *
 * الملف ده وحدة ES عشان الاختبارات تستوردها، وسكربت البناء بيدمجه مع
 * app.src.jsx في app.js (بيشيل كلمة export وقت البناء).
 */

export const MONTH_NAMES = ["يناير", "فبراير", "مارس", "ابريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

// تنسيق الأرقام: السالب بين قوسين زي التقارير المحاسبية
export const fmt = (n) => {
  if (n === null || n === undefined || isNaN(n)) return "—";
  const abs = Math.abs(n);
  const s = abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${s})` : s;
};

export const DEBIT_NATURE = new Set(["asset_current", "asset_noncurrent", "sales_returns", "sales_discounts", "purchases", "cogs", "opex", "other_expense", "tax"]);

/* توحيد الإملاء العربي.
 *
 * التصنيف كله مبني على مطابقة أسماء الحسابات بتعبيرات نمطية، ودليل الحسابات
 * بيتكتب بأشكال إملائية مختلفة: "تكلفه" و"تكلفة"، "اهلاك" و"إهلاك"، "بضاعه"
 * و"بضاعة"، وأحيانًا بتشكيل أو تطويل. أي اختلاف من دول كان بيخلّي الحساب
 * يفوت كل القواعد ويقع على التخمين من طبيعة الرصيد — وده بيغيّر أرقام القوائم.
 *
 * الطريقة: بنجرّب المطابقة على النص الأصلي **و** على نسخة موحّدة من النص
 * بنمط موحّد كمان. يعني كل اللي كان بيطابق قبل كده لسه بيطابق (مجموعة أكبر
 * مش مختلفة)، وبس بنكسب أشكال الكتابة اللي كانت بتفلت.
 */
export function normAr(str) {
  return String(str == null ? "" : str)
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")  // تشكيل وتطويل
    .replace(/[\u0623\u0625\u0622\u0671]/g, "\u0627") // أ إ آ ٱ ← ا
    .replace(/\u0649/g, "\u064A")                    // ى ← ي
    .replace(/\u0629/g, "\u0647")                    // ة ← ه
    .replace(/\u0624/g, "\u0648")                    // ؤ ← و
    .replace(/\u0626/g, "\u064A")                    // ئ ← ي
    .replace(/\s+/g, " ")
    .trim();
}

// نفس التوحيد على نمط الـ regex نفسه، مع تخزين مؤقت عشان مانبنيش النمط كل مرة
const normReCache = new Map();
function normRe(re) {
  let out = normReCache.get(re);
  if (!out) { out = new RegExp(normAr(re.source), re.flags); normReCache.set(re, out); }
  return out;
}

// يطابق لو النص الأصلي طابق، أو لو النسخة الموحّدة طابقت النمط الموحّد
export function arMatch(re, text) {
  if (re.test(text)) return true;
  return normRe(re).test(normAr(text));
}

export function guessCategory(name = "", code = "", context = "", nature = null) {
  const n = `${name} ${context}`;
  // تكلفة البضاعة المباعة: لازم اسم الحساب نفسه هو اللي يدل على التكلفة، مش اسم أب بعيد
  // في سلسلة الأجداد — وإلا أي حساب "مشتريات" أو "مردود مشتريات" متفرّع تحت مجموعة أبوها
  // اسمها "تكلفة البضاعة المباعة" هيتصنف تكلفة بضاعة مباعة غلط بدل مشتريات/مردودات، وتختفي
  // المشتريات تمامًا من قائمة الدخل (بترجع صفر) وتتضخم تكلفة البضاعة المباعة بدل ما تتحسب
  // بالمعادلة الصحيحة (مخزون أول + مشتريات − مخزون آخر)
  if (arMatch(/تكلفة المبيعات|تكلفة البضاعة|تكلفة منتج تام/, name)) return "cogs";
  // نفس المبدأ: "مشتريات"/"مردود مشتريات" لازم تتحكم فيهم أسماء الحسابات نفسها مش أسماء
  // الأجداد — وإلا أي حساب مشتريات متفرّع تحت مجموعة أبوها فيها كلمة "بضاعة" (زي "تكلفة
  // البضاعة المباعة") هيتصنف أصل متداول غلط بسبب كلمة "بضاعة" الموجودة في اسم الأب، وتختفي
  // المشتريات من قائمة الدخل
  if (arMatch(/مردود|مرتجع/, name) && arMatch(/مشتريات|مشتري/, name)) return "purchase_returns";
  if (arMatch(/مشتريات/, name)) return "purchases";
  // حساب اسمه بيبدأ بـ«مصروف/مصاريف» هو مصروف، حتى لو فيه كلمة تانية بتوحي بأصل.
  // من غير الشرط ده، حساب زي «مصاريف- نقل وشحن بضاعه» كان بيتصنّف أصل متداول
  // بسبب كلمة «بضاعه» — وبما إن اسمه فيه «بضاعه» برضه كان بيتحسب ضمن المخزون كمان.
  // فالمبلغ كان بيتحسب مرتين: مرة بيضخّم الأصول، ومرة بينقّص تكلفة البضاعة المباعة
  // (لأنها بتتحسب بالمعادلة من المخزون) — يعني الربح بيتضخّم بضعف المبلغ بينما
  // الأصول بتتضخّم بمقداره مرة واحدة، والمركز المالي بيختل بفرق يساوي المبلغ.
  // على ميزان حقيقي (٨ شهور): ربح السنة اتضخّم 217,980.60 والمركز اختل بـ108,990.30.
  // الاستثناء: «مقدمة» (أصل) و«مستحقة» (خصم) — دول فعلاً مش مصروف الفترة.
  if (arMatch(/^\s*(مصروف|مصاريف|م\s*\/)/, name) && !arMatch(/مقدم|مستحق/, name)) return "opex";
  const rules = [
    [/مردودات المبيعات|مردودات مبيعات|مردود المبيعات|مردود مبيعات|مرتجع مبيعات/, "sales_returns"],
    [/خصم.*مبيعات|خصومات مسموح|خصم مسموح/, "sales_discounts"],
    [/نقد|بنك|صندوق|صناديق|خزين|خزنة|كاش|عملاء|مدين|مخزون|بضاعة|أوراق قبض|سلف|عهد/, "asset_current"],
    [/أصول ثابتة|عقار|آلات|أثاث|سيارات|مجمع إهلاك|مجمع اهلاك|استثمار.*طويل|شهرة/, "asset_noncurrent"],
    [/موردين|دائن|مصروفات مستحقة|أوراق دفع|ضريبة مستحقة|قرض قصير/, "liability_current"],
    [/قرض طويل|قروض طويلة|التزام طويل|مخصص.*طويل/, "liability_noncurrent"],
    [/رأس المال|احتياطي|أرباح مرحلة|أرباح محتجزة|جاري الشريك|حقوق الملكية|شركاء/, "equity"],
    [/مشتريات/, "purchases"],
    [/مبيعات|إيراد التشغيل|إيرادات النشاط/, "revenue"],
    [/مصروف|رواتب|مرتبات|إيجار|ايجار|إهلاك|اهلاك|دعاية|صيانة|كهرباء|قرطاسية|عمولات البيع|عمولات علي المبيعات|نقل وشحن|م\/ نقل|تليفون|بوفيه|نظافه|زكاه وبر|حوافز|سولار|بنزين|وقود|انتقالات|مصاريف|رسوم|تراخيص|مخالفات|غيار|كارتة الطريق|مياه|اكراميات|ادوات|مستلزمات|عمولات وفوايد/, "opex"],
    [/إيراد آخر|إيرادات أخرى|أرباح بيع أصل|ايراد بيع أصول|إيرادات متنوعه|إيرادات متنوعة|خصم مكتسب|بونص/, "other_income"],
    [/مصروف آخر|مصروفات أخرى|خسارة/, "other_expense"],
    [/ضريبة الدخل|ضريبة دخل/, "tax"],
    [/الأصول/, "asset_current"],
    [/الخصوم/, "liability_current"],
  ];
  for (const [re, cat] of rules) if (arMatch(re, n)) return cat;
  // مفيش قاعدة كلمات مطابقة — مانخمّنش من أول رقم في الكود (ده بيختلف تمامًا من شركة لشركة:
  // ممكن جذر "3" يبقى مصروفات عند شركة وحقوق ملكية عند شركة تانية)، فبدل كده نخمّن من طبيعة
  // الرصيد نفسه: رصيد مدين على الأغلب مصروف، رصيد دائن على الأغلب إيراد — وده أأمن بكتير من
  // تخمين "حقوق ملكية" اللي ممكن يخفي مصروفات حقيقية من قائمة الدخل تمامًا
  if (nature === "debit") return "opex";
  if (nature === "credit") return "other_income";
  return "asset_current";
}

// تصنيف حسابات حقوق الملكية الفرعية: رأس المال / جاري الشركاء / أرباح محتجزة سنوات سابقة —
// بنبص على تعديل يدوي (bsGroup) الأول، وبعدين على اسم الحساب وسلسلة آبائه كاملة (chain)
// عشان الحسابات التحليلية الفرعية تحت "جاري الشركاء" (زي مصروفات سيارة الشريك) تاخد نفس تصنيف أبوها
export function equityBucketOf(r) {
  if (r.bsGroup === "equity_capital") return "capital";
  if (r.bsGroup === "equity_partners") return "partners";
  if (r.bsGroup === "equity_retained") return "retained";
  const t = `${r.name} ${((r.chain || []).map((a) => a.name).join(" "))}`;
  if (arMatch(/محتجز|مرحل|أرباح سابقة/, t)) return "retained";
  if (arMatch(/جاري|مسحوب|سحب|مدفوعات|موزع|توزيع/, t)) return "partners";
  return "capital";
}

// الأرقام في ملفات الإكسل العربية بتيجي بأشكال كتير: أرقام هندية (٠١٢٣ / ۰۱۲۳)،
// فواصل آلاف عربية (٬)، وسالب متكتب بين قوسين (1,234) زي تقارير المحاسبة.
// لو ما نظّفناش ده، parseFloat بيرجّع NaN والقيمة بتتحوّل صفر من غير أي تحذير — يعني بيانات ضايعة بصمت.
export function normalizeDigits(str) {
  return String(str)
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[\u066B]/g, ".")   // الفاصلة العشرية العربية
    .replace(/[\u066C\u00A0\u2009\u202F]/g, ""); // فاصلة الآلاف العربية والمسافات غير القابلة للكسر
}

export function numericFromCell(raw) {
  let s = normalizeDigits(String(raw).trim());
  let paren = false;
  // (1,234) و 1,234- و -1,234 كلهم يعني سالب
  if (/^\(.*\)$/.test(s)) { paren = true; s = s.slice(1, -1).trim(); }
  s = s.replace(/,/g, "").replace(/^\+/, "");
  if (/-$/.test(s)) s = "-" + s.slice(0, -1).trim(); // السالب اللاحق (شائع في تصدير بعض البرامج)
  const v = parseFloat(s);
  if (isNaN(v)) return NaN;
  return paren ? -Math.abs(v) : v;
}

export function parseAmountCell(raw) {
  if (raw === null || raw === undefined || raw === "") return { value: 0, nature: null };
  let s = normalizeDigits(String(raw).trim());
  let nature = null;
  const last = s.slice(-1);
  if (last === "م" || last === "د") {
    nature = last === "م" ? "debit" : "credit";
    s = s.slice(0, -1).trim();
  }
  const value = numericFromCell(s);
  if (isNaN(value)) return { value: 0, nature: null };
  if (nature) return { value: Math.abs(value), nature };
  if (value !== 0) return { value: Math.abs(value), nature: value < 0 ? "credit" : "debit" };
  return { value: 0, nature: null };
}

export function cleanAccName(raw) {
  // لازم trim الأول: خلايا الإكسل بتيجي بمسافات زايدة كتير، والقوس الأخير
  // في "[1010] " مكانش بيتشال لأن ]$ مش بيطابق قبل ما المسافة تتشال —
  // فاسم الحساب كان بيفضل فيه ] تايهة ومايطابقش التصنيف المحفوظ عليه
  return String(raw ?? "")
    .trim()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/-+\s*$/, "")
    .trim();
}

export function parseSignedNum(raw) {
  if (raw === null || raw === undefined || raw === "") return 0;
  let s = normalizeDigits(String(raw).trim());
  const last = s.slice(-1);
  if (last === "م" || last === "د") s = s.slice(0, -1).trim();
  const v = numericFromCell(s);
  return isNaN(v) ? 0 : v;
}

export function computeFigures(rows, openingInventory, forcedCogsMethod) {
  // للمركز المالي: نستخدم رصيد نهاية المدة (debit/credit) حسب طبيعة التصنيف
  const val = (r) => (DEBIT_NATURE.has(r.category) ? r.debit - r.credit : r.credit - r.debit);
  // لقائمة الدخل: نستخدم صافي حركة الشهر (netDebit - netCredit) لو متوفرة، وإلا رصيد النهاية
  const hasMovement = rows.some((r) => (r.netDebit || 0) !== 0 || (r.netCredit || 0) !== 0);
  const mov = (r) => {
    if (r.netDebit === undefined && r.netCredit === undefined) return val(r);
    const nd = r.netDebit || 0, nc = r.netCredit || 0;
    return DEBIT_NATURE.has(r.category) ? nd - nc : nc - nd;
  };
  const byCat = (cat) => rows.filter((r) => r.category === cat);
  const sum = (cat) => byCat(cat).reduce((s, r) => s + val(r), 0);        // رصيد (مركز مالي)
  const sumMov = (cat) => byCat(cat).reduce((s, r) => s + mov(r), 0);      // حركة (قائمة دخل)

  const grossSales = sumMov("revenue");
  const salesReturns = sumMov("sales_returns");
  const salesDiscounts = sumMov("sales_discounts");
  const netSales = grossSales - salesReturns - salesDiscounts;
  const returnsRatio = grossSales ? salesReturns / grossSales : 0;

  // المخزون: من حساب المخزون بالميزانية فقط — أول المدة = رصيد بداية، آخر المدة = رصيد نهاية
  // نستبعد حسابات المخزون تحت المتاجرة والتحويلات (قيود تسوية)
  const invRows = rows.filter((r) => arMatch(/مخزون|بضاعة|بضائع/, r.name) && !arMatch(/متاجرة|تحويل|أول المدة/, r.name) && (r.category === "asset_current" || r.category === "asset_noncurrent"));
  // نفس مبدأ إصلاح النقدية: حساب مخزون برصيد دائن (غير طبيعي) لازم يتخصم من الإجمالي، مش يتجمع عليه
  const closingInventory = invRows.reduce((s, r) => s + (r.debit - r.credit), 0);
  const openingInvFromAccounts = invRows.reduce((s, r) => s + (r.opening || 0), 0);
  const openInv = openingInvFromAccounts > 0 ? openingInvFromAccounts : (openingInventory || 0);
  const purchases = sumMov("purchases") - sumMov("purchase_returns");
  // بعض الشركات بتسجّل تكلفة البضاعة المباعة مباشرة في حسابات مستقلة بالميزان،
  // وبعضها بتحسبها بالمعادلة (مخزون أول + مشتريات − مخزون آخر). ندعم الطريقتين:
  // لو فيه حسابات تكلفة بضاعة مباعة برصيد فعلي، نستخدمها كما هي؛ وإلا نستخدم المعادلة.
  const isCogsName = (n) => arMatch(/تكلفة\s*(ال)?بضاع|تكلفة\s*المبيعات/, n);
  const directCogsRows = rows.filter((r) =>
    r.category === "cogs" ||
    (isCogsName(r.name) && r.category !== "revenue" && r.category !== "sales_returns" && r.category !== "sales_discounts")
  );
  const directCogs = directCogsRows.reduce((s, r) => {
    const nd = r.netDebit || 0, nc = r.netCredit || 0;
    // تكلفة البضاعة المباعة طبيعتها مدينة
    return s + ((nd !== 0 || nc !== 0) ? (nd - nc) : (r.debit - r.credit));
  }, 0);
  // لو الشركة محددة طريقة ثابتة (من إعدادات الشركة)، نلتزم بيها بدل الاكتشاف التلقائي —
  // ده بيمنع تذبذب الطريقة بين شهر وشهر لنفس الشركة بسبب اختلاف الحسابات المستخدمة في كل ميزان
  const useDirectCogs = forcedCogsMethod === "direct" ? true
    : forcedCogsMethod === "formula" ? false
    : Math.abs(directCogs) > 0.004;
  const cogs = useDirectCogs ? directCogs : (openInv + purchases - closingInventory);
  const cogsMethod = useDirectCogs ? "direct" : "formula";
  const grossProfit = netSales - cogs;
  const grossMargin = netSales ? grossProfit / netSales : 0;

  // المصروفات: تُجمَّع حسابات الإهلاك كلها في سطر واحد بدل تفريطها
  const opexRaw = byCat("opex").map((r) => ({ code: r.code, name: r.name, amount: mov(r) })).filter((r) => Math.abs(r.amount) > 0.004);
  const isDep = (n) => arMatch(/إهلاك|استهلاك/, n);
  const depTotal = opexRaw.filter((r) => isDep(r.name)).reduce((s, r) => s + r.amount, 0);
  const opexRows = opexRaw.filter((r) => !isDep(r.name));
  if (Math.abs(depTotal) > 0.004) opexRows.push({ name: "إهلاك الأصول الثابتة", amount: depTotal });
  const opex = opexRows.reduce((s, r) => s + r.amount, 0);
  const opexRatio = netSales ? opex / netSales : 0;
  const operatingProfit = grossProfit - opex;
  const operatingMargin = netSales ? operatingProfit / netSales : 0;

  const otherIncomeRows = byCat("other_income").map((r) => ({ code: r.code, name: r.name, amount: mov(r) })).filter((r) => Math.abs(r.amount) > 0.004);
  const otherIncome = otherIncomeRows.reduce((s, r) => s + r.amount, 0);
  const otherExpense = sumMov("other_expense");
  const tax = sumMov("tax");
  const netProfit = operatingProfit + otherIncome - otherExpense - tax;
  const netMargin = netSales ? netProfit / netSales : 0;
  const oci = sumMov("oci");
  const totalComprehensive = netProfit + oci;

  const assetCurrentRows = byCat("asset_current").map((r) => ({ code: r.code, name: r.name, amount: val(r) })).filter((r) => r.amount);
  const assetNoncurrentRows = byCat("asset_noncurrent").map((r) => ({ code: r.code, name: r.name, amount: val(r) })).filter((r) => r.amount);
  const liabilityCurrentRows = byCat("liability_current").map((r) => ({ code: r.code, name: r.name, amount: val(r) })).filter((r) => r.amount);
  const liabilityNoncurrentRows = byCat("liability_noncurrent").map((r) => ({ code: r.code, name: r.name, amount: val(r) })).filter((r) => r.amount);
  const equityAccountRows = byCat("equity").map((r) => ({ code: r.code, name: r.name, amount: val(r), chain: r.chain, bsGroup: r.bsGroup })).filter((r) => r.amount);

  const currentAssets = assetCurrentRows.reduce((s, r) => s + r.amount, 0);
  const nonCurrentAssets = assetNoncurrentRows.reduce((s, r) => s + r.amount, 0);
  const totalAssets = currentAssets + nonCurrentAssets;
  const currentLiab = liabilityCurrentRows.reduce((s, r) => s + r.amount, 0);
  const nonCurrentLiab = liabilityNoncurrentRows.reduce((s, r) => s + r.amount, 0);
  const totalLiab = currentLiab + nonCurrentLiab;
  const equityAccounts = equityAccountRows.reduce((s, r) => s + r.amount, 0);
  const totalEquity = equityAccounts + netProfit;
  const totalLiabEquity = totalLiab + totalEquity;

  const inv = /مخزون|بضاعة|بضائع/;
  const srcRows = rows;
  const chainText = (r) => `${r.name} ${((r.chain || []).map((a) => a.name).join(" "))}`;
  // تجاوز يدوي لموضع الحساب في المركز المالي (يحدده المستخدم من زر التعديل — أو من تصنيف الأب في شاشة التصنيف)
  // فهرس يُبنى مرة واحدة بمفتاح كود الحساب (والاسم احتياطي لو الميزان من غير أكواد).
  // قبل كده كان في srcRows.find بالاسم جوّه فلاتر بتلف هي كمان على الحسابات — تعقيد تربيعي؛
  // والأهم إن المفتاح كان الاسم، فحسابين بنفس الاسم في فرعين مختلفين كانوا بياخدوا تصنيف
  // الحساب الأول وأرقامهم بتتجمّع في بند واحد غلط. الكود بيفصلهم صح.
  const keyOf = (r) => (r && r.code ? "c:" + r.code : "n:" + ((r && r.name) || ""));
  const byKey = new Map();
  for (let i = 0; i < srcRows.length; i++) { const k = keyOf(srcRows[i]); if (!byKey.has(k)) byKey.set(k, srcRows[i]); }
  const srcOf = (r) => byKey.get(keyOf(r));
  const ovOf = (r) => { const x = srcOf(r); return x && x.bsGroup ? x.bsGroup : null; };
  const isCashName = (n) => arMatch(/نقد|بنك|صندوق|صناديق|خزين|خزائن|خزنة|عهد|كاش|محفظ/, n);
  // ترتيب القواعد مهم: تأمين قبل مخزن (عشان "تأمين مخزن..." ميدخلش غلط في المخازن)،
  // وبنوك/خزائن قبل مخازن، وبنبص على سلسلة الآباء كمان مش بس اسم الحساب نفسه —
  // عشان الحسابات التحليلية الفرعية (زي "سولار سيارة..." تحت "جاري الشركاء") تاخد نفس مكان أبوها
  const bucketOf = (r) => {
    const ov = ovOf(r);
    if (ov) return ov;
    const t = chainText(r);
    if (arMatch(/تأمين/, t)) return "deposits";
    if (arMatch(/بنك/, t)) return "banks";
    // العهد (عهدة موظف/سيارة نقدية) منفصلة عن الخزائن الفعلية — نفس طبيعة النقدية بس بند مختلف في العرض
    if (arMatch(/عهد/, t)) return "custody";
    if (arMatch(/نقد|صندوق|صناديق|خزين|خزائن|خزنة|كاش|محفظ/, t)) return "treasury";
    if (arMatch(/مخزون|بضاعة|بضائع|مخزن/, t) && !arMatch(/متاجرة|تحويل|أول المدة/, r.name)) return "inventory";
    // حساب فيه "جاري" وهو لسه مصنّف كأصل (مش حقوق ملكية) غالبًا حساب جاري شريك اتصنف غلط —
    // منحطوش في «سلف» عشان القيم بتاعته بتبقى ضخمة وبالسالب وبتشوّه البند؛ يفضل في «أرصدة مدينة أخرى» لحد ما يتصحح تصنيفه من شاشة التصنيف
    if (arMatch(/جاري/, t)) return "other_debtors";
    if (arMatch(/سلفة|سلف/, t)) return "advances";
    return "other_debtors";
  };
  const inGroup = (r, g) => {
    const ov = ovOf(r);
    if (ov) return ov === g;
    if (g === "cash") return isCashName(r.name);
    if (g === "inventory") return arMatch(inv, r.name) && !arMatch(/متاجرة|تحويل|أول المدة/, r.name);
    return false;
  };
  const cashRows = assetCurrentRows.filter((r) => inGroup(r, "cash"));
  const cash = cashRows.reduce((s, r) => s + r.amount, 0);
  const bySubtype = (st) => srcRows.filter((r) => r.subtype === st && !r.bsGroup);
  const sumRows = (arr) => arr.reduce((s, r) => s + (DEBIT_NATURE.has(r.category) ? r.debit - r.credit : r.credit - r.debit), 0);
  const customerDebt = Math.abs(sumRows(bySubtype("customer_debt")));
  const customerPrepaid = Math.abs(sumRows(bySubtype("customer_prepaid")));
  const supplierDebt = Math.abs(sumRows(bySubtype("supplier_debt")));
  const supplierPrepaid = Math.abs(sumRows(bySubtype("supplier_prepaid")));
  const openingInventoryFromTB = openingInvFromAccounts;

  // ===== المركز المالي المجمّع (بشكل الإكسيل) — القديم: خزائن+بنوك مجمّعين، ومدينون فيها كل حاجة غير مصنّفة =====
  const cashGroup = cashRows.map((r) => ({ code: r.code, name: r.name, amount: r.amount })).filter((r) => Math.abs(r.amount) > 0.004);
  const otherDebtorRows = assetCurrentRows.filter((r) => {
    const ov = ovOf(r);
    const src = srcOf(r);
    if (src && (src.subtype === "customer_debt" || src.subtype === "supplier_prepaid")) return false;
    if (ov) return ov === "debtors";
    if (isCashName(r.name)) return false;
    if (inv.test(r.name)) return false;
    return true;
  }).map((r) => ({ code: r.code, name: r.name, amount: r.amount })).filter((r) => Math.abs(r.amount) > 0.004);
  const debtorsGroup = otherDebtorRows.slice();
  const inventoryGroupOld = assetCurrentRows.filter((r) => inGroup(r, "inventory")).map((r) => ({ code: r.code, name: r.name, amount: r.amount })).filter((r) => Math.abs(r.amount) > 0.004);

  // ===== المركز المالي التفصيلي الجديد — حسب طلب المستخدم: خزائن / بنوك / مخازن / سلف / عملاء مستحق / دفعات مقدمة موردين / تأمين / أرصدة مدينة أخرى =====
  const bucketRows = (g) => srcRows.filter((r) => {
    if (r.category !== "asset_current") return false;
    // r هو الحساب نفسه من الميزان، فمفيش داعي لأي بحث — البحث بالاسم كان ممكن يرجّع حساب تاني بنفس الاسم
    if (r.subtype === "customer_debt" || r.subtype === "customer_prepaid" || r.subtype === "supplier_prepaid" || r.subtype === "supplier_debt") return false;
    return bucketOf(r) === g;
  }).map((r) => ({ code: r.code, name: r.name, amount: val(r) })).filter((r) => Math.abs(r.amount) > 0.004);
  const treasuryGroup = bucketRows("treasury");
  const custodyGroup = bucketRows("custody");
  const banksGroup = bucketRows("banks");
  const inventoryGroup = bucketRows("inventory");
  const advancesGroup = bucketRows("advances");
  const depositsGroup = bucketRows("deposits");
  const otherDebtorsGroup = bucketRows("other_debtors");
  const receivablesGroup = []; // عملاء مستحق
  if (customerDebt > 0.004) receivablesGroup.push({ name: "ذمم العملاء المدينة (مستحق على العملاء)", amount: customerDebt });
  assetCurrentRows.filter((r) => {
    if (ovOf(r) !== "receivables") return false;
    const src = srcOf(r);
    if (src && (src.subtype === "customer_debt" || src.subtype === "customer_prepaid" || src.subtype === "supplier_prepaid")) return false;
    return true;
  }).forEach((r) => { if (Math.abs(r.amount) > 0.004) receivablesGroup.push({ name: r.name, amount: r.amount }); });
  const supplierPrepaidGroup = []; // دفعات مقدمة موردين
  if (supplierPrepaid > 0.004) supplierPrepaidGroup.push({ name: "دفعات مقدمة للموردين (أرصدة موردين مدينة)", amount: supplierPrepaid });
  assetCurrentRows.filter((r) => {
    if (ovOf(r) !== "supplierPrepaid") return false;
    const src = srcOf(r);
    if (src && (src.subtype === "customer_debt" || src.subtype === "customer_prepaid" || src.subtype === "supplier_prepaid")) return false;
    return true;
  }).forEach((r) => { if (Math.abs(r.amount) > 0.004) supplierPrepaidGroup.push({ name: r.name, amount: r.amount }); });

  // الخصوم المتداولة: موردين مستحق / دفعات مقدمة عملاء / أرصدة دائنة أخرى
  const otherCreditorRows = liabilityCurrentRows.filter((r) => {
    const ov = ovOf(r);
    const src = srcOf(r);
    if (src && (src.subtype === "supplier_debt" || src.subtype === "customer_prepaid")) return false;
    if (ov) return ov === "creditors" || ov === "other_creditors";
    return true;
  }).map((r) => ({ code: r.code, name: r.name, amount: r.amount })).filter((r) => Math.abs(r.amount) > 0.004);
  const creditorsGroup = [];
  if (supplierDebt > 0.004) creditorsGroup.push({ name: "موردون (أرصدة دائنة — مستحق للموردين)", amount: supplierDebt });
  if (customerPrepaid > 0.004) creditorsGroup.push({ name: "دفعات مقدمة من العملاء (أرصدة عملاء دائنة)", amount: customerPrepaid });
  otherCreditorRows.forEach((r) => creditorsGroup.push(r));
  const suppliersPayableGroup = supplierDebt > 0.004 ? [{ name: "موردون (أرصدة دائنة — مستحق للموردين)", amount: supplierDebt }] : [];
  liabilityCurrentRows.filter((r) => {
    if (ovOf(r) !== "creditors") return false;
    const src = srcOf(r);
    if (src && (src.subtype === "supplier_debt" || src.subtype === "customer_prepaid")) return false;
    return true;
  }).forEach((r) => { if (Math.abs(r.amount) > 0.004) suppliersPayableGroup.push({ name: r.name, amount: r.amount }); });
  const customerPrepaidGroup = customerPrepaid > 0.004 ? [{ name: "دفعات مقدمة من العملاء (أرصدة عملاء دائنة)", amount: customerPrepaid }] : [];
  liabilityCurrentRows.filter((r) => {
    if (ovOf(r) !== "customerPrepaidLiab") return false;
    const src = srcOf(r);
    if (src && (src.subtype === "supplier_debt" || src.subtype === "customer_prepaid")) return false;
    return true;
  }).forEach((r) => { if (Math.abs(r.amount) > 0.004) customerPrepaidGroup.push({ name: r.name, amount: r.amount }); });
  const otherCreditorsGroup = liabilityCurrentRows.filter((r) => {
    const ov = ovOf(r);
    const src = srcOf(r);
    if (src && (src.subtype === "supplier_debt" || src.subtype === "customer_prepaid")) return false;
    if (ov) return ov === "other_creditors";
    return !ov;
  }).map((r) => ({ code: r.code, name: r.name, amount: r.amount })).filter((r) => Math.abs(r.amount) > 0.004);

  const balanceGroups = {
    // مجموعات قديمة (متبقية للتوافق مع وحدة الزكاة وأي حسابات أخرى تعتمد عليها)
    cash: { title: "أولاً: النقدية والخزائن", rows: cashGroup, total: cashGroup.reduce((s, r) => s + r.amount, 0) },
    debtors: { title: "المدينون", rows: debtorsGroup, total: debtorsGroup.reduce((s, r) => s + r.amount, 0) },
    // المجموعات التفصيلية الجديدة لعرض المركز المالي
    treasury: { title: "أولاً: خزائن", rows: treasuryGroup, total: treasuryGroup.reduce((s, r) => s + r.amount, 0) },
    custody: { title: "ثانياً: العهد", rows: custodyGroup, total: custodyGroup.reduce((s, r) => s + r.amount, 0) },
    banks: { title: "ثالثاً: بنوك", rows: banksGroup, total: banksGroup.reduce((s, r) => s + r.amount, 0) },
    receivables: { title: "رابعاً: عملاء مستحق", rows: receivablesGroup, total: receivablesGroup.reduce((s, r) => s + r.amount, 0) },
    supplierPrepaid: { title: "خامساً: دفعات مقدمة موردين", rows: supplierPrepaidGroup, total: supplierPrepaidGroup.reduce((s, r) => s + r.amount, 0) },
    inventory: { title: "سادساً: مخازن", rows: inventoryGroup, total: inventoryGroup.reduce((s, r) => s + r.amount, 0) },
    advances: { title: "سابعاً: سلف", rows: advancesGroup, total: advancesGroup.reduce((s, r) => s + r.amount, 0) },
    deposits: { title: "ثامناً: تأمين", rows: depositsGroup, total: depositsGroup.reduce((s, r) => s + r.amount, 0) },
    otherDebtors: { title: "تاسعاً: أرصدة مدينة أخرى", rows: otherDebtorsGroup, total: otherDebtorsGroup.reduce((s, r) => s + r.amount, 0) },
    noncurrent: { title: "أصول ثابتة", rows: [{ name: "صافي الأصول الثابتة (بعد مجمع الإهلاك)", amount: nonCurrentAssets }].filter((r) => Math.abs(r.amount) > 0.004), total: nonCurrentAssets, detailRows: assetNoncurrentRows },
    creditors: { title: "الخصوم المتداولة", rows: creditorsGroup, total: creditorsGroup.reduce((s, r) => s + r.amount, 0) },
    suppliersPayable: { title: "أولاً: موردين مستحق", rows: suppliersPayableGroup, total: suppliersPayableGroup.reduce((s, r) => s + r.amount, 0) },
    customerPrepaidLiab: { title: "ثانياً: دفعات مقدمة عملاء", rows: customerPrepaidGroup, total: customerPrepaidGroup.reduce((s, r) => s + r.amount, 0) },
    otherCreditors: { title: "ثالثاً: أرصدة دائنة أخرى", rows: otherCreditorsGroup, total: otherCreditorsGroup.reduce((s, r) => s + r.amount, 0) },
  };

  return {
    val, byCat, sum,
    grossSales, salesReturns, salesDiscounts, netSales, returnsRatio,
    openInv, purchases, closingInventory, cogs, cogsMethod, grossProfit, grossMargin,
    opexRows, opex, opexRatio, operatingProfit, operatingMargin,
    otherIncomeRows, otherIncome, otherExpense, tax, netProfit, netMargin, oci, totalComprehensive,
    assetCurrentRows, assetNoncurrentRows, liabilityCurrentRows, liabilityNoncurrentRows, equityAccountRows,
    currentAssets, nonCurrentAssets, totalAssets,
    currentLiab, nonCurrentLiab, totalLiab,
    equityAccounts, totalEquity, totalLiabEquity,
    inventory: closingInventory, openingInventoryFromTB, balanceDiff: totalAssets - totalLiabEquity,
    cash, customerDebt, supplierPrepaid, customerPrepaid, supplierDebt,
    balanceGroups,
  };
}

export function mergeFigures(list) {
  // list: array of computeFigures() results for multiple periods, aggregated for annual view
  const sumKey = (k) => list.reduce((s, f) => s + (f[k] || 0), 0);
  // التجميع السنوي بمفتاح الكود (والاسم احتياطي) — قبل كده كان بالاسم فقط، فمصروفان
  // مختلفان بنفس الاسم في فرعين كانوا بيتجمّعوا في سطر واحد على مدار السنة
  const mergeRows = (key) => {
    const map = new Map();
    list.forEach((f) => (f[key] || []).forEach((r) => {
      const k = r.code ? "c:" + r.code : "n:" + r.name;
      const cur = map.get(k);
      if (cur) cur.amount += r.amount;
      else map.set(k, { code: r.code, name: r.name, amount: r.amount });
    }));
    return Array.from(map.values());
  };
  const grossSales = sumKey("grossSales");
  const salesReturns = sumKey("salesReturns");
  const salesDiscounts = sumKey("salesDiscounts");
  const netSales = grossSales - salesReturns - salesDiscounts;
  const returnsRatio = grossSales ? salesReturns / grossSales : 0;
  const purchases = sumKey("purchases");
  const openInv = list.length ? list[0].openInv : 0;
  const closingInventory = list.length ? list[list.length - 1].closingInventory : 0;
  // لو الشهور بتستخدم تكلفة بضاعة مباعة مباشرة من الميزان، نجمعها زي ما هي بدل إعادة حسابها بالمعادلة
  const usesDirect = list.some((f) => f.cogsMethod === "direct");
  const cogs = usesDirect ? sumKey("cogs") : (openInv + purchases - closingInventory);
  const cogsMethod = usesDirect ? "direct" : "formula";
  // لو بعض الشهور استخدمت التكلفة المباشرة من الميزان وبعضها المعادلة، الإجمالي
  // السنوي بيبقى خليط من الطريقتين — رقم مش قابل للمقارنة ولا للاعتماد عليه.
  // بنطلّع تحذير عشان الواجهة توضّحه بدل ما يعدّي كأنه رقم سليم.
  // العلاج: تثبيت الطريقة من إعدادات الشركة (cogsMethod).
  const mixedCogsMethods = list.length > 1 && usesDirect && list.some((f) => f.cogsMethod === "formula");
  const cogsMethodMonths = mixedCogsMethods
    ? {
        direct: list.filter((f) => f.cogsMethod === "direct").length,
        formula: list.filter((f) => f.cogsMethod === "formula").length,
      }
    : null;
  const grossProfit = netSales - cogs;
  const grossMargin = netSales ? grossProfit / netSales : 0;
  const opexRows = mergeRows("opexRows");
  const opex = sumKey("opex");
  const opexRatio = netSales ? opex / netSales : 0;
  const operatingProfit = grossProfit - opex;
  const operatingMargin = netSales ? operatingProfit / netSales : 0;
  const otherIncomeRows = mergeRows("otherIncomeRows");
  const otherIncome = sumKey("otherIncome");
  const otherExpense = sumKey("otherExpense");
  const tax = sumKey("tax");
  const netProfit = operatingProfit + otherIncome - otherExpense - tax;
  const netMargin = netSales ? netProfit / netSales : 0;
  const oci = sumKey("oci");
  const totalComprehensive = netProfit + oci;
  const last = list[list.length - 1] || {};
  return {
    grossSales, salesReturns, salesDiscounts, netSales, returnsRatio,
    openInv, purchases, closingInventory, cogs, cogsMethod, mixedCogsMethods, cogsMethodMonths, grossProfit, grossMargin,
    opexRows, opex, opexRatio, operatingProfit, operatingMargin,
    otherIncomeRows, otherIncome, otherExpense, tax, netProfit, netMargin, oci, totalComprehensive,
    currentAssets: last.currentAssets || 0, nonCurrentAssets: last.nonCurrentAssets || 0, totalAssets: last.totalAssets || 0,
    currentLiab: last.currentLiab || 0, nonCurrentLiab: last.nonCurrentLiab || 0, totalLiab: last.totalLiab || 0,
    equityAccounts: last.equityAccounts || 0, totalEquity: (last.equityAccounts || 0) + netProfit,
    balanceDiff: last.balanceDiff || 0,
  };
}

/* حساب أرقام فترة واحدة بشكل صحيح:
   - لو الميزان "تراكمي من بداية السنة" (الوضع الافتراضي في برامج الحسابات): أرقام قائمة الدخل
     للشهر = التراكمي الحالي − التراكمي للفترة السابقة في نفس السنة، والمركز المالي من الميزان الحالي مباشرة.
   - لو الميزان "حركة الشهر فقط": الأرقام تؤخذ كما هي. */
export function periodFigures(sortedPeriods, period, yearOpeningInv, forcedCogsMethod) {
  const fCurr = computeFigures(period.rows, 0, forcedCogsMethod);
  const samePrev = sortedPeriods.filter((p) => p.year === period.year && p.month < period.month).pop();

  // مخزون أول المدة: الأولوية للرصيد الافتتاحي المستخرج من الميزان نفسه، وإلا رصيد نهاية الشهر السابق
  let monthOpenInv;
  let openingWarning = null;
  if (fCurr.openingInventoryFromTB && fCurr.openingInventoryFromTB > 0) {
    monthOpenInv = fCurr.openingInventoryFromTB;
    if (samePrev) {
      const prevClosing = computeFigures(samePrev.rows, 0, forcedCogsMethod).closingInventory;
      if (Math.abs(prevClosing - monthOpenInv) > 1) {
        openingWarning = `تنبيه: رصيد مخزون آخر ${MONTH_NAMES[samePrev.month - 1]} (${fmt(prevClosing)}) لا يطابق رصيد افتتاح ${MONTH_NAMES[period.month - 1]} (${fmt(monthOpenInv)}) — فرق ${fmt(prevClosing - monthOpenInv)}. راجع الميزان.`;
      }
    }
  } else {
    monthOpenInv = samePrev ? computeFigures(samePrev.rows, 0, forcedCogsMethod).closingInventory : (yearOpeningInv || period.openingInventory || 0);
  }

  // كل شهر يُرفع منفصلاً وأرقام قائمة الدخل من صافي الحركة = رقم الشهر مباشرة (بدون طرح)
  // لو الشركة بتسجّل تكلفة البضاعة المباعة مباشرة بالميزان، منعيدش حسابها بالمعادلة
  const cogs = fCurr.cogsMethod === "direct" ? fCurr.cogs : (monthOpenInv + fCurr.purchases - fCurr.closingInventory);
  const grossProfit = fCurr.netSales - cogs;
  const operatingProfit = grossProfit - fCurr.opex;
  const netProfit = operatingProfit + fCurr.otherIncome - fCurr.otherExpense - fCurr.tax;
  return {
    ...fCurr,
    openInv: monthOpenInv, cogs, grossProfit, openingWarning,
    grossMargin: fCurr.netSales ? grossProfit / fCurr.netSales : 0,
    operatingProfit, operatingMargin: fCurr.netSales ? operatingProfit / fCurr.netSales : 0,
    netProfit, netMargin: fCurr.netSales ? netProfit / fCurr.netSales : 0,
    totalComprehensive: netProfit + fCurr.oci,
  };
}

/* الأرقام السنوية = مجموع الفترات الشهرية (كل شهر مرفوع منفصلاً) */
export function yearFigures(sortedPeriods, year, yearOpeningInv, forcedCogsMethod) {
  const ps = sortedPeriods.filter((p) => p.year === year);
  if (!ps.length) return null;
  return mergeFigures(ps.map((p) => periodFigures(sortedPeriods, p, yearOpeningInv, forcedCogsMethod)));
}

export function round2(n) { return Math.round(n * 100) / 100; }
