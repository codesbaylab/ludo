import { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '../supabase';
import { USDT_MINT, USDT_DECIMALS, cryptoDepositsEnabled, getConnection, usdtTokenAccount } from './solana';

// Deposits are detected by watching each user's USDT token account (the associated token account of their
// deposit address). Only FINALIZED transactions are read, so nothing can be reorged away after crediting.
const ASSUMED_CONFIRMATIONS = 32;

// Transfers smaller than this are ignored entirely (dust / spam would otherwise show as empty deposits).
const MIN_DEPOSIT_USDT = Number(process.env.MIN_DEPOSIT_USDT) > 0 ? Number(process.env.MIN_DEPOSIT_USDT) : 1;

const POLL_INTERVAL_MS = 30_000;
// Caps concurrent addresses per tick to stay inside RPC rate limits.
const POLL_CONCURRENCY = 3;
const SIGNATURE_LIMIT = 25;

interface SolTransfer {
  signature: string;
  amountUsdt: number;
}

/** Net USDT received by `owner` in one parsed transaction (post - pre of their USDT balance; 0 if none). */
export function usdtReceived(tx: any, owner: string): number {
  const meta = tx?.meta;
  if (!meta || meta.err) return 0;
  const sum = (list: any[] | null | undefined) =>
    (list ?? [])
      .filter((b) => b.mint === USDT_MINT && b.owner === owner)
      .reduce((acc, b) => acc + Number(b.uiTokenAmount?.amount ?? 0), 0);
  const delta = sum(meta.postTokenBalances) - sum(meta.preTokenBalances);
  return delta > 0 ? delta / 10 ** USDT_DECIMALS : 0;
}

async function fetchTransfersTo(supabase: SupabaseClient, address: string): Promise<SolTransfer[]> {
  const conn = getConnection();
  const sigs = await conn.getSignaturesForAddress(usdtTokenAccount(address), { limit: SIGNATURE_LIMIT }, 'finalized');
  const fresh = sigs.filter((s) => !s.err).map((s) => s.signature);
  if (fresh.length === 0) return [];
  // Skip transactions already credited, so a steady-state poll costs one DB query, not N RPC calls.
  const { data } = await supabase.from('crypto_deposits').select('tx_hash').in('tx_hash', fresh);
  const known = new Set((data ?? []).map((r) => r.tx_hash as string));
  const out: SolTransfer[] = [];
  for (const signature of fresh) {
    if (known.has(signature)) continue;
    const tx = await conn.getParsedTransaction(signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
    const amountUsdt = usdtReceived(tx, address);
    if (amountUsdt > 0) out.push({ signature, amountUsdt });
  }
  return out;
}

export interface KnownAddress {
  userId: string;
  address: string;
}

async function loadKnownAddresses(supabase: SupabaseClient): Promise<KnownAddress[]> {
  const { data, error } = await supabase.from('crypto_deposit_addresses').select('user_id, address').eq('chain', 'solana');
  if (error) {
    console.error('[crypto-watcher] failed to load deposit addresses:', error);
    return [];
  }
  return (data ?? []).map((row) => ({ userId: row.user_id as string, address: row.address as string }));
}

async function loadUsdtInrRate(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase.from('crypto_settings').select('usdt_inr_rate').eq('id', true).single();
  if (error || !data) {
    console.error('[crypto-watcher] failed to load USDT/INR rate, defaulting to 90:', error);
    return 90;
  }
  return Number(data.usdt_inr_rate);
}

export async function processAddress(supabase: SupabaseClient, known: KnownAddress, rate: number): Promise<void> {
  let transfers: SolTransfer[];
  try {
    transfers = await fetchTransfersTo(supabase, known.address);
  } catch (err) {
    console.error(`[crypto-watcher] failed to fetch transfers for ${known.address}:`, err);
    return;
  }

  for (const transfer of transfers) {
    if (!(transfer.amountUsdt >= MIN_DEPOSIT_USDT)) continue;

    // credit_crypto_deposit is idempotent on tx_hash, so re-seeing a transfer is a costless no-op.
    const { data, error } = await supabase.rpc('credit_crypto_deposit', {
      p_user_id: known.userId,
      p_tx_hash: transfer.signature,
      p_address: known.address,
      p_amount_usdt: transfer.amountUsdt,
      p_rate: rate,
      p_confirmations: ASSUMED_CONFIRMATIONS,
    });

    if (error) {
      console.error(`[crypto-watcher] credit_crypto_deposit failed for tx ${transfer.signature}:`, error);
      continue;
    }
    const result = Array.isArray(data) ? data[0] : data;
    if (result?.credited) {
      console.log(
        `[crypto-watcher] credited ${transfer.amountUsdt} USDT (~₹${(transfer.amountUsdt * rate).toFixed(2)}) ` +
        `to user ${known.userId} (tx ${transfer.signature})`
      );
    }
  }
}

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let stopped = false;

// Read by the admin System page (GET /api/admin/status).
const watcherStatus = { enabled: false, lastTickAt: 0, lastOk: false, lastError: '', addresses: 0, ticks: 0 };
export function getWatcherStatus() { return { ...watcherStatus }; }

export function startDepositWatcher(): void {
  if (!cryptoDepositsEnabled()) {
    console.warn('[crypto-watcher] SOLANA_MASTER_SEED not set — USDT deposit watching disabled.');
    return;
  }
  const supabase = getSupabase();
  if (!supabase) {
    console.warn('[crypto-watcher] Supabase not configured — USDT deposit watching disabled.');
    return;
  }

  stopped = false;
  watcherStatus.enabled = true;

  const tick = async () => {
    try {
      const [addresses, rate] = await Promise.all([loadKnownAddresses(supabase), loadUsdtInrRate(supabase)]);
      watcherStatus.addresses = addresses.length;
      for (let i = 0; i < addresses.length; i += POLL_CONCURRENCY) {
        const batch = addresses.slice(i, i + POLL_CONCURRENCY);
        await Promise.all(batch.map((addr) => processAddress(supabase, addr, rate)));
      }
      watcherStatus.lastOk = true;
      watcherStatus.lastError = '';
    } catch (err) {
      watcherStatus.lastOk = false;
      watcherStatus.lastError = String((err as Error)?.message ?? err).slice(0, 200);
      console.error('[crypto-watcher] poll tick failed:', err);
    } finally {
      watcherStatus.lastTickAt = Date.now();
      watcherStatus.ticks++;
      if (!stopped) pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
    }
  };

  console.log(`[crypto-watcher] started (polling every ${POLL_INTERVAL_MS / 1000}s, mint ${USDT_MINT})`);
  tick();
}

export function stopDepositWatcher(): void {
  stopped = true;
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}
