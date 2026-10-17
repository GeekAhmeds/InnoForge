// In-app user guide. Each topic: id, icon, group, optional licensed feature, and the
// text in Arabic and English (title, intro, steps, tips). The Help page shows them with
// search; "Print / PDF" turns all of them into one user manual.
// `video` = file name of the matching tutorial video (docs/videos), when there is one.

export const HELP_GROUPS = ['start', 'selling', 'stock', 'customers', 'restaurant', 'money', 'more'];

export const TOPICS = [
  // ---------------- start ----------------
  {
    id: 'first-run', icon: '🚀', group: 'start', video: '01-first-sale',
    ar: {
      title: 'أول تشغيل والتفعيل',
      intro: 'أول مرة البرنامج بيفتح بيطلب بيانات النشاط وحساب المدير. ولو النسخة متسطبة من ملف التسطيب، بيطلب كمان مفتاح التفعيل.',
      steps: [
        'لو ظهرت شاشة التفعيل: انسخ «رقم الجهاز» وابعته لـ Inno Source أو للموزّع اللي اشتريت منه، والصق المفتاح اللي يوصلك واضغط تفعيل.',
        'اختار نوع النشاط (محل، مكتبة، مطعم، شركة تجارية). ده بيحدد الشاشات اللي هتظهر، وتقدر تغيّره بعدين.',
        'اكتب اسم النشاط والعملة والضريبة، وبعدين اسم المدير واسم الدخول والرقم السري (4 لـ 8 أرقام).',
        'البرنامج بيضيف أصناف تجريبية عشان تجرب. امسحها أو عدّلها من «الأصناف» لما تبدأ شغل حقيقي.',
      ],
      tips: ['الرقم السري للمدير مهم جداً. احفظه في مكان آمن.', 'من «الإعدادات ← بيانات النشاط» تقدر تحط اللوجو والعنوان والتليفون اللي بيظهروا على الفاتورة.'],
    },
    en: {
      title: 'First run and activation',
      intro: 'On first start the app asks for your business details and the manager account; an installed copy also asks for its activation key.',
      steps: [
        'On the activation screen copy the "Machine ID" and send it to Inno Source or your reseller, then paste the key you receive and press Activate.',
        'Pick the business type (shop, bookstore, restaurant, trading company) — it decides which screens appear; you can change it later.',
        'Enter the business name, currency and tax, then the manager name, username and PIN (4–8 digits).',
        'Sample products are added so you can try things; edit or remove them under Products when you go live.',
      ],
      tips: ['Keep the manager PIN somewhere safe.', 'Settings → Business holds the logo, address and phone printed on invoices.'],
    },
  },
  {
    id: 'users', icon: '👤', group: 'start',
    ar: {
      title: 'المستخدمين والصلاحيات',
      intro: 'كل واحد بيشتغل على البرنامج يبقى له اسم ورقم سري، وكل حاجة بيعملها بتتسجل باسمه.',
      steps: [
        'من «الإعدادات ← المستخدمين» اضغط «مستخدم جديد» واختار الدور: مدير، أو مشرف، أو كاشير.',
        'غيّر الصلاحيات لكل مستخدم لو حبيت: الخصم وأقصى نسبة، والمرتجع، وتغيير السعر، والبيع الآجل، وشوف التكلفة والأرباح، والتقارير…',
        'لو الكاشير حاول يعمل حاجة مش مسموحله بيها (خصم كبير مثلاً)، البرنامج بيطلب موافقة مشرف برقمه السري.',
        'من «الإعدادات ← سجل النشاط» تشوف مين عمل إيه وإمتى: الخصومات، والمرتجعات، والإلغاء، والتعديل في الأسعار…',
      ],
      tips: ['عدد المستخدمين ممكن يكون محدود حسب باقتك. شوف «الإعدادات ← الترخيص».'],
    },
    en: {
      title: 'Users and permissions',
      intro: 'Everyone gets their own name and PIN, and everything they do is recorded under their name.',
      steps: [
        'Settings → Users → New user, then pick the role: admin, supervisor or cashier.',
        'Adjust each user\'s permissions: discounts and their maximum %, refunds, price changes, credit sales, seeing cost and profit, reports…',
        'When a cashier tries something they are not allowed (a big discount, say) the app asks for a supervisor\'s PIN.',
        'Settings → Activity log shows who did what and when: discounts, refunds, voids, price edits…',
      ],
      tips: ['Your edition may limit the number of users — see Settings → License.'],
    },
  },
  {
    id: 'shift', icon: '⏱', group: 'start',
    ar: {
      title: 'الوردية (فتح وقفل الدرج)',
      intro: 'مفيش بيع من غير وردية مفتوحة. الوردية بتحسب الفلوس اللي المفروض تبقى في الدرج.',
      steps: [
        'اكتب الكاش اللي في الدرج أول ما تبدأ (الفكة) واضغط «فتح الوردية».',
        'طول اليوم البرنامج بيجمّع: البيع الكاش، والتحصيل، والمرتجعات، والمصروفات من الدرج، وكروت الهدايا.',
        'آخر اليوم من «الوردية»: عدّ الكاش واكتبه، والبرنامج بيقولك الفرق (زيادة أو عجز)، واطبع تقرير الوردية (Z).',
        'لو عندك خزنة، تقدر «تورّد» جزء من الكاش للخزنة الرئيسية وإنت بتقفل.',
      ],
      tips: ['تقرير «الورديات» في التقارير بيعرض الفرق في كل وردية.'],
    },
    en: {
      title: 'Shifts (opening and closing the drawer)',
      intro: 'You cannot sell without an open shift; the shift works out how much cash should be in the drawer.',
      steps: [
        'Enter the float in the drawer and press Open shift.',
        'During the day it adds up cash sales, collections, refunds, drawer expenses and gift-card sales.',
        'At day end, on Shift, count the cash and enter it; the app shows the difference (over / short) and prints the Z-report.',
        'With a treasury you can hand part of the cash to the main cash box while closing.',
      ],
      tips: ['The Shifts report lists the difference of every shift.'],
    },
  },

  // ---------------- selling ----------------
  {
    id: 'cashier', icon: '🛒', group: 'selling', video: '01-first-sale',
    ar: {
      title: 'البيع من شاشة الكاشير',
      intro: 'أسرع طريقة للبيع: امسح الباركود، أو دوس على الصنف، أو اكتب اسمه.',
      steps: [
        'امسح الباركود أو دوس على الصنف. ولو هتبيع كمية، اكتب الكمية ونجمة قبل الكود (مثلاً 3*12345).',
        'دوس على أي سطر في الفاتورة عشان تغيّر الكمية أو تعمل خصم على الصنف أو تكتب ملاحظة.',
        'دوس على «الخصم» عشان تعمل خصم على الفاتورة كلها، أو تكتب كوبون.',
        'اضغط «دفع» (F9) واختار الطريقة واكتب المبلغ، والبرنامج بيحسب الباقي.',
        'لو العميل مشي من غير ما يكمل، اضغط «تعليق» (F8)، وارجع للفاتورة بعدين من «الطلبات المعلّقة».',
      ],
      tips: ['الاختصارات: F2 بحث، F4 عميل، F8 تعليق، F9 دفع، و + − Del على آخر صنف.', 'لو الكهرباء قطعت والفاتورة لسه مفتوحة، هترجعلك لوحدها أول ما تفتح البرنامج.'],
    },
    en: {
      title: 'Selling on the cashier screen',
      intro: 'The fastest way to sell: scan, tap a product, or type its name.',
      steps: [
        'Scan the barcode or tap the product; for a quantity type it with a star before the code (e.g. 3*12345).',
        'Tap a cart line to change its quantity, give a line discount or add a note.',
        'Tap "Discount" for an invoice discount or to enter a coupon.',
        'Press Pay (F9), choose the method and amount; the change is worked out for you.',
        'If the customer steps away, Hold (F8) and bring the sale back later from Held orders.',
      ],
      tips: ['Shortcuts: F2 search, F4 customer, F8 hold, F9 pay, + − Del on the last item.', 'If the power goes with a sale open, it comes back when you reopen the app.'],
    },
  },
  {
    id: 'payments', icon: '💳', group: 'selling',
    ar: {
      title: 'الدفع: كاش وفيزا ومحفظة وآجل',
      intro: 'الفاتورة الواحدة ممكن تتدفع بأكتر من طريقة، والباقي ممكن يتسجل على حساب العميل.',
      steps: [
        'في شاشة الدفع اختار الطريقة واكتب المبلغ. لو اختارت فيزا الأول، المتبقي يتحسب كاش.',
        'عشان تبيع آجل: اختار العميل الأول (F4)، وبعدين اضغط «كل الفاتورة آجل» أو ادفع جزء.',
        'البرنامج بيوقف البيع الآجل لو العميل هيعدّي حد الائتمان بتاعه.',
        'لو عندك درج متوصل بالطابعة، بيفتح لوحده مع الدفع الكاش.',
      ],
      tips: ['نقاط الولاء وكروت الهدايا بتظهر في نفس شاشة الدفع لو الميزة في باقتك.'],
    },
    en: {
      title: 'Payment: cash, card, wallet and credit',
      intro: 'One invoice can be paid several ways, and what is left can go on the customer\'s account.',
      steps: [
        'In the payment window pick the method and amount; pick card first and the rest becomes cash.',
        'To sell on credit pick the customer (F4), then "All on account" or pay part.',
        'A credit sale that would pass the customer\'s credit limit is stopped.',
        'A cash drawer wired to the printer opens by itself on cash payments.',
      ],
      tips: ['Loyalty points and gift cards appear in the same window when your edition has them.'],
    },
  },
  {
    id: 'returns', icon: '↩', group: 'selling',
    ar: {
      title: 'المرتجعات وإلغاء الفواتير',
      intro: 'المرتجع بيتعمل من الفاتورة الأصلية، عشان المخزون والحسابات يتعدلوا صح.',
      steps: [
        'من شاشة البيع: اضغط «↩ مرتجع» (أو F7)، وامسح الباركود اللي على إيصال العميل أو اكتب رقم الفاتورة. أو من «الفواتير» دوّر على الفاتورة وافتحها واضغط «مرتجع».',
        'اكتب الكمية المرتجعة من كل صنف (أو «رجّع الكل») والسبب، وأكّد.',
        'الأصناف بترجع المخزون. والفلوس: لو الفاتورة كانت آجل، بتتخصم من حساب العميل الأول، والباقي بيطلع كاش من الدرج.',
        'إيصال المرتجع بيتطبع لوحده للعميل: الأصناف والمبلغ واترد إزاي.',
      ],
      tips: ['المرتجع محتاج صلاحية، أو موافقة مشرف.', 'عشان المسح يشتغل، فعّل «باركود رقم الفاتورة» في تصميم الإيصال.',
        'مرتجع من غير فاتورة (العميل مش معاه الإيصال): بيتفعّل من «الإعدادات ← بيانات النشاط ← المرتجعات»، وممكن تحط أقصى مبلغ. بعدها «↩ مرتجع ← مرتجع من غير فاتورة»: امسح الأصناف، واختار الفلوس ترجع كاش ولا على حساب العميل، واكتب السبب. الأسعار بسعر النهارده، والكاشير محتاج صلاحية «مرتجع من غير فاتورة» أو موافقة مشرف. مش متاح مع الفاتورة الإلكترونية.'],
    },
    en: {
      title: 'Returns and voids',
      intro: 'Returns are made from the original invoice so stock and accounts stay right.',
      steps: [
        'From the selling screen press "↩ Return" (or F7) and scan the barcode on the customer\'s receipt or type the invoice number. Or under Invoices find the invoice, open it and press Return.',
        'Enter the quantity of each item (or "Return all") and the reason, and confirm.',
        'Items go back into stock; money comes off the customer\'s balance first (credit sales), the rest is paid from the drawer.',
        'A return slip prints for the customer: items, amount and how it was refunded.',
      ],
      tips: ['Returns need the permission or a supervisor\'s approval.', 'For scanning, turn on "Invoice number barcode" in the receipt design.',
        'Returns without an invoice (no receipt): turn them on in Settings → Business → Returns, with an optional maximum. Then "↩ Return → Return without an invoice": scan the items, choose cash or the customer\'s account, and give a reason. Prices are today\'s; cashiers need the "Returns without an invoice" permission or a supervisor. Not available with e-invoicing.'],
    },
  },
  {
    id: 'trading', icon: '📄', group: 'selling', feature: 'trading',
    ar: {
      title: 'فاتورة البيع التجارية وعروض الأسعار',
      intro: 'شاشة للشركات: بتختار العميل الأول، وبعدين تكتب الأصناف في جدول بالوحدة والسعر والخصم.',
      steps: [
        'اختار العميل، فيظهر رصيده وحد الائتمان ومدة السماح وقائمة أسعاره.',
        'ضيف الأصناف: الوحدة (كرتونة/قطعة)، والكمية، والسعر، وخصم %. وعمود المخزون بيحذّرك لو الكمية مش كفاية.',
        'حدد المندوب وتاريخ الاستحقاق ورقم أمر الشراء، وادفع جزء والباقي آجل.',
        'أو احفظها «عرض سعر». وبعدين من «العملاء ← عروض الأسعار» تحوّلها فاتورة بضغطة.',
      ],
      tips: ['قوائم الأسعار (قطاعي / جملة / نص جملة) من «الإعدادات ← قوائم الأسعار»، وكل عميل ممكن يكون له قائمة.'],
    },
    en: {
      title: 'Trading invoice and quotations',
      intro: 'A screen for companies: customer first, then lines in a grid with unit, price and discount.',
      steps: [
        'Pick the customer — their balance, credit limit, terms and price list appear.',
        'Add lines: unit (carton/piece), qty, price, disc %; the stock column warns when it is short.',
        'Set the salesperson, due date and PO number; take a partial payment and leave the rest on account.',
        'Or save it as a quotation and turn it into an invoice later from Customers → Quotations.',
      ],
      tips: ['Price lists (retail / wholesale / semi) are under Settings → Price lists; each customer can have one.'],
    },
  },
  {
    id: 'installments', icon: '📆', group: 'selling', feature: 'installments', video: '05-installments',
    ar: {
      title: 'البيع بالتقسيط',
      intro: 'تقسيم المتبقي من فاتورة آجل على أقساط شهرية، لكل قسط تاريخ استحقاق.',
      steps: [
        'في فاتورة البيع اختار العميل، واكتب المقدم في «المدفوع دلوقتي».',
        'فعّل «بيع بالتقسيط»، واختار عدد الأقساط وكل كام شهر وتاريخ أول قسط، واحفظ.',
        'جدول الأقساط بيتطبع A4 للتوقيع. وتقدر تفتحه بعدين من الفاتورة.',
        'من «العملاء ← الأقساط» تشوف المتأخر والمستحق، وتبعت تذكير واتساب، وتحصّل القسط.',
      ],
      tips: ['أي فاتورة آجل قديمة ممكن تتقسط من شاشة الفاتورة («تقسيط الفاتورة»).', 'مفيش خانة فايدة؛ لو عايز فايدة، سعّر البضاعة بسعر التقسيط.'],
    },
    en: {
      title: 'Installment sales',
      intro: 'Split what a credit invoice still owes into monthly installments, each with its own due date.',
      steps: [
        'In the sales invoice pick the customer and enter the down payment in "Paid now".',
        'Turn on "Sell in installments", choose how many, every how many months and the first date, and save.',
        'An A4 schedule prints for signing; it can be opened later from the invoice.',
        'Customers → Installments lists overdue and due ones with a WhatsApp reminder and a collect button.',
      ],
      tips: ['Any older credit invoice can be split from the invoice screen.', 'There is no interest field — price the goods for installment sale.'],
    },
  },

  // ---------------- stock ----------------
  {
    id: 'products', icon: '📦', group: 'stock', video: '03-products-purchase',
    ar: {
      title: 'الأصناف والأسعار والوحدات',
      intro: 'كل صنف له اسم وباركود وسعر بيع وتكلفة ورصيد وحد طلب.',
      steps: [
        'من «الأصناف» اضغط «صنف جديد». الباركود ممكن تمسحه أو تسيبه فاضي والبرنامج يعمله.',
        'حدد التصنيف، وسعر البيع، والتكلفة، وحد الطلب (الرصيد اللي تحته الصنف يعتبر ناقص).',
        'الوحدات: ضيف «كرتونة = 12» بسعرها وباركودها، فالكاشير يقدر يبيع بالكرتونة أو بالقطعة.',
        'الأسعار حسب القائمة: لكل قائمة (جملة مثلاً) سعر للصنف.',
      ],
      tips: ['رفع الأصناف كلها مرة واحدة من شيت إكسيل: زرار «استيراد». الشيت فيه أعمدة للعبوة (اسمها، فيها كام، سعرها، باركودها).', 'تكلفة الصنف بتتحدث لوحدها مع كل فاتورة شراء (متوسط مرجّح).', 'المخزون بيظهر بالكرتونة كمان، مثلاً «10 كرتونة + 5 قطعة».'],
    },
    en: {
      title: 'Products, prices and units',
      intro: 'Each product has a name, barcode, price, cost, stock and minimum stock.',
      steps: [
        'Products → New product; scan a barcode or leave it empty and one is generated.',
        'Set category, price, cost and minimum stock (below it the item counts as low).',
        'Units: add "Carton = 12" with its own price and barcode so the cashier can sell either.',
        'Price-list prices: a price per list (e.g. wholesale).',
      ],
      tips: ['Load all products at once from an Excel sheet with Import; the sheet has pack columns (name, size, price, barcode).', 'Cost updates itself with every purchase (weighted average).', 'Stock also shows in packs, e.g. "10 cartons + 5 pieces".'],
    },
  },
  {
    id: 'variants', icon: '👕', group: 'stock',
    ar: {
      title: 'المقاسات والألوان (المتغيرات)',
      intro: 'صنف واحد (موديل) بمقاسات وألوان أو نكهات، وكل تركيبة ليها مخزون وباركود وسعر.',
      steps: [
        'افتح الصنف (أو اعمل صنف جديد) وانزل لـ«المقاسات والألوان».',
        'اضغط «+ المقاس» و«+ اللون» (أو خاصية تانية زي النكهة)، واكتب القيم مفصولة بفاصلة.',
        'البرنامج بيعمل كل التركيبات في جدول: اكتب سعر خاص لو مختلف (الفاضي = سعر الصنف)، والرصيد الأول، والباركود أو سيبه تلقائي.',
        'احفظ. الموديل بيظهر مرة واحدة في الأصناف وجنبه عدد المتغيرات، ورصيده مجموع رصيد المتغيرات.',
        'في البيع: دوس على الموديل يطلع جدول المقاس × اللون، أو امسح باركود المتغير على طول.',
      ],
      tips: [
        'المشتريات والمرتجعات والجرد بتتعمل على كل متغير لوحده.',
        'تقرير «المبيعات بالموديل» بيجمع كل المقاسات والألوان مع بعض، و«مبيعات وأرباح الأصناف» بيفصّلهم.',
        'ملصقات الباركود بتطبع المقاس واللون تحت اسم الموديل.',
        'لو الصنف عليه رصيد، صفّره الأول قبل ما تقسمه لمتغيرات.',
      ],
    },
    en: {
      title: 'Sizes and colours (variants)',
      intro: 'One item (a model) in sizes and colours or flavours; each combination has its own stock, barcode and price.',
      steps: [
        'Open the item (or create one) and scroll to "Sizes and colours".',
        'Press "+ Size" and "+ Colour" (or another attribute such as flavour) and type the values separated by commas.',
        'Every combination appears in a table: set a price if different (empty = the item\'s price), the opening stock, and a barcode or leave it automatic.',
        'Save. The model shows once in Products with its number of variants; its stock is their total.',
        'Selling: tap the model to get a size × colour grid, or scan the variant\'s barcode directly.',
      ],
      tips: [
        'Purchases, returns and stock counts work per variant.',
        'The "Sales by model" report adds all sizes and colours together; "Sales & profit by product" lists them apart.',
        'Barcode labels print the size and colour under the model name.',
        'An item that has stock must be zeroed before it is split into variants.',
      ],
    },
  },
  {
    id: 'labels', icon: '🏷', group: 'stock',
    ar: {
      title: 'ملصقات الباركود وتصميمها',
      intro: 'اطبع ملصقات للأصناف والكراتين والمقاسات، وصمّم شكل الملصق.',
      steps: [
        'من «الأصناف» اضغط «ملصقات»، واكتب عدد النسخ لكل صنف (أو «واحد لكل صنف» / «حسب المخزون»).',
        'اضغط «تصميم الملصق»: اختار المقاس (أو مقاس خاص بالمللي، أو ورقة A4)، وشغّل أو اقفل: اسم النشاط، الاسم، المقاس واللون، رقم الباركود، السعر، وسطر إضافي.',
        'غيّر خط الاسم والسعر وطول الباركود، وشوف المعاينة.',
        '«حفظ التصميم» عشان يفضل كده كل مرة، وبعدين «طباعة».',
      ],
      tips: ['لو الملصق بيطلع مقلوب فعّل «اقلب الملصق».', 'فعّل «إطار» أول مرة مع رول جديد عشان تتأكد إن الملصق مظبوط على الورقة.', 'الأصناف اللي من غير باركود: زرار «اعمل باركود» بيديها باركود داخلي.'],
    },
    en: {
      title: 'Barcode labels and their design',
      intro: 'Print labels for items, cartons and variants, and design how the label looks.',
      steps: [
        'Products → Labels, then type the number of copies per item (or "One each" / "By stock").',
        'Press "Label design": pick the size (or a custom size in mm, or an A4 sheet) and switch on or off: business name, name, size and colour, barcode number, price and an extra line.',
        'Change the name and price fonts and the barcode height, and check the preview.',
        '"Save design" keeps it for next time; then Print.',
      ],
      tips: ['If labels come out upside down, turn on "Turn the label over".', 'Turn on "Frame" the first time with a new roll to check the label sits right.', 'Items without a barcode: "Generate barcodes" gives them an internal one.'],
    },
  },
  {
    id: 'stock', icon: '🧮', group: 'stock',
    ar: {
      title: 'المخزون والجرد والصلاحية',
      intro: 'الرصيد بيتحرك لوحده مع البيع والشراء والمرتجع. والجرد بيصحح الفرق بين الرصيد والموجود فعلاً.',
      steps: [
        'الجرد: من «الأصناف ← الجرد» ابدأ جرد (للكل أو لتصنيف واحد)، وامسح الأصناف أو اكتب الكميات المعدودة، وبعدين «اعتماد».',
        'الفرق بيتسجل تسوية، وتقدر تشوف قيمته (عجز أو زيادة) قبل ما تعتمد.',
        'الصلاحية: فعّل «تتبع الصلاحية» في الصنف، واكتب التشغيلة وتاريخ الانتهاء في فاتورة الشراء. البيع بيطلع من الأقدم انتهاءً الأول.',
        'السيريال: للأجهزة، كل قطعة بتتباع بالسيريال بتاعها.',
      ],
      tips: ['تقرير «النواقص» و«الأصناف الراكدة» و«قيمة المخزون» في التقارير.'],
    },
    en: {
      title: 'Stock, counts and expiry',
      intro: 'Stock moves by itself with sales, purchases and returns; a count fixes differences with what is on the shelf.',
      steps: [
        'Products → Stock count: start a count (all or one category), scan or type counted quantities, then Apply.',
        'Differences are posted as adjustments; you see their value (shortage/surplus) before applying.',
        'Expiry: turn on "Track expiry" on the product and enter batch and expiry on the purchase; sales take the earliest expiry first.',
        'Serial numbers: for devices, each piece is sold with its serial.',
      ],
      tips: ['Reports: Low stock, Slow movers and Stock valuation.'],
    },
  },
  {
    id: 'purchases', icon: '🚚', group: 'stock', video: '03-products-purchase',
    ar: {
      title: 'المشتريات والموردين',
      intro: 'فاتورة الشراء بتزوّد المخزون، وبتحدّث التكلفة، وبتسجل اللي عليك للمورد.',
      steps: [
        'من «المشتريات» اضغط «فاتورة شراء»، واختار المورد، وامسح الأصناف أو دوّر عليها.',
        'اكتب الكمية والتكلفة، والخصم % والبونص (كمية مجانية) لو موجودين.',
        'ادفع جزء أو الكل: من الدرج، أو من الخزنة، أو البنك، أو بشيك. والباقي بيفضل على حساب المورد.',
        'مرتجع للمورد: افتح الفاتورة واضغط «مرتجع».',
        'أوامر الشراء: «اقتراح من النواقص» بيعمل أمر بالأصناف اللي قربت تخلص، ولما البضاعة توصل اضغط «استلام».',
      ],
      tips: ['كشف حساب المورد وسداده من «المشتريات ← الموردين».'],
    },
    en: {
      title: 'Purchases and suppliers',
      intro: 'A purchase adds stock, updates cost and records what you owe the supplier.',
      steps: [
        'Purchases → New purchase, pick the supplier and scan or search the items.',
        'Enter quantity and cost, and any discount % or bonus (free) quantity.',
        'Pay part or all — from the drawer, a cash box, the bank or by cheque; the rest stays on the supplier account.',
        'Return to supplier: open the purchase and press Return.',
        'Purchase orders: "Suggest from low stock" drafts an order; "Receive" turns it into a purchase.',
      ],
      tips: ['Supplier statements and payments are under Purchases → Suppliers.'],
    },
  },
  {
    id: 'warehouses', icon: '🏬', group: 'stock', feature: 'warehouses',
    ar: {
      title: 'أكتر من مخزن',
      intro: 'لكل مخزن رصيده. الجهاز بيبيع من مخزن واحد، وبتنقل البضاعة بين المخازن بتحويل.',
      steps: [
        'من «الأصناف ← المخازن» اضغط «مخزن جديد».',
        'حدد الجهاز ده هيبيع من أنهي مخزن («بيع من المخزن ده»).',
        'فاتورة الشراء بتختار المخزن اللي البضاعة هتدخله.',
        '«تحويل بين المخازن»: اختار من وإلى، وضيف الأصناف والكميات.',
      ],
      tips: ['الجرد بيتعمل لكل مخزن لوحده، وتقرير «الأرصدة حسب المخزن» بيعرض الكل.'],
    },
    en: {
      title: 'Several warehouses',
      intro: 'Each warehouse has its own stock; this computer sells from one and transfers move goods between them.',
      steps: ['Products → Warehouses → New warehouse.', 'Choose which warehouse this computer sells from ("Sell from here").', 'A purchase chooses the warehouse it goes into.', 'Transfer: pick from/to and add items and quantities.'],
      tips: ['Counts are per warehouse; the "Stock by warehouse" report shows them all.'],
    },
  },

  // ---------------- customers ----------------
  {
    id: 'customers', icon: '👥', group: 'customers', video: '02-credit-collect',
    ar: {
      title: 'العملاء والحسابات',
      intro: 'كل عميل له كشف حساب: فواتيره الآجل ودفعاته ورصيده.',
      steps: [
        'من «العملاء» اضغط «عميل جديد»: الاسم والتليفون والعنوان.',
        'حد الائتمان، ومدة السماح (بالأيام)، وخصم ثابت %، وقائمة أسعار. دي محتاجة صلاحية.',
        'افتح العميل عشان تشوف كشف الحساب، وتطبعه أو تبعته واتساب أو PDF.',
        '«أعمار الديون» بتعرض المتأخرين: 30 و60 و90 يوم وأكتر، مع تذكير واتساب.',
      ],
      tips: ['البحث بالاسم أو التليفون من أي شاشة فيها اختيار عميل.'],
    },
    en: {
      title: 'Customers and accounts',
      intro: 'Every customer has a statement: credit invoices, payments and balance.',
      steps: ['Customers → New customer: name, phone, address.', 'Credit limit, payment terms (days), standing discount % and price list need a permission.', 'Open the customer for the statement — print it, send it on WhatsApp or as PDF.', 'Aging lists overdue customers (30/60/90+) with a WhatsApp reminder.'],
      tips: ['Search by name or phone wherever you pick a customer.'],
    },
  },
  {
    id: 'collect', icon: '💵', group: 'customers', video: '02-credit-collect',
    ar: {
      title: 'التحصيل وسندات القبض والشيكات',
      intro: 'كل تحصيل من عميل بيطلع له سند قبض مرقّم.',
      steps: [
        'من العميل (أو من الفاتورة) اضغط «تحصيل من العميل».',
        'اختار الطريقة: كاش، أو فيزا، أو محفظة، أو تحويل بنكي، أو شيك (برقمه والبنك وتاريخه).',
        'التوزيع: تلقائي على الأقدم، أو اختار الفواتير بنفسك. وتقدر تعمل «خصم تسوية».',
        'لو دفع أكتر من اللي عليه، الزيادة بتفضل له رصيد مقدم.',
        '«الشيكات»: علّم الشيك «اتصرف» أو «مرتد». المرتد بيرجّع المبلغ على العميل.',
      ],
      tips: ['إلغاء سند قبض محتاج صلاحية وسبب، وبيتسجل في سجل النشاط.'],
    },
    en: {
      title: 'Collections, receipts and cheques',
      intro: 'Every payment from a customer gets a numbered receipt voucher.',
      steps: ['From the customer (or the invoice) press Collect.', 'Choose the method: cash, card, wallet, bank transfer or cheque (number, bank, date).', 'Allocation: oldest first, or pick invoices; a settlement discount is possible.', 'Paying more than owed leaves an advance.', 'Cheques: mark cleared or bounced — a bounced cheque goes back on the customer.'],
      tips: ['Voiding a receipt needs a permission and a reason and is logged.'],
    },
  },
  {
    id: 'promotions', icon: '🏷', group: 'customers', feature: 'promotions',
    ar: {
      title: 'العروض ونقاط الولاء',
      intro: 'عروض بتتطبق لوحدها في الكاشير، ونقاط بيجمعها العميل ويستخدمها.',
      steps: [
        'من «الإعدادات ← العروض» اعمل عرض: نسبة، أو مبلغ، أو «اشتري X وخد Y»، على كل الأصناف أو تصنيف أو صنف.',
        'حدد التواريخ والأيام والساعات (مثلاً عرض الساعة السعيدة).',
        'نقاط الولاء: فعّلها وحدد كل كام جنيه = نقطة، وقيمة النقطة، وأقل عدد للاستبدال.',
      ],
      tips: ['العرض بيظهر على سطر الصنف في الفاتورة وعلى الإيصال.'],
    },
    en: {
      title: 'Promotions and loyalty',
      intro: 'Promotions apply by themselves at the till; customers collect and spend points.',
      steps: ['Settings → Promotions: percent, amount or buy X get Y, on everything, a category or a product.', 'Set dates, days and hours (e.g. happy hour).', 'Loyalty: turn it on and set spend per point, point value and minimum to redeem.'],
      tips: ['The promotion shows on the cart line and the receipt.'],
    },
  },
  {
    id: 'coupons', icon: '🎟', group: 'customers', feature: 'coupons',
    ar: {
      title: 'الكوبونات وكروت الهدايا',
      intro: 'الكوبون كود خصم. وكارت الهدية رصيد مدفوع مقدماً، صاحبه بيشتري بيه.',
      steps: [
        'الكوبون: من «الإعدادات ← العروض ← كوبونات الخصم»: الكود، والنوع، والقيمة، والحد الأدنى، وعدد المرات، والتاريخ.',
        'في الكاشير: اضغط «الخصم» واكتب الكود.',
        'كارت الهدية: من «العملاء ← كروت الهدايا ← بيع كارت». الفلوس بتدخل الدرج، والكارت بيتطبع برقمه.',
        'الدفع بالكارت: في شاشة الدفع اضغط «الدفع بكارت هدية» واكتب رقمه، والباقي يتدفع كاش.',
      ],
      tips: ['تقدر تشحن رصيد للكارت أو توقفه من نفس الشاشة.'],
    },
    en: {
      title: 'Coupons and gift cards',
      intro: 'A coupon is a discount code; a gift card is a prepaid balance to shop with.',
      steps: ['Coupons: Settings → Promotions → Coupon codes (code, type, value, minimum, uses, dates).', 'At the till: tap Discount and type the code.', 'Gift card: Customers → Gift cards → Sell a card; money goes into the drawer and the card prints.', 'Paying: in the payment window choose "Pay with a gift card" and enter the number; the rest is cash.'],
      tips: ['Top up or block a card from the same screen.'],
    },
  },

  // ---------------- restaurant ----------------
  {
    id: 'restaurant', icon: '🍽', group: 'restaurant', feature: 'restaurant', video: '04-restaurant',
    ar: {
      title: 'الصالة والطاولات',
      intro: 'شاشة الصالة بتعرض كل الطاولات وحالتها والوقت والمبلغ.',
      steps: [
        'من «الصالة» دوس على طاولة فاضية، واكتب عدد الأفراد، وضيف الطلب.',
        '«إرسال للمطبخ» بيطبع تذكرة لكل قسم على طابعته، وبيظهر على شاشة المطبخ.',
        'طباعة الشيك (الحساب المبدئي)، ونقل الطاولة، ودمج طاولتين، وتقسيم الحساب.',
        'لما الزبون يدفع، الطاولة بتفضى.',
      ],
      tips: ['الطاولات والمناطق من «الإعدادات ← الطاولات».'],
    },
    en: {
      title: 'Floor and tables',
      intro: 'The floor shows every table with its status, time and amount.',
      steps: ['On the Floor tap a free table, enter guests and add the order.', 'Send to kitchen prints a ticket per station and shows it on the kitchen screen.', 'Print the check, move a table, merge two tables or split the bill.', 'Paying frees the table.'],
      tips: ['Tables and areas are under Settings → Tables.'],
    },
  },
  {
    id: 'kitchen', icon: '👨‍🍳', group: 'restaurant', feature: 'restaurant',
    ar: {
      title: 'المطبخ وشاشة المطبخ والأحجام والريسيبي',
      intro: 'أقسام المطبخ بطابعاتها، وشاشة للشيف، وأحجام وإضافات، وريسيبي بيخصم المكونات.',
      steps: [
        '«الإعدادات ← المطبخ والطابعات»: اعمل الأقسام (مشويات، بيتزا، بار…)، ولكل قسم طابعة، واربط التصنيفات بالأقسام.',
        'شاشة المطبخ: افتحها على نفس الجهاز، أو على تابلت من الرابط. الطلبات بتمشي: جديد ← بيتحضّر ← جاهز.',
        'الأحجام والإضافات: من «الأصناف ← الإضافات» اعمل المجموعات واربطها بالصنف.',
        'الريسيبي: في شاشة الصنف حدد المكونات وكمياتها. البيع بيخصم المكونات من المخزن.',
      ],
      tips: ['التابلت على الشبكة محتاج ميزة «تابلت على الشبكة» في الترخيص.'],
    },
    en: {
      title: 'Kitchen, kitchen screen, sizes and recipes',
      intro: 'Kitchen stations with printers, a screen for the chef, sizes/extras, and recipes that use up ingredients.',
      steps: ['Settings → Kitchen & printers: stations (grill, pizza, bar…), a printer each, categories mapped to stations.', 'Kitchen screen on this PC or a tablet via its link: New → Preparing → Ready.', 'Sizes and extras: Products → Modifiers, then attach groups to products.', 'Recipes: list ingredients on the product; selling consumes them.'],
      tips: ['Tablets on the network need the "LAN tablets" feature.'],
    },
  },
  {
    id: 'delivery', icon: '🛵', group: 'restaurant', feature: 'delivery',
    ar: {
      title: 'الدليفري والطيارين',
      intro: 'طلبات التوصيل بمناطق ورسوم، ولوحة بتتابع كل طلب لحد ما يتسلّم.',
      steps: [
        'من «التوصيل ← المناطق» حدد المناطق ورسوم كل منطقة، ومن «الطيارين» ضيف الطيارين.',
        'في الكاشير اختار «دليفري» والعميل والعنوان والمنطقة.',
        'من لوحة التوصيل: «تسليم لطيار»، وبعدين «اتسلّم + الدفع».',
        '«التسوية» آخر اليوم: كل طيار معاه كام كاش.',
      ],
      tips: [],
    },
    en: {
      title: 'Delivery and drivers',
      intro: 'Delivery orders with zones and fees, and a board that follows each order until delivered.',
      steps: ['Delivery → Zones (with fees) and Drivers.', 'At the till choose Delivery, the customer, address and zone.', 'On the board: Dispatch to a driver, then Delivered + pay.', 'Settlement at day end: how much cash each driver holds.'],
      tips: [],
    },
  },

  // ---------------- money ----------------
  {
    id: 'expenses', icon: '🧾', group: 'money',
    ar: {
      title: 'المصروفات',
      intro: 'أي فلوس طالعة غير المشتريات: إيجار، وكهرباء، ونقل…',
      steps: [
        'من «المشتريات ← المصروفات» اضغط «مصروف جديد»: البند والمبلغ والبيان.',
        '«من الدرج» بيتخصم من كاش الوردية. ولو من الخزنة أو البنك، اختار الحساب.',
        'المصروفات بتتخصم من صافي الربح في تقرير الأرباح والخسائر.',
      ],
      tips: [],
    },
    en: {
      title: 'Expenses',
      intro: 'Money out other than purchases: rent, electricity, transport…',
      steps: ['Purchases → Expenses → New expense: category, amount, notes.', '"From the drawer" comes out of the shift cash; otherwise choose a cash box or bank.', 'Expenses reduce net profit in the Profit & loss report.'],
      tips: [],
    },
  },
  {
    id: 'treasury', icon: '🏦', group: 'money', feature: 'treasury',
    ar: {
      title: 'الخزنة والبنوك',
      intro: 'خزن وحسابات بنكية، بكشف حساب لكل واحد وكل حركة فلوس.',
      steps: [
        'اعمل الخزن والحسابات برصيد البداية.',
        'التحصيل بالتحويل أو الفيزا بيدخل البنك. وسداد المورد والمصروف بيطلعوا من الحساب اللي تختاره.',
        '«تحويل بين الحسابات»، و«إيداع وسحب» بسبب.',
        '«الشيكات الصادرة»: علّم الشيك اتصرف عشان يتخصم من البنك.',
      ],
      tips: ['تقرير «حركة الخزن والبنوك»: رصيد أول الفترة، والداخل، والخارج، ورصيد آخرها.'],
    },
    en: {
      title: 'Treasury and banks',
      intro: 'Cash boxes and bank accounts, with a statement of every money movement.',
      steps: ['Create boxes and accounts with opening balances.', 'Transfer/card receipts go into the bank; supplier payments and expenses come out of the account you choose.', 'Transfers between accounts, and deposits/withdrawals with a reason.', 'Cheques issued: mark them cleared to charge the bank.'],
      tips: ['The "Cash boxes & banks" report shows opening, in, out and closing.'],
    },
  },
  {
    id: 'employees', icon: '🧑‍💼', group: 'money', feature: 'employees', video: '06-employees',
    ar: {
      title: 'الموظفين والحضور والمرتبات',
      intro: 'حضور وانصراف من شاشة البرنامج، وسلف ومكافآت وخصومات، وكشف مرتبات.',
      steps: [
        '«الموظفين ← الموظفين»: ضيف الموظف ومرتبه الشهري أو يوميته.',
        '«حضور النهارده»: كل موظف يدوس على اسمه وهو جاي وهو ماشي.',
        '«الحضور والغياب»: جدول الشهر، وتدوس على أي يوم تعدّله.',
        '«السلف والمكافآت»: السلفة بتطلع من الدرج أو الخزنة، وبتتخصم من المرتب.',
        '«المرتبات»: الصافي لكل موظف، و«صرف المرتب»، وطباعة الكشف.',
      ],
      tips: ['الغياب بيتخصم: المرتب ÷ 30 لكل يوم. والإجازة مدفوعة.'],
    },
    en: {
      title: 'Employees, attendance and payroll',
      intro: 'Check-in on the app, advances/bonuses/deductions and the payroll.',
      steps: ['Employees → Staff: add the employee with a monthly salary or day rate.', 'Today: each employee taps their name on arrival and when leaving.', 'Attendance: the month grid; click a day to edit it.', 'Advances & bonuses: an advance is paid from the drawer or a cash box and taken from the salary.', 'Payroll: net per employee, "Pay salary" and the printable sheet.'],
      tips: ['Absence costs salary ÷ 30 per day; leave is paid.'],
    },
  },
  {
    id: 'reports', icon: '📊', group: 'money', video: '07-reports',
    ar: {
      title: 'التقارير (إكسيل و PDF)',
      intro: 'أكتر من 30 تقرير: المبيعات، والأرباح، والمخزون، والمشتريات، والعملاء، والفلوس، والموظفين.',
      steps: [
        'من «التقارير» اختار الفترة: النهارده، أو إمبارح، أو الأسبوع، أو الشهر، أو الشهر اللي فات، أو السنة، أو من تاريخ لتاريخ.',
        'اختار التقرير من القائمة. «نظرة عامة» بتديك ملخص سريع.',
        'دوس على عنوان أي عمود عشان ترتّب بيه، واكتب في البحث عشان تفلتر.',
        '«Excel» بيحفظ ملف منسّق جاهز. و«PDF» بيحفظ نسخة للإرسال. و«طباعة» على الطابعة A4.',
      ],
      tips: ['أعمدة التكلفة والربح بتظهر بس للي عنده صلاحية «شوف التكلفة والأرباح».', 'لوحة التحكم (📈) بتديك صورة اليوم في ثانية.'],
    },
    en: {
      title: 'Reports (Excel and PDF)',
      intro: 'More than 30 reports: sales, profit, stock, purchases, customers, money and staff.',
      steps: ['On Reports pick the period: today, yesterday, week, month, last month, year or custom dates.', 'Pick a report from the list; Overview gives a quick summary.', 'Click a column title to sort; type in search to filter.', 'Excel saves a formatted file, PDF a copy to send, Print goes to the A4 printer.'],
      tips: ['Cost and profit columns appear only for users allowed to see cost.', 'The Dashboard (📈) shows the day at a glance.'],
    },
  },

  // ---------------- more ----------------
  {
    id: 'devices', icon: '🖨', group: 'more',
    ar: {
      title: 'الطابعات والدرج والميزان وشاشة العميل',
      intro: 'كل الأجهزة بتتظبط من الإعدادات.',
      steps: [
        '«الإعدادات ← الإيصال والطباعة»: طابعة الإيصال (80 أو 58 مم)، وطابعة A4، وشكل الفاتورة، والطباعة من غير سؤال.',
        '«الأجهزة»: درج الفلوس (متوصل بالطابعة)، وشاشة العميل، والميزان.',
        'الميزان اللي بيطبع ستيكر: فعّل قراءة الباركود واكتب البادئة. والميزان اللي متوصل بكابل: اختار المنفذ واضغط توصيل.',
      ],
      tips: ['جرّب كل جهاز من زرار «تجربة» قبل ما تبدأ شغل.'],
    },
    en: {
      title: 'Printers, drawer, scale and customer display',
      intro: 'All devices are set up in Settings.',
      steps: ['Settings → Receipt & printing: receipt printer (80/58 mm), A4 printer, invoice layout, silent printing.', 'Devices: cash drawer (via the printer), customer display, scales.', 'Label scale: turn on barcode reading and set the prefix; cable scale: pick the port and connect.'],
      tips: ['Test each device with its Test button before going live.'],
    },
  },
  {
    id: 'receiptDesign', icon: '🧾', group: 'more',
    ar: {
      title: 'تصميم الإيصال',
      intro: 'تختار إيه اللي يظهر في إيصال العميل، وتشوف شكله قبل ما تطبع.',
      steps: [
        'افتح «الإعدادات ← الإيصال والطباعة» وانزل لـ«تصميم الإيصال».',
        'شغّل أو اقفل أي جزء: الشعار، العنوان، التليفون، اسم الكاشير، بيانات العميل، تفاصيل الكمية × السعر، الإضافات، الباقي، رصيد العميل، نقاط الولاء…',
        'اكتب نص أعلى الإيصال وأسفله (ينفع أكتر من سطر)، وغيّر حجم الخط.',
        'ممكن تضيف QR لأي رابط (المنيو، صفحة إنستجرام، تقييم جوجل) وباركود لرقم الفاتورة يتقري في بحث الفواتير وقت المرتجع.',
        'المعاينة بتتغير مع كل اختيار. اضغط «تجربة طباعة» وبعدين «حفظ».',
      ],
      tips: [
        'اسم النشاط والرقم الضريبي ورقم الفاتورة والتاريخ والأصناف والإجماليات والضريبة بيظهروا دايماً، وفي السعودية كمان عنوان «فاتورة ضريبية» وQR فاتورة.',
        'الشعار على الإيصال الحراري بيتطبع أبيض وأسود؛ اختار شعار واضح من غير تفاصيل كتير.',
        'زرار «رجوع للتصميم الافتراضي» بيرجّع الأجزاء بس، ومش بيمسح النصوص ولا الشعار.',
      ],
    },
    en: {
      title: 'Receipt design',
      intro: 'Choose what the customer\'s receipt shows and see it before printing.',
      steps: [
        'Open Settings → Receipt & printing and scroll to "Receipt design".',
        'Switch any part on or off: logo, address, phone, cashier name, customer details, quantity × price details, add-ons, change, customer balance, loyalty points…',
        'Write the header and footer text (several lines are fine) and pick the font size.',
        'Add a QR for any link (menu, Instagram page, Google review) and a barcode of the invoice number that the invoice search reads when doing a return.',
        'The preview follows every change. Press "Test print", then "Save".',
      ],
      tips: [
        'The business name, tax number, invoice number, date, items, totals and VAT are always printed; in Saudi Arabia also the "Tax invoice" title and the FATOORA QR.',
        'Thermal printers print the logo in black and white; pick a clear logo without fine detail.',
        '"Back to the default design" only resets the parts; texts and logo are kept.',
      ],
    },
  },
  {
    id: 'country', icon: '🌍', group: 'money',
    ar: {
      title: 'الدولة: مصر أو السعودية أو الإمارات',
      intro: 'البرنامج واحد في التلات دول. الدولة بتحدد العملة ونسبة الضريبة وشكل الفاتورة ونظام الفاتورة الإلكترونية.',
      steps: [
        'في أول تشغيل اختار الدولة، أو بعدين من الإعدادات ← بيانات المنشأة ← الدولة.',
        'اختيار الدولة بيظبط العملة (جنيه / ريال / درهم) ونسبة الضريبة (السعودية 15%، الإمارات 5%). تقدر تعدّلهم.',
        'اكتب الرقم الضريبي من الإعدادات ← الضرائب: السعودي 15 رقم أوله وآخره 3، والإماراتي (TRN) 15 رقم.',
        'في السعودية والإمارات الإيصال والفاتورة بيطلعوا بعنوان «فاتورة ضريبية» بالعربي والإنجليزي، والفاتورة A4 فيها الضريبة لكل صنف.',
        'في السعودية الإيصال عليه QR «فاتورة» اللي تطبيق الهيئة بيقراه.',
      ],
      tips: [
        'لو الترخيص بتاعك لدولة معيّنة، الدولة بتبقى ثابتة ومش بتتغيّر.',
      ],
    },
    en: {
      title: 'Country: Egypt, Saudi Arabia or the UAE',
      intro: 'The same app works in all three countries. The country sets the currency, VAT rate, invoice layout and e-invoice system.',
      steps: [
        'Pick the country on first start, or later in Settings → Business → Country.',
        'Picking it sets the currency (EGP / SAR / AED) and VAT rate (Saudi 15%, UAE 5%). You can change them.',
        'Enter the VAT number in Settings → Taxes: Saudi 15 digits starting and ending with 3, UAE TRN 15 digits.',
        'In Saudi Arabia and the UAE receipts and invoices carry a bilingual "Tax Invoice" title, and A4 invoices show VAT per line.',
        'In Saudi Arabia receipts carry the FATOORA QR that ZATCA\'s app reads.',
      ],
      tips: [
        'When your license is for one country, the country is fixed.',
      ],
    },
  },
  {
    id: 'zatca', icon: '🇸🇦', group: 'money', feature: 'zatca',
    ar: {
      title: 'الفاتورة الإلكترونية السعودية (فاتورة — ZATCA)',
      intro: 'كل بيع بيتختم ساعة البيع بختم إلكتروني ويتربط بالفاتورة اللي قبله، والـ QR بيتطبع على الإيصال. البيع مش بيقف لو النت فاصل: الفواتير المبسطة بتتبلغ للهيئة لوحدها خلال 24 ساعة.',
      steps: [
        'الإعدادات ← بيانات المنشأة: الدولة = السعودية. والإعدادات ← الضرائب: الرقم الضريبي.',
        'الإعدادات ← فاتورة (ZATCA): اختار البيئة («تجربة المطورين» أو «المحاكاة» الأول) واكتب بيانات المنشأة زي السجل: الاسم، السجل التجاري، الشارع، رقم المبنى (4 أرقام)، الحي، المدينة، الرمز البريدي (5 أرقام).',
        'ادخل بوابة فاتورة (fatoora.zatca.gov.sa) ← تسجيل وحدة جديدة، واطلع رمز OTP. اكتبه واضغط «تسجيل الجهاز»: البرنامج بيعمل مفتاح الجهاز وطلب الشهادة ويبعت 6 فواتير فحص ويستلم الشهادة.',
        'شغّل «ختم الفواتير وإرسالها». من هنا ورايح كل بيع ومرتجع بيتختم ويظهر في صفحة «فاتورة (ZATCA)» بحالته.',
        'العميل الشركة: اكتب رقمه الضريبي وعنوانه كامل في بياناته، فياخد «فاتورة ضريبية» بتتعتمد من الهيئة، والـ QR بتاع الهيئة بيتطبع عليها.',
        'لو فاتورة اترفضت: السبب مكتوب جنبها. صلّحه واضغط «إصدار من جديد».',
        'لما كل حاجة تمشي على المحاكاة، غيّر البيئة لـ «الإنتاج» وسجّل الجهاز تاني برمز OTP من بوابة الإنتاج.',
      ],
      tips: [
        'مفتاح الجهاز بيتعمل جوه البرنامج ومبيطلعش منه، ومش محتاج USB Token.',
        'مع أكتر من جهاز: الختم والإرسال بيحصلوا على الجهاز الرئيسي (كله سلسلة واحدة).',
        'الفواتير اتفحصت بأداة الفحص الرسمية بتاعة الهيئة (SDK 238-R3.4.8)، بس لازم أول عميل يتجرب على المحاكاة قبل الإنتاج.',
      ],
    },
    en: {
      title: 'Saudi e-invoicing (FATOORA — ZATCA)',
      intro: 'Every sale is stamped at the moment of sale and chained to the previous invoice, and its QR is printed on the receipt. Selling never stops when the internet is down: simplified invoices are reported to ZATCA automatically within 24 hours.',
      steps: [
        'Settings → Business: country = Saudi Arabia. Settings → Taxes: the VAT number.',
        'Settings → FATOORA (ZATCA): pick the environment (developer sandbox or simulation first) and enter the business exactly as registered: name, commercial registration, street, building no. (4 digits), district, city, postal code (5 digits).',
        'In the FATOORA portal (fatoora.zatca.gov.sa) → onboard a new unit, get an OTP. Type it and press "Register device": the app creates the device key and certificate request, sends six compliance invoices and receives the certificate.',
        'Turn on "Stamp and send invoices". From then on every sale and return is stamped and shows on the FATOORA page with its status.',
        'Business customers: enter their VAT number and full address so they get a tax invoice cleared by ZATCA, printed with ZATCA\'s QR.',
        'If an invoice is rejected, the reason is shown next to it. Fix it and press "Issue again".',
        'Once everything works on simulation, switch to production and register the device again with an OTP from the production portal.',
      ],
      tips: [
        'The device key is made inside the app and never leaves it; no USB token is needed.',
        'With several computers, stamping and sending happen on the main computer (one chain).',
        "The invoices were checked with ZATCA's own validator (SDK 238-R3.4.8), but try the first customer on simulation before production.",
      ],
    },
  },
  {
    id: 'uae', icon: '🇦🇪', group: 'money', feature: 'uae_einvoice',
    ar: {
      title: 'الفاتورة الإلكترونية الإماراتية (للشركات)',
      intro: 'في الإمارات الفاتورة الإلكترونية إلزامية بين الشركات (من يناير 2027 للكبيرة ويوليو 2027 للباقي). البرنامج بيطلّع فاتورة كل شركة عندها رقم تسجيل ضريبي بصيغة PINT AE، ومزوّد الخدمة (ASP) اللي متعاقد معاه بيوصّلها.',
      steps: [
        'الإعدادات ← بيانات المنشأة: الدولة = الإمارات. والإعدادات ← الضرائب: رقم التسجيل الضريبي TRN (15 رقم).',
        'اتعاقد مع مزوّد خدمة معتمد (ASP) من قايمة وزارة المالية.',
        'الإعدادات ← الفاتورة الإلكترونية (الإمارات): الاسم القانوني، رقم الرخصة وجهتها، العنوان والإمارة، وطريقة التسليم: ملفات أو ربط مباشر بالـ API بتاع المزوّد.',
        'في بيانات كل عميل شركة: الرقم الضريبي والعنوان والإمارة.',
        'كل بيع أو مرتجع لعميل شركة بيظهر في صفحة «الفاتورة الإلكترونية (الإمارات)». في وضع الملفات اضغط «حفظ الملفات المستنية» وارفعهم على بوابة المزوّد.',
      ],
      tips: [
        'البيع للأفراد مش بيطلع له فاتورة إلكترونية (خارج الإلزام حالياً).',
        'الصيغة مبنية على المواصفات المنشورة، وأول فواتير لازم تتجرب على نظام الاختبار عند المزوّد.',
      ],
    },
    en: {
      title: 'UAE e-invoicing (business customers)',
      intro: 'In the UAE e-invoicing is mandatory between businesses (from January 2027 for large ones, July 2027 for the rest). The app produces a PINT AE invoice for every customer with a tax registration number, and your service provider (ASP) delivers it.',
      steps: [
        'Settings → Business: country = UAE. Settings → Taxes: the tax registration number (TRN, 15 digits).',
        "Sign up with an Accredited Service Provider (ASP) from the Ministry of Finance's list.",
        "Settings → E-invoice (UAE): legal name, trade license and authority, address and emirate, and the hand-over: files, or a direct API connection to the provider.",
        'On each business customer: the VAT number, address and emirate.',
        'Every sale or return to a business shows on the "E-invoice (UAE)" page. In file mode press "Save waiting files" and upload them to the provider\'s portal.',
      ],
      tips: [
        'Consumer sales get no e-invoice (outside the mandate for now).',
        "The format follows the published specification; try the first invoices on the provider's test system.",
      ],
    },
  },
  {
    id: 'eta', icon: '🏛', group: 'money', feature: 'eta',
    ar: {
      title: 'الفاتورة والإيصال الإلكتروني (الضرائب)',
      intro: 'البرنامج بيبعت فواتيرك لمنظومة الفاتورة الإلكترونية والإيصال الإلكتروني بتاعة مصلحة الضرائب لوحده في الخلفية. البيع عمره ما بيقف لو النت فاصل: المستندات بتستنى وتتبعت أول ما النت يرجع.',
      steps: [
        'سجّل الشركة على بوابة المنظومة (invoicing.eta.gov.eg)، وسجّل «نظام ERP» عشان تاخد Client ID و Client Secret للفواتير، وسجّل كل جهاز كاشير كـ POS للإيصالات.',
        'الإعدادات ← الفاتورة الإلكترونية: فعّلها واختار «تجربة»، وحدد فواتير (للشركات) و/أو إيصالات (للأفراد).',
        'اكتب بيانات الشركة: رقم التسجيل الضريبي، كود النشاط، كود الفرع، والعنوان (محافظة، مدينة، شارع، رقم مبنى).',
        'اكتب Client ID و Secret. للفواتير: ركّب برنامج التوقيع بتاع الـ USB Token واختار طريقته (عنوان أو أمر). للإيصالات: اكتب سيريال الجهاز وبيانات الـ POS على كل جهاز كاشير.',
        'اكتب الكود الافتراضي للأصناف (EGS أو GS1)، وكود لكل صنف من شاشة الصنف لو مختلف. للعملاء الشركات اكتب الرقم الضريبي والعنوان في بيانات العميل.',
        'اضغط «اختبر الدخول» و«معاينة آخر فاتورة». بعد كده كل بيع بيظهر في صفحة «الفاتورة الإلكترونية» بحالته: في الانتظار، اتبعت، صالح، أو مرفوض بالسبب.',
        'لو مستند اترفض: صلّح السبب (كود صنف، عنوان، رقم ضريبي…) واضغط «ابعت تاني». المرتجعات بتطلع لوحدها كإشعار دائن أو إيصال مرتجع.',
        'لما كل حاجة تطلع «صالح» على التجربة، حوّل البيئة لـ «فعلي».',
      ],
      tips: [
        'بيانات الدخول (Secret والمفتاح المشترك) بتتحفظ ومش بتظهر تاني على الشاشة.',
        'مع أكتر من جهاز: الإرسال بيحصل من الجهاز الرئيسي، وكل جهاز كاشير بيتسجل كـ POS ببياناته.',
        'الربط مكتوب حسب مواصفات المنظومة المنشورة، ولازم يتجرب على بيئة التجربة لكل عميل قبل التشغيل الفعلي.',
      ],
    },
    en: {
      title: 'E-invoice and e-receipt (tax authority)',
      intro: 'The app sends your invoices to the Egyptian Tax Authority e-invoice and e-receipt systems by itself in the background. Selling never stops when the internet is down: documents wait and go out when it is back.',
      steps: [
        'Register the company on the ETA portal (invoicing.eta.gov.eg), register an ERP system to get the invoice Client ID and Secret, and register every till as a POS for receipts.',
        'Settings → E-invoice: turn it on, choose Pre-production, and pick invoices (companies) and/or receipts (individuals).',
        'Enter the company details: tax registration number, activity code, branch code and address (governorate, city, street, building).',
        'Enter the Client ID and Secret. Invoices: install the USB-token signer and choose how to reach it (URL or command). Receipts: enter the POS serial and credentials on each till.',
        'Enter the default item code (EGS or GS1), and a code per item on the product screen when different. For company customers enter the tax number and address on the customer.',
        'Press “Test login” and “Preview the last sale”. From then on every sale shows on the E-invoice page with its status: waiting, sent, valid, or rejected with the reason.',
        'If a document is rejected, fix the reason (item code, address, tax number…) and press “Send again”. Returns go out by themselves as credit notes or return receipts.',
        'Once everything comes back Valid on pre-production, switch the environment to Production.',
      ],
      tips: [
        'Secrets and the pre-shared key are stored and never shown again.',
        'With several computers the main computer sends everything; each till is registered as its own POS.',
        'The integration follows ETA\'s published specification and must be tried on pre-production for every customer before going live.',
      ],
    },
  },
  {
    id: 'network', icon: '🖧', group: 'more',
    ar: {
      title: 'أكتر من جهاز والفروع',
      intro: 'تقدر تشغّل أكتر من كاشير (أو فرع) على نفس البيانات: جهاز واحد بيبقى «الجهاز الرئيسي» وعليه البيانات، والباقي بيتصلوا بيه. المخزون والفواتير والعملاء والحسابات واحدة على كل الأجهزة.',
      steps: [
        'على الجهاز اللي عليه البيانات: الإعدادات ← الشبكة والفروع ← فعّل «الأجهزة التانية تقدر تتصل بالجهاز ده». هيظهرلك العنوان (زي 192.168.1.10:7790) ومفتاح الاتصال.',
        'لو الويندوز سأل عن الجدار الناري (Firewall) اختار «سماح» عشان الأجهزة التانية تقدر توصل.',
        'على كل جهاز تاني: من شاشة التفعيل أو أول تشغيل أو الإعدادات ← الشبكة اضغط «اتصل بجهاز رئيسي»، واكتب العنوان والمفتاح واسم للجهاز (زي كاشير 2). البرنامج هيعيد التشغيل ويشتغل على بيانات الرئيسي.',
        'كل جهاز ليه الطابعات والدرج والميزان وشاشة العميل والمخزن اللي بيبيع منه، ووردية الكاشير بتاعته. الإعدادات العامة (الأسعار والضريبة واسم النشاط) واحدة.',
        'الفروع البعيدة: ركّب Tailscale (مجاني) على الجهاز الرئيسي وأجهزة الفرع، واستخدم عنوان Tailscale بتاع الرئيسي (100.x.x.x). كل فرع اعمله مخزن، واختاره في «المخزن اللي بيبيع منه» على أجهزة الفرع.',
        'من نفس الشاشة على الرئيسي تشوف الأجهزة المتصلة وآخر ظهور، وتقدر تغيّر اسم جهاز أو تمنعه فورًا.',
      ],
      tips: [
        'الجهاز الرئيسي لازم يفضل شغال والبرنامج مفتوح طول ما الأجهزة التانية شغالة. لو وقع، الأجهزة هتظهر رسالة «مش قادر أوصل للجهاز الرئيسي».',
        'عدد الأجهزة المسموح بيه (شامل الرئيسي) مكتوب في الترخيص. النسخ الاحتياطي بيتعمل على الجهاز الرئيسي بس.',
        'خلي كل الأجهزة على نفس إصدار البرنامج.',
      ],
    },
    en: {
      title: 'Several computers and branches',
      intro: 'Several tills (or branches) can work on the same data: one computer is the “main computer” and keeps the data, the others connect to it. Stock, invoices, customers and accounts are the same on all of them.',
      steps: [
        'On the computer that has the data: Settings → Network & branches → turn on “Other computers may connect to this one”. The address (e.g. 192.168.1.10:7790) and the connection key are shown.',
        'If Windows asks about the firewall, choose “Allow” so the other computers can reach it.',
        'On every other computer: from the activation or first-run screen, or Settings → Network, press “Connect to a main computer”, enter the address, the key and a name (e.g. Till 2). The app restarts on the main computer\'s data.',
        'Each computer keeps its own printers, drawer, scale, customer display and selling warehouse, and its own cashier shift. Shared settings (prices, tax, business name) are the same everywhere.',
        'Remote branches: install Tailscale (free) on the main computer and the branch computers and use the main computer\'s Tailscale address (100.x.x.x). Make each branch a warehouse and choose it as the selling warehouse on that branch\'s computers.',
        'On the main computer the same screen lists the connected computers with when they were last seen; rename or block one at once.',
      ],
      tips: [
        'The main computer must stay on with the app open while the others work. If it goes down they show “Can\'t reach the main computer”.',
        'How many computers are allowed (including the main one) is part of the license. Backups are made on the main computer only.',
        'Keep every computer on the same app version.',
      ],
    },
  },
  {
    id: 'excel', icon: '📥', group: 'more',
    ar: {
      title: 'الإكسيل: رفع وتنزيل',
      intro: 'ترفع الأصناف والعملاء والموردين من شيت، وتنزّل أي بيانات أو تقارير.',
      steps: [
        'اضغط «استيراد» في الأصناف أو العملاء أو الموردين، ونزّل «النموذج» واملاه.',
        'اختار الملف، وراجع المعاينة (السطور اللي فيها مشاكل بتظهر)، واعتمد.',
        '«تصدير» بينزّل القائمة كلها إكسيل. وكل التقارير بتتصدّر من شاشة التقارير.',
      ],
      tips: ['الاستيراد بيحدّث الصنف لو الباركود موجود قبل كده، ويضيفه لو جديد.'],
    },
    en: {
      title: 'Excel import and export',
      intro: 'Import products, customers and suppliers from a sheet; export any list or report.',
      steps: ['Press Import on Products / Customers / Suppliers and download the template to fill.', 'Choose the file, review the preview (rows with problems are shown) and confirm.', 'Export downloads the list; every report exports from the Reports page.'],
      tips: ['Import updates a product when its barcode already exists and adds it otherwise.'],
    },
  },
  {
    id: 'backup', icon: '💾', group: 'more',
    ar: {
      title: 'النسخ الاحتياطي والتحديثات',
      intro: 'بياناتك كلها في ملف واحد على الجهاز. البرنامج بياخد نسخة كل يوم ونسخة قبل كل تحديث.',
      steps: [
        '«الإعدادات ← البيانات»: «نسخة احتياطية» تحفظ نسخة في المكان اللي تختاره (فلاشة مثلاً).',
        '«استرجاع» يرجّع نسخة قديمة، والبرنامج بيعيد التشغيل.',
        'التحديثات بتنزل لوحدها لما يكون فيه نت، وبتتسطب لما تعيد التشغيل.',
      ],
      tips: ['خد نسخة على فلاشة كل أسبوع، واحفظها برا المحل.', 'البرنامج شغال من غير نت، ولو الكهرباء قطعت البيانات مش بتضيع.'],
    },
    en: {
      title: 'Backups and updates',
      intro: 'All your data is one file on this computer; the app copies it daily and before every update.',
      steps: ['Settings → Data → Backup saves a copy where you choose (e.g. a USB stick).', 'Restore brings back an older copy and restarts.', 'Updates download by themselves when online and install on restart.'],
      tips: ['Copy a backup to a USB stick weekly and keep it off-site.', 'Works offline; a power cut does not lose data.'],
    },
  },
  {
    id: 'license', icon: '🔑', group: 'more',
    ar: {
      title: 'الترخيص والترقية',
      intro: 'الترخيص لجهاز واحد، وفيه الباقة والمميزات والحدود.',
      steps: [
        '«الإعدادات ← الترخيص»: باقتك، وكل ميزة (✓ موجودة، 🔒 مش في باقتك)، وعدد المستخدمين والمخازن، وتاريخ الانتهاء.',
        'عايز ميزة أو ترقية؟ ابعت رقم الجهاز لـ Inno Source، وهيوصلك مفتاح جديد.',
        'اضغط «تحديث المفتاح» والصقه. الميزة بتتفتح على طول، وبياناتك زي ما هي.',
      ],
      tips: ['جهاز جديد أو إعادة تسطيب ويندوز: رقم الجهاز بيتغير، فاطلب مفتاح جديد ورجّع النسخة الاحتياطية.'],
    },
    en: {
      title: 'License and upgrades',
      intro: 'The license is for one computer and carries your edition, features and limits.',
      steps: ['Settings → License: your edition, every feature (✓ included, 🔒 not), users and warehouses allowed, expiry.', 'Want a feature or an upgrade? Send the Machine ID to Inno Source for a new key.', 'Press Update key and paste it — features unlock at once, data unchanged.'],
      tips: ['New PC or Windows reinstall changes the Machine ID: ask for a new key and restore your backup.'],
    },
  },
  {
    id: 'faq', icon: '❓', group: 'more',
    ar: {
      title: 'مشاكل شائعة',
      intro: 'حلول سريعة لأكتر الأسئلة.',
      steps: [
        'الطابعة مش بتطبع: اتأكد إنها مختارة في «الإيصال والطباعة» وإنها شغالة في ويندوز، وجرّب «طباعة تجربة».',
        '«مفيش وردية مفتوحة»: افتح وردية من «الوردية».',
        '«محتاج موافقة»: العملية دي محتاجة صلاحية أكبر. اطلب من المشرف يكتب رقمه السري.',
        '«الميزة دي مش ضمن نسختك»: شوف «الإعدادات ← الترخيص» وكلّم Inno Source.',
        'الباركود مش بيقرا: جرّب في خانة البحث، واتأكد إن الماسح بيبعت Enter بعد الكود.',
        'نسيت الرقم السري: مستخدم مدير تاني يقدر يغيّره من «المستخدمين». ولو مفيش، كلّم الدعم.',
      ],
      tips: ['الدعم الفني: «الإعدادات ← الدعم الفني»، وفيها الأرقام وواتساب.'],
    },
    en: {
      title: 'Common problems',
      intro: 'Quick answers to the most frequent questions.',
      steps: ['Printer does not print: check it is selected in Receipt & printing and works in Windows; try a test print.', '"No open shift": open one on Shift.', '"Approval required": the action needs a higher permission — ask a supervisor for their PIN.', '"Not in your edition": see Settings → License and contact Inno Source.', 'Barcode not read: try it in the search box; the scanner must send Enter after the code.', 'Forgotten PIN: another admin can change it under Users; otherwise contact support.'],
      tips: ['Support: Settings → Support (phones and WhatsApp).'],
    },
  },
];
