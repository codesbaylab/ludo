import { HDNodeWallet, JsonRpcProvider, Mnemonic, getAddress } from 'ethers';

// BNB Smart Chain (BEP20) USDT is the only accepted deposit/withdrawal coin. Any transfer from another token contract is
// ignored, however convincing its name looks. USDT on BSC has 18 decimals (not 6 like on Solana/Tron).
// BSC_USDT_OVERRIDE / BSC_RPC_URL exist only to rehearse on testnet.
export const USDT_CONTRACT = (process.env.BSC_USDT_OVERRIDE?.trim() || '0x55d398326f99059fF775485246999027B3197955').toLowerCase();
export const USDT_DECIMALS = 18;
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// The public node is rate-limited; set BSC_RPC_URL to a provider URL (Ankr, QuickNode, NodeReal...) in production.
export const BSC_RPC_URL = process.env.BSC_RPC_URL?.trim() || 'https://bsc-dataseed.bnbchain.org';

let provider: JsonRpcProvider | null = null;
export function getProvider(): JsonRpcProvider {
  return (provider ??= new JsonRpcProvider(BSC_RPC_URL, undefined, { staticNetwork: true }));
}

// m/44'/60'/0'/0/{index}. One address per user, index assigned once via next_crypto_deposit_index() and never reused.
// Index 0 = the gas wallet (holds BNB to pay for sweeps).
function derivationPath(index: number): string {
  return `m/44'/60'/0'/0/${index}`;
}

// The ONLY place the master seed is read. Never logged or stored; every key is re-derivable from seed + index.
// BSC_MASTER_SEED is preferred; SOLANA_MASTER_SEED / TRON_MASTER_SEED are accepted so an existing phrase keeps working.
function getMasterMnemonic(): string | null {
  const m = (process.env.BSC_MASTER_SEED || process.env.SOLANA_MASTER_SEED || process.env.TRON_MASTER_SEED || '').trim();
  return m || null;
}

export function cryptoDepositsEnabled(): boolean {
  return getMasterMnemonic() !== null;
}

// Pure, deterministic, offline.
export function deriveWallet(index: number): HDNodeWallet {
  const mnemonic = getMasterMnemonic();
  if (!mnemonic) throw new Error('BSC_MASTER_SEED is not set — crypto deposits are disabled');
  return HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(mnemonic), derivationPath(index));
}

export function deriveBscAddress(index: number): string {
  return deriveWallet(index).address; // EIP-55 checksummed
}

export const isBscAddress = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);
export const checksum = (a: string) => getAddress(a);
