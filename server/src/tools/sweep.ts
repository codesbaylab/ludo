/**
 * Sweep tool — moves USDT (TRC-20) from the per-user deposit addresses into ONE destination wallet.
 *
 * Runs on YOUR computer, by hand. It is not part of the game server and never runs on Render:
 * the master seed only needs to exist on the machine that is running this for the few minutes it takes.
 *
 *   cd server
 *   # PowerShell:
 *   $env:TRON_MASTER_SEED = "word1 word2 ... word12"
 *   $env:SUPABASE_URL = "https://<project>.supabase.co"          # optional: reads the address list
 *   $env:SUPABASE_SERVICE_ROLE_KEY = "..."                        # optional (or pass --max-index)
 *   npm run sweep -- --to T<your-collection-wallet>               # DRY RUN (default): only shows the plan
 *   npm run sweep -- --to T<your-collection-wallet> --execute     # really sends
 *
 * Testnet rehearsal: also set TRONGRID_API_BASE=https://nile.trongrid.io and
 * USDT_CONTRACT_ADDRESS_OVERRIDE=<Nile USDT contract>, exactly like on Render.
 *
 * How it works
 *  - Address index 0 of the seed (the "General" wallet in TronLink) is the GAS WALLET: keep some TRX on it.
 *    Every deposit address starts with 0 TRX and cannot pay the network fee itself, so the tool first tops
 *    the address up with TRX from the gas wallet, then moves the USDT out in one transfer.
 *  - Addresses are listed from the database (crypto_deposit_addresses) or from --max-index N (indexes 1..N).
 *  - The destination must NOT be one of the deposit addresses. Dry run is the default; --execute asks you
 *    to type SWEEP before sending anything. Private keys are never printed or stored; an append-only
 *    sweep-log.jsonl is written next to where you run it.
 */
import fs from 'fs';
import readline from 'readline';
import { TronWeb } from 'tronweb';
import { createClient } from '@supabase/supabase-js';
import { USDT_CONTRACT_ADDRESS, deriveTronAccount, cryptoDepositsEnabled } from '../crypto/tron';

const API_BASE = process.env.TRONGRID_API_BASE?.trim() || 'https://api.trongrid.io';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

function makeTronWeb(privateKey?: string): TronWeb {
  const headers = process.env.TRONGRID_API_KEY ? { 'TRON-PRO-API-KEY': process.env.TRONGRID_API_KEY } : undefined;
  return new TronWeb({ fullHost: API_BASE, headers, privateKey });
}

/** USDT balance of an address in whole USDT (6 decimals). Read-only; exported so it can be tested on its own. */
export async function getUsdtBalance(address: string): Promise<number> {
  const tw = makeTronWeb();
  tw.setAddress(address);
  const res = await tw.transactionBuilder.triggerConstantContract(
    USDT_CONTRACT_ADDRESS, 'balanceOf(address)', {}, [{ type: 'address', value: address }], address);
  const hex = res?.constant_result?.[0];
  if (!hex) return 0;
  return Number(BigInt('0x' + hex)) / 1e6;
}

async function getTrxBalance(address: string): Promise<number> {
  return Number(await makeTronWeb().trx.getBalance(address)) / 1e6;
}

