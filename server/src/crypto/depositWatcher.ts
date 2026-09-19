import { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '../supabase';
import { USDT_CONTRACT_ADDRESS, cryptoDepositsEnabled } from './tron';

// api.trongrid.io could not be reached from this project's own dev sandbox
// (network policy blocks it — only a handful of package registries are
// allowlisted there) so this integration is written against TronGrid's
// documented API shape but has NOT been exercised against a real response.
// Rehearse this end-to-end against Shasta/Nile testnet (see
// server/README.md "Crypto deposits") before trusting it with real funds.
const TRONGRID_API_BASE = process.env.TRONGRID_API_BASE?.trim() || 'https://api.trongrid.io';

// TronGrid's own confirmed-transaction filter (only_confirmed=true) queries
// its "solidity" node, which only ever exposes blocks Tron's own consensus
// already considers irreversible — roughly 19 blocks / ~1 minute behind the
// chain tip. That's the industry-standard "safe" threshold for TRC-20 USDT,
// so nothing here does its own block-counting on top of it; this constant
// is only used as the recorded confirmations value for the audit trail.
const ASSUMED_CONFIRMATIONS = 19;

const POLL_INTERVAL_MS = 30_000;
// Caps how many deposit addresses are polled concurrently per tick, so this
// doesn't blow through TronGrid's free-tier rate limit as the user base
// grows. Revisit (or add a TRON_PRO_API_KEY) if this ever needs to scale
// past a few hundred addresses.
const POLL_CONCURRENCY = 5;

interface Trc20Transfer {
  transaction_id: string;
  to: string;
  from: string;
  value: string;
  token_info?: { address?: string; decimals?: number };
}

async function fetchTrc20TransfersTo(address: string): Promise<Trc20Transfer[]> {
  const url =
    `${TRONGRID_API_BASE}/v1/accounts/${address}/transactions/trc20` +
    `?limit=50&contract_address=${USDT_CONTRACT_ADDRESS}&only_to=true&only_confirmed=true`;
  const headers: Record<string, string> = {};
  if (process.env.TRONGRID_API_KEY) headers['TRON-PRO-API-KEY'] = process.env.TRONGRID_API_KEY;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`TronGrid returned ${res.status} for ${address}`);
  const body = (await res.json()) as { data?: unknown };
  if (!Array.isArray(body?.data)) throw new Error(`unexpected TronGrid response shape for ${address}`);
  return body.data as Trc20Transfer[];
}

export interface KnownAddress {
  userId: string;
  address: string;
}

async function loadKnownAddresses(supabase: SupabaseClient): Promise<KnownAddress[]> {
  const { data, error } = await supabase.from('crypto_deposit_addresses').select('user_id, address');
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

// Exported so the filtering/crediting logic can be unit-tested with a
// mocked fetch + mocked Supabase client, without needing a real TronGrid
// connection (blocked from this project's dev sandbox — see the
// TRONGRID_API_BASE comment above).
export async function processAddress(supabase: SupabaseClient, known: KnownAddress, rate: number): Promise<void> {
  let transfers: Trc20Transfer[];
  try {
    transfers = await fetchTrc20TransfersTo(known.address);
  } catch (err) {
    console.error(`[crypto-watcher] failed to fetch transfers for ${known.address}:`, err);
    return;
  }

  for (const transfer of transfers) {
    // Defensive re-checks even though the query already filtered on these —
    // never trust a single layer of filtering with real money on the line.
    if (transfer.to !== known.address) continue;
    if (transfer.token_info?.address !== USDT_CONTRACT_ADDRESS) continue;

    const decimals = transfer.token_info?.decimals ?? 6; // USDT on Tron uses 6 decimals
    const amountUsdt = Number(transfer.value) / 10 ** decimals;
    if (!(amountUsdt > 0)) continue;

    const { data, error } = await supabase.rpc('credit_crypto_deposit', {
      p_user_id: known.userId,
      p_tx_hash: transfer.transaction_id,
      p_address: known.address,
      p_amount_usdt: amountUsdt,
      p_rate: rate,
      p_confirmations: ASSUMED_CONFIRMATIONS,
    });

    if (error) {
      console.error(`[crypto-watcher] credit_crypto_deposit failed for tx ${transfer.transaction_id}:`, error);
      continue;
    }
    const result = Array.isArray(data) ? data[0] : data;
    if (result?.credited) {
      console.log(
        `[crypto-watcher] credited ${amountUsdt} USDT (~₹${(amountUsdt * rate).toFixed(2)}) ` +
        `to user ${known.userId} (tx ${transfer.transaction_id})`
      );
    }
    // credited === false means this tx_hash was already recorded by an
    // earlier tick — expected steady-state noise (the same confirmed
    // transfer keeps showing up in TronGrid's history), not an error.
  }
}

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let stopped = false;

export function startDepositWatcher(): void {
  if (!cryptoDepositsEnabled()) {
    console.warn('[crypto-watcher] TRON_MASTER_SEED not set — USDT deposit watching disabled.');
    return;
  }
  const supabase = getSupabase();
  if (!supabase) {
    console.warn('[crypto-watcher] Supabase not configured — USDT deposit watching disabled.');
    return;
  }

  stopped = false;

  const tick = async () => {
    try {
      const [addresses, rate] = await Promise.all([loadKnownAddresses(supabase), loadUsdtInrRate(supabase)]);
      for (let i = 0; i < addresses.length; i += POLL_CONCURRENCY) {
        const batch = addresses.slice(i, i + POLL_CONCURRENCY);
        await Promise.all(batch.map((addr) => processAddress(supabase, addr, rate)));
      }
    } catch (err) {
      console.error('[crypto-watcher] poll tick failed:', err);
    } finally {
      if (!stopped) pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
    }
  };

  console.log(`[crypto-watcher] started (polling every ${POLL_INTERVAL_MS / 1000}s, contract ${USDT_CONTRACT_ADDRESS})`);
  tick();
}

export function stopDepositWatcher(): void {
  stopped = true;
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}
