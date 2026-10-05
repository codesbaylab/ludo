import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { derivePath } from 'ed25519-hd-key';
import * as bip39 from 'bip39';

// USDT (SPL) on Solana mainnet. Any transfer the watcher sees that isn't of THIS exact mint is ignored,
// however convincing its name/symbol look. Overridable to rehearse on devnet with a test mint.
export const USDT_MINT = process.env.USDT_MINT_OVERRIDE?.trim() || 'Es9vMFrzaCERmJfrF4H2FYD4KCoNyPNvBMNe8Ve1P9ES';
export const USDT_DECIMALS = 6;

// The public mainnet RPC is rate-limited; set SOLANA_RPC_URL to a free-tier provider (Helius, QuickNode...) in production.
export const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL?.trim() || 'https://api.mainnet-beta.solana.com';

let conn: Connection | null = null;
export function getConnection(): Connection {
  return (conn ??= new Connection(SOLANA_RPC_URL, 'finalized'));
}

// Phantom-style path: m/44'/501'/{index}'/0' (SLIP-0010 ed25519, all hardened). One address per user,
// index assigned once via next_crypto_deposit_index() and never reused. Index 0 = the gas wallet.
function derivationPath(index: number): string {
  return `m/44'/501'/${index}'/0'`;
}

// The ONLY place the master seed is read. Never logged or stored; every key is re-derivable from seed + index.
// SOLANA_MASTER_SEED is preferred; TRON_MASTER_SEED is accepted so the same phrase keeps working.
function getMasterMnemonic(): string | null {
  const m = (process.env.SOLANA_MASTER_SEED || process.env.TRON_MASTER_SEED || '').trim();
  return m || null;
}

export function cryptoDepositsEnabled(): boolean {
  return getMasterMnemonic() !== null;
}

// Pure, deterministic, offline.
export function deriveSolanaKeypair(index: number): Keypair {
  const mnemonic = getMasterMnemonic();
  if (!mnemonic) throw new Error('SOLANA_MASTER_SEED is not set — crypto deposits are disabled');
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  return Keypair.fromSeed(derivePath(derivationPath(index), seed.toString('hex')).key);
}

export function deriveSolanaAddress(index: number): string {
  return deriveSolanaKeypair(index).publicKey.toBase58();
}

/** The address's USDT token account (deterministic even before it exists on-chain). */
export function usdtTokenAccount(owner: string): PublicKey {
  return getAssociatedTokenAddressSync(new PublicKey(USDT_MINT), new PublicKey(owner));
}