async function waitConfirmed(tw: TronWeb, txid: string, label: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const info: any = await tw.trx.getTransactionInfo(txid).catch(() => null);
    if (info && info.blockNumber) {
      if (info.receipt?.result && info.receipt.result !== 'SUCCESS') throw new Error(`${label} failed on-chain: ${info.receipt.result}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`${label} not confirmed after 2 minutes (tx ${txid}) — check it on the explorer before retrying`);
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
  const { data, error } = await createClient(url, key).from('crypto_deposit_addresses').select('derivation_index');
  if (error) throw new Error('could not read deposit addresses: ' + error.message);
  return (data ?? []).map((r: any) => Number(r.derivation_index)).filter((n) => n >= 1).sort((a, b) => a - b);
}

async function main() {
  if (!cryptoDepositsEnabled()) throw new Error('TRON_MASTER_SEED is not set in this terminal.');
  const to = arg('to');
  if (!to || !TronWeb.isAddress(to)) throw new Error('Pass --to <a valid Tron address (starts with T)> — the wallet that receives everything.');
  const min = Number(arg('min') ?? 1);          // ignore addresses holding less than this many USDT
  const gasTrx = Number(arg('gas-trx') ?? 30);  // TRX each address needs on it to pay the transfer fee
  const execute = has('execute');
  const gas = deriveTronAccount(0);

  const indexes = await listIndexes();
  console.log(`Network: ${API_BASE}\nUSDT contract: ${USDT_CONTRACT_ADDRESS}\nDestination: ${to}\nGas wallet (index 0): ${gas.address}\nChecking ${indexes.length} deposit address(es)…\n`);

  const sources: Source[] = [];
  for (const index of indexes) {
    const { address } = deriveTronAccount(index);
    if (address === to) throw new Error(`Destination ${to} is itself deposit address #${index} — pick a different wallet.`);
    const usdt = await getUsdtBalance(address);
    if (usdt >= min) sources.push({ index, address, usdt });
    await new Promise((r) => setTimeout(r, 250)); // stay under TronGrid's free rate limit
  }

  if (sources.length === 0) { console.log(`Nothing to sweep (no address holds ${min}+ USDT).`); return; }
  const total = sources.reduce((s, x) => s + x.usdt, 0);
  console.table(sources.map((s) => ({ index: s.index, address: s.address, usdt: s.usdt })));
  console.log(`Total: ${total} USDT from ${sources.length} address(es). Each needs about ${gasTrx} TRX of fee money from the gas wallet.`);
  const gasBal = await getTrxBalance(gas.address);
  console.log(`Gas wallet TRX balance: ${gasBal}${gasBal < gasTrx * sources.length ? '  ⚠ may not be enough for all addresses' : ''}\n`);

  if (!execute) { console.log('DRY RUN — nothing was sent. Add --execute to really sweep.'); return; }
  if ((await ask('Type SWEEP to send these funds to the destination: ')) !== 'SWEEP') { console.log('Cancelled.'); return; }

  const gasTw = makeTronWeb(gas.privateKey);
  let moved = 0;
  for (const s of sources) {
    try {
      const have = await getTrxBalance(s.address);
      if (have < gasTrx) {
        const top = Math.ceil(gasTrx - have);
        const sent: any = await gasTw.trx.sendTransaction(s.address, top * 1e6);
        if (!sent?.txid) throw new Error('TRX top-up was rejected: ' + JSON.stringify(sent?.message ?? sent));
        await waitConfirmed(gasTw, sent.txid, 'TRX top-up');
        logLine({ step: 'topup', index: s.index, address: s.address, trx: top, tx: sent.txid });
      }
      const { privateKey } = deriveTronAccount(s.index);
      const tw = makeTronWeb(privateKey);
      const fresh = await getUsdtBalance(s.address); // re-read right before sending
      if (fresh < min) { console.log(`#${s.index}: balance changed (${fresh}), skipped`); continue; }
      const amount = BigInt(Math.round(fresh * 1e6));
      const tx: any = await tw.transactionBuilder.triggerSmartContract(
        USDT_CONTRACT_ADDRESS, 'transfer(address,uint256)', { feeLimit: 60_000_000, callValue: 0 },
        [{ type: 'address', value: to }, { type: 'uint256', value: amount.toString() }], s.address);
      if (!tx?.result?.result) throw new Error('could not build the USDT transfer');
      const signed = await tw.trx.sign(tx.transaction);
      const res: any = await tw.trx.sendRawTransaction(signed);
      if (!res?.result) throw new Error('USDT transfer was rejected: ' + JSON.stringify(res));
      await waitConfirmed(tw, signed.txID, 'USDT transfer');
      moved += fresh;
      console.log(`#${s.index}: moved ${fresh} USDT  (tx ${signed.txID})`);
      logLine({ step: 'sweep', index: s.index, from: s.address, to, usdt: fresh, tx: signed.txID });
    } catch (err) {
      console.error(`#${s.index} ${s.address}: FAILED — ${(err as Error).message}`);
      logLine({ step: 'error', index: s.index, address: s.address, error: (err as Error).message });
    }
  }
  console.log(`\nDone. Moved ${moved} USDT. Log: sweep-log.jsonl`);
}

if (require.main === module) {
  main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
}
