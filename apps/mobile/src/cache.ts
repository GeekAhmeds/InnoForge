// Last good result per key, so switching tabs shows data instantly while it refreshes.
export const dataCache = new Map<string, unknown>()
export const clearDataCache = (): void => dataCache.clear()
