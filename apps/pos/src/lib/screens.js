// Selling screens a business can turn on: the quick cashier, the restaurant floor
// (tables) and the trading invoice (B2B). Each one is its own page in the sidebar.
export const SCREENS = [
  { id: 'cashier', page: 'pos', icon: '🛒' },
  { id: 'restaurant', page: 'floor', icon: '🍽' },
  { id: 'trading', page: 'invoice', icon: '📄' },
];

const DEFAULTS = { restaurant: ['restaurant', 'cashier'], trading: ['trading', 'cashier'] };

export function sellScreens(settings) {
  const chosen = String(settings.sell_screens || '').split(',').filter((x) => SCREENS.some((s) => s.id === x));
  return chosen.length ? chosen : DEFAULTS[settings.business_type] || ['cashier'];
}

/** The page a user lands on: the first enabled selling screen. */
export const homePage = (settings) => SCREENS.find((s) => s.id === sellScreens(settings)[0]).page;
