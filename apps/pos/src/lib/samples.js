// Starter catalogs so a fresh install can be tried immediately.
// Prices are in major units here and converted on insert.
const SAMPLES = {
  retail: [
    ['مشروبات', '#0ea5e9', [['مياه معدنية 600مل', 7, 5, '6221000000011'], ['بيبسي كانز', 15, 11, '6221000000028'], ['عصير مانجو', 12, 9, '6221000000035']]],
    ['سناكس', '#f59e0b', [['شيبسي كبير', 15, 11, '6221000000042'], ['بسكويت شاي', 5, 3.5, '6221000000059'], ['شوكولاتة', 20, 15, '6221000000066']]],
    ['منظفات', '#10b981', [['صابون سائل', 45, 35, '6221000000073'], ['مناديل', 25, 18, '6221000000080']]],
  ],
  bookstore: [
    ['كتب', '#8b5cf6', [['رواية — مثال', 180, 120, '9789770000011', 'نجيب محفوظ'], ['كتاب تنمية بشرية', 150, 100, '9789770000028', 'مؤلف تجريبي']]],
    ['أدوات مكتبية', '#0ea5e9', [['كشكول 100 ورقة', 35, 25, '6221000001001'], ['قلم جاف أزرق', 6, 4, '6221000001018'], ['أستيكة', 4, 2, '6221000001025'], ['مسطرة 30سم', 10, 6, '6221000001032']]],
  ],
  restaurant: [
    ['ساندويتشات', '#ef4444', [['برجر كلاسيك', 120, 60], ['تشيكن كرسبي', 110, 55], ['شاورما فراخ', 85, 40]]],
    ['أطباق', '#f59e0b', [['وجبة فراخ مشوية', 220, 120], ['مكرونة بشاميل', 90, 40]]],
    ['مشروبات', '#0ea5e9', [['شاي', 20, 5], ['قهوة تركي', 35, 10], ['عصير برتقال فريش', 45, 15], ['مياه', 10, 5]]],
    ['حلويات', '#ec4899', [['كنافة', 60, 25], ['أم علي', 55, 20]]],
  ],
};

export async function seedSamples(api, type, decimals = 2) {
  const f = 10 ** decimals;
  const restaurant = type === 'restaurant';
  for (const [sort, [name, color, items]] of (SAMPLES[type] || SAMPLES.retail).entries()) {
    const category_id = await api.categories.save({ name, color, sort });
    for (const [pname, price, cost, barcode, author] of items) {
      await api.products.save({
        name: pname, price: Math.round(price * f), cost: Math.round(cost * f), barcode, author, category_id,
        track_stock: !restaurant, stock: restaurant ? 0 : 50, min_stock: restaurant ? 0 : 5, kitchen: restaurant && name !== 'مشروبات',
      });
    }
  }
}
