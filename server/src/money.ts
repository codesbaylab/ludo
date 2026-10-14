// Wallet amounts are dollars (1 USDT = $1) with cent precision; round every computed amount so float noise never reaches the ledger.
export const r2 = (x: number): number => Math.round(x * 100) / 100;
export const floor2 = (x: number): number => Math.floor(x * 100 + 1e-9) / 100;
