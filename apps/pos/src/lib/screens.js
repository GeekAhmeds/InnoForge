// Selling screens a business can turn on: the quick cashier, the restaurant floor
// (tables) and the trading invoice (B2B). Each one is its own page in the sidebar.
import { has } from './features.js';

export const SCREENS = [
  { id: 'cashier', page: 'pos', icon: '🛒' },
  { id: 'restaurant', page: 'floor', icon: '🍽', feature: 'restaurant' },
  { id: 'trading', page: 'invoice', icon: '📄', feature: 'trading' },
];

const DEFAULTS = { restaurant: ['restaurant', 'cashier'], trading: ['trading', 'cashier'] };

// Screens the license does not include are left out (the cashier is always there).
const licensed = (id) => has(SCREENS.find((s) => s.id === id)?.feature);

export function sellScreens(settings) {
  const chosen = String(settings.sell_screens || '').split(',').filter((x) => SCREENS.some((s) => s.id === x));
  const list = (chosen.length ? chosen : DEFAULTS[settings.business_type] || ['cashier']).filter(licensed);
  return list.length ? list : ['cashier'];
}

/** The page a user lands on: the first enabled selling screen. */
export const homePage = (settings) => SCREENS.find((s) => s.id === sellScreens(settings)[0]).page;
