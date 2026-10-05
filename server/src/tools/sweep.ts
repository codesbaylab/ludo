/**
 * Sweep tool - moves USDT (Solana SPL) from the per-user deposit addresses into ONE destination wallet.
 *
 * Runs on YOUR computer, by hand. It is not part of the game server and never runs on Render:
 * the master seed only needs to exist on the machine that is running this for the few minutes it takes.
 *
 *   cd server
 *   # PowerShell:
 *   $env:SOLANA_MASTER_SEED = "word1 word2 ... word12"
 *   $env:SOLANA_RPC_URL = "https://..."                           # recommended (public RPC is rate-limited)
 *   $env:SUPABASE_URL = "https://<project>.supabase.co"          # optional: reads the address list
 *   $env:SUPABASE_SERVICE_ROLE_KEY = "..."                        # optional (or pass --max-index)
 *   npm run sweep -- --to <your-collection-wallet>               # DRY RUN (default): only shows the plan
 *   npm run sweep -- --to <your-collection-wallet> --execute     # really sends
 *
 * Devnet rehearsal: also set SOLANA_RPC_URL=https://api.devnet.solana.com and USDT_MINT_OVERRIDE=<test mint>.
 *
 * How it works
 *  - Derivation index 0 of the seed is the GAS WALLET: keep some SOL on it (a few cents per sweep).
 *    It is the transaction's fee payer, so deposit addresses never need SOL of their own. It also pays
 *    the one-time rent (~0.002 SOL) if the destination has no USDT token account yet.
 *  - Addresses are listed from the database (crypto_deposit_addresses) or from --max-index N (indexes 1..N).
 *  - The destination must NOT be one of the deposit addresses. Dry run is the default; --execute asks you
 *    to type SWEEP before sending anything. Private keys are never printed or stored; an append-only
 *    sweep-log.jsonl is written next to where you run it.
 */
import fs from 'fs';
import readline from 'readline';
import { PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { createClient } from '@supabase/supabase-js';
import {
  SOLANA_RPC_URL, USDT_MINT, USDT_DECIMALS, cryptoDepositsEnabled, deriveSolanaKeypair, getConnection, usdtTokenAccount,
} from '../crypto/solana';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

/** USDT balance of an address in whole USDT. Read-only; 0 if it has no token account yet. */
export async function getUsdtBalance(address: string): Promise<number> {
  try {
    const res = await getConnection().getTokenAccountBalance(usdtTokenAccount(address));
    return Number(res.value.amount) / 10 ** USDT_DECIMALS;
  } catch {
    return 0; // token account does not exist
  }
}

async function getSolBalance(address: string): Promise<number> {
  return (await getConnection().getBalance(new PublicKey(address))) / 1e9;
}

async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

function logLine(entry: Record<string, unknown>) {
  fs.appendFileSync('sweep-log.jsonl', JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
}

interface Source { index: number; address: string; usdt: number }

async function listIndexes(): Promise<number[]> {
  const maxIdx = arg('max-index');
  if (maxIdx) return Array.from({ length: Number(maxIdx) }, (_, i) => i + 1);
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Give --max-index N, or set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY so the address list can be read.');
  const { data, error } = await createClient(url, key).from('crypto_deposit_addresses').select('derivation_index').eq('chain', 'solana');
  if (error) throw new Error('could not read deposit addresses: ' + error.message);
  return (data ?? []).map((r: any) => Number(r.derivation_index)).filter((n) => n >= 1).sort((a, b) => a - b);
}

async function main() {
  if (!cryptoDepositsEnabled()) throw new Error('SOLANA_MASTER_SEED is not set in this terminal.');
  let to: PublicKey;
  try { to = new PublicKey(arg('to') ?? ''); } catch { throw new Error('Pass --to <a valid Solana address> - the wallet that receives everything.'); }
  const min = Number(arg('min') ?? 1);          // ignore addresses holding less than this many USDT
  const execute = has('execute');
  const gas = deriveSolanaKeypair(0);

  const indexes = await listIndexes();
  console.log(`RPC: ${SOLANA_RPC_URL}\nUSDT mint: ${USDT_MINT}\nDestination: ${to.toBase58()}\nGas wallet (index 0): ${gas.publicKey.toBase58()}\nChecking ${indexes.length} deposit address(es)...\n`);

  const sources: Source[] = [];
  for (const index of indexes) {
    const address = deriveSolanaKeypair(index).publicKey.toBase58();
    if (address === to.toBase58()) throw new Error(`Destination is itself deposit address #${index} - pick a different wallet.`);
    const usdt = await getUsdtBalance(address);
    if (usdt >= min) sources.push({ index, address, usdt });
    await new Promise((r) => setTimeout(r, 200)); // stay under public RPC rate limits
  }

  if (sources.length === 0) { console.log(`Nothing to sweep (no address holds ${min}+ USDT).`); return; }
  const total = sources.reduce((s, x) => s + x.usdt, 0);
  console.table(sources.map((s) => ({ index: s.index, address: s.address, usdt: s.usdt })));
  const gasBal = await getSolBalance(gas.publicKey.toBase58());
  console.log(`Total: ${total} USDT from ${sources.length} address(es). Gas wallet SOL balance: ${gasBal}${gasBal < 0.01 * sources.length ? '  (!) may not be enough' : ''}\n`);

  if (!execute) { console.log('DRY RUN - nothing was sent. Add --execute to really sweep.'); return; }
  if ((await ask('Type SWEEP to send these funds to the destination: ')) !== 'SWEEP') { console.log('Cancelled.'); return; }

  const conn = getConnection();
  const mint = new PublicKey(USDT_MINT);
  const dest = getAssociatedTokenAddressSync(mint, to, true);
  let moved = 0;
  for (const s of sources) {
    try {
      const owner = deriveSolanaKeypair(s.index);
      const fresh = await getUsdtBalance(s.address); // re-read right before sending
      if (fresh < min) { console.log(`#${s.index}: balance changed (${fresh}), skipped`); continue; }
      const amount = BigInt(Math.round(fresh * 10 ** USDT_DECIMALS));
      const tx = new Transaction().add(
        // No-op if the destination token account already exists; the gas wallet pays rent if it must be created.
        createAssociatedTokenAccountIdempotentInstruction(gas.publicKey, dest, to, mint),
        createTransferCheckedInstruction(usdtTokenAccount(s.address), mint, dest, owner.publicKey, amount, USDT_DECIMALS),
      );
      tx.feePayer = gas.publicKey;
      const sig = await sendAndConfirmTransaction(conn, tx, [gas, owner], { commitment: 'finalized' });
      moved += fresh;
      console.log(`#${s.index}: moved ${fresh} USDT  (tx ${sig})`);
      logLine({ step: 'sweep', index: s.index, from: s.address, to: to.toBase58(), usdt: fresh, tx: sig });
    } catch (err) {
      console.error(`#${s.index} ${s.address}: FAILED - ${(err as Error).message}`);
      logLine({ step: 'error', index: s.index, address: s.address, error: (err as Error).message });
    }
  }
  console.log(`\nDone. Moved ${moved} USDT. Log: sweep-log.jsonl`);
}

if (require.main === module) {
  main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
}
