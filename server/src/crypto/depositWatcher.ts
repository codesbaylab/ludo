import { SupabaseClient } from '@supabase/supabase-js';
import { formatUnits, zeroPadValue } from 'ethers';
import { getSupabase } from '../supabase';
import { TRANSFER_TOPIC, USDT_CONTRACT, USDT_DECIMALS, cryptoDepositsEnabled, getProvider } from './bsc';

// Deposits are detected by reading the USDT contract's Transfer events whose recipient is one of our deposit addresses
// (one eth_getLogs call covers a whole batch of addresses). Only blocks at least CONFIRMATIONS deep are read, so a
// reorg can't take a credited deposit back. The scan position is kept in chain_cursors so a restart never skips blocks;
// credit_crypto_deposit is idempotent on tx_hash, so re-reading blocks is harmless.
const CONFIRMATIONS = 15;
const OVERLAP_BLOCKS = 20; // re-read a little behind the cursor (covers an address created mid-scan)
const FIRST_RUN_LOOKBACK = 1200; // ~1 hour of BSC blocks when there is no saved cursor yet
const CHUNK_BLOCKS = Number(process.env.BSC_LOG_CHUNK) > 0 ? Number(process.env.BSC_LOG_CHUNK) : 1000;
const MAX_BLOCKS_PER_TICK = 20_000;
const ADDRESS_BATCH = 50;

// Transfers smaller than this are ignored entirely (dust / spam would otherwise show as empty deposits).
const MIN_DEPOSIT_USDT = Number(process.env.MIN_DEPOSIT_USDT) > 0 ? Number(process.env.MIN_DEPOSIT_USDT) : 1;

const POLL_INTERVAL_MS = 20_000;

export interface KnownAddress {
  userId: string;
  address: string;
}

async function loadKnownAddresses(supabase: SupabaseClient): Promise<KnownAddress[]> {
  const { data, error } = await supabase.from('crypto_deposit_addresses').select('user_id, address').eq('chain', 'bsc');
  if (error) throw new Error('failed to load deposit addresses: ' + error.message);
  return (data ?? []).map((row) => ({ userId: row.user_id as string, address: row.address as string }));
}

// The wallet is in dollars and USDT is credited 1:1. The old admin-settable rate is deliberately ignored
// (a stale or mistyped rate would mint money); the value is still recorded on each deposit row as rate_used.
const RATE = 1;

async function loadCursor(supabase: SupabaseClient): Promise<number | null> {
  const { data } = await supabase.from('chain_cursors').select('last_block').eq('chain', 'bsc').maybeSingle();
  return data ? Number(data.last_block) : null;
}
async function saveCursor(supabase: SupabaseClient, block: number): Promise<void> {
  const { error } = await supabase.from('chain_cursors').upsert({ chain: 'bsc', last_block: block, updated_at: new Date().toISOString() });
  if (error) throw new Error('failed to save cursor: ' + error.message);
}

/** Scan [from, to] for USDT transferred to any of `addrs`; credits each (idempotent). Throws if a credit fails. */
export async function scanRange(supabase: SupabaseClient, addrs: KnownAddress[], from: number, to: number): Promise<number> {
  const byAddress = new Map(addrs.map((a) => [a.address.toLowerCase(), a]));
  const provider = getProvider();
  let credited = 0;
  for (let i = 0; i < addrs.length; i += ADDRESS_BATCH) {
    const topics = addrs.slice(i, i + ADDRESS_BATCH).map((a) => zeroPadValue(a.address.toLowerCase(), 32));
    const logs = await provider.getLogs({ address: USDT_CONTRACT, topics: [TRANSFER_TOPIC, null, topics], fromBlock: from, toBlock: to });
    for (const log of logs) {
      const owner = byAddress.get('0x' + log.topics[2].slice(26).toLowerCase());
      if (!owner) continue;
      const amountUsdt = Number(formatUnits(BigInt(log.data), USDT_DECIMALS));
      if (!(amountUsdt >= MIN_DEPOSIT_USDT)) continue;
      const txHash = `${log.transactionHash}:${log.index}`;
      // credit_crypto_deposit is idempotent on tx_hash, so re-seeing a transfer is a costless no-op.
      const { data, error } = await supabase.rpc('credit_crypto_deposit', {
        p_user_id: owner.userId,
        p_tx_hash: txHash,
        p_address: owner.address,
        p_amount_usdt: amountUsdt,
        p_rate: RATE,
        p_confirmations: CONFIRMATIONS,
        p_asset: 'USDT',
      });
      if (error) throw new Error(`credit failed for tx ${txHash}: ${error.message}`);
      const result = Array.isArray(data) ? data[0] : data;
      if (result?.credited) {
        credited++;
        console.log(`[crypto-watcher] credited ${amountUsdt} USDT (BSC, ~$${(amountUsdt * RATE).toFixed(2)}) to user ${owner.userId} (tx ${log.transactionHash})`);
      }
    }
  }
  return credited;
}

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let stopped = false;

// Read by the admin System page (GET /api/admin/status).
const watcherStatus = { enabled: false, lastTickAt: 0, lastOk: false, lastError: '', addresses: 0, ticks: 0, lastBlock: 0 };
export function getWatcherStatus() { return { ...watcherStatus }; }

async function tick(supabase: SupabaseClient): Promise<void> {
  const latest = await getProvider().getBlockNumber();
  const safe = latest - CONFIRMATIONS;
  const saved = await loadCursor(supabase);
  const cursor = saved ?? safe - FIRST_RUN_LOOKBACK;
  const addrs = await loadKnownAddresses(supabase);
  watcherStatus.addresses = addrs.length;

  let from = Math.max(cursor - OVERLAP_BLOCKS, 0) + 1;
  const stop = Math.min(safe, from + MAX_BLOCKS_PER_TICK);
  let done = cursor;
  while (from <= stop) {
    const to = Math.min(from + CHUNK_BLOCKS - 1, stop);
    if (addrs.length) await scanRange(supabase, addrs, from, to);
    done = to;
    from = to + 1;
  }
  if (done > cursor || saved === null) await saveCursor(supabase, done);
  watcherStatus.lastBlock = done;
}

export function startDepositWatcher(): void {
  if (!cryptoDepositsEnabled()) {
    console.warn('[crypto-watcher] BSC_MASTER_SEED not set — USDT deposit watching disabled.');
    return;
  }
  const supabase = getSupabase();
  if (!supabase) {
    console.warn('[crypto-watcher] Supabase not configured — USDT deposit watching disabled.');
    return;
  }

  stopped = false;
  watcherStatus.enabled = true;

  const run = async () => {
    try {
      await tick(supabase);
      watcherStatus.lastOk = true;
      watcherStatus.lastError = '';
    } catch (err) {
      watcherStatus.lastOk = false;
      watcherStatus.lastError = String((err as Error)?.message ?? err).slice(0, 200);
      console.error('[crypto-watcher] poll tick failed:', err);
    } finally {
      watcherStatus.lastTickAt = Date.now();
      watcherStatus.ticks++;
      if (!stopped) pollTimer = setTimeout(run, POLL_INTERVAL_MS);
    }
  };

  console.log(`[crypto-watcher] started (BSC USDT ${USDT_CONTRACT}, polling every ${POLL_INTERVAL_MS / 1000}s, ${CONFIRMATIONS} confirmations)`);
  run();
}

export function stopDepositWatcher(): void {
  stopped = true;
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}
