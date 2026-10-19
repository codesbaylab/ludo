/**
 * Sweep tool - moves USDT (BSC / BEP20) from the per-user deposit addresses into ONE destination wallet.
 *
 * Runs on YOUR computer, by hand. It is not part of the game server and never runs on Render:
 * the master seed only needs to exist on the machine that is running this for the few minutes it takes.
 *
 *   cd server
 *   # PowerShell:
 *   $env:BSC_MASTER_SEED = "word1 word2 ... word12"
 *   $env:BSC_RPC_URL = "https://..."                              # recommended (public node is rate-limited)
 *   $env:SUPABASE_URL = "https://<project>.supabase.co"          # optional: reads the address list
 *   $env:SUPABASE_SERVICE_ROLE_KEY = "..."                        # optional (or pass --max-index)
 *   npm run sweep -- --to <your-collection-wallet>               # DRY RUN (default): only shows the plan
 *   npm run sweep -- --to <your-collection-wallet> --execute     # really sends
 *
 * Testnet rehearsal: also set BSC_RPC_URL=<testnet rpc> and BSC_USDT_OVERRIDE=<test token contract>.
 *
 * How it works
 *  - Derivation index 0 of the seed is the GAS WALLET: keep some BNB on it (about $0.03 per swept address).
 *    A BSC address needs its own BNB to send tokens, so for every address that holds USDT the gas wallet first sends it
 *    just enough BNB, then the address sends its USDT to the destination (any BNB left over stays there for next time).
 *  - Addresses are listed from the database (crypto_deposit_addresses) or from --max-index N (indexes 1..N).
 *  - The destination must NOT be one of the deposit addresses. Dry run is the default; --execute asks you
 *    to type SWEEP before sending anything. Private keys are never printed or stored; an append-only
 *    sweep-log.jsonl is written next to where you run it.
 */
import fs from 'fs';
import readline from 'readline';
import { Contract, formatEther, formatUnits, parseUnits } from 'ethers';
import { createClient } from '@supabase/supabase-js';
import { BSC_RPC_URL, USDT_CONTRACT, USDT_DECIMALS, cryptoDepositsEnabled, deriveWallet, getProvider, isBscAddress, checksum } from '../crypto/bsc';

const ERC20 = ['function balanceOf(address) view returns (uint256)', 'function transfer(address to, uint256 amount) returns (bool)'];
const TRANSFER_GAS = 70_000n; // a BEP20 transfer uses ~52k; headroom for a first-time slot write

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

function logLine(entry: Record<string, unknown>) {
  fs.appendFileSync('sweep-log.jsonl', JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
}

async function usdtBalance(address: string): Promise<number> {
  const raw: bigint = await new Contract(USDT_CONTRACT, ERC20, getProvider()).balanceOf(address);
  return Number(formatUnits(raw, USDT_DECIMALS));
}

async function listIndexes(): Promise<number[]> {
  const maxIdx = arg('max-index');
  if (maxIdx) return Array.from({ length: Number(maxIdx) }, (_, i) => i + 1);
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Give --max-index N, or set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY so the address list can be read.');
  const { data, error } = await createClient(url, key).from('crypto_deposit_addresses').select('derivation_index').eq('chain', 'bsc');
  if (error) throw new Error('could not read deposit addresses: ' + error.message);
  return (data ?? []).map((r: any) => Number(r.derivation_index)).filter((n) => n >= 1).sort((a, b) => a - b);
}

interface Source { index: number; address: string; usdt: number }

async function main() {
  if (!cryptoDepositsEnabled()) throw new Error('BSC_MASTER_SEED is not set in this terminal.');
  const toRaw = arg('to') ?? '';
  if (!isBscAddress(toRaw)) throw new Error('Pass --to <a valid 0x BSC address> - the wallet that receives everything.');
  const to = checksum(toRaw);
  const min = Number(arg('min') ?? 1); // ignore addresses holding less than this many USDT
  const execute = has('execute');
  const provider = getProvider();
  const gas = deriveWallet(0).connect(provider);

  const indexes = await listIndexes();
  console.log(`RPC: ${BSC_RPC_URL}\nToken: USDT ${USDT_CONTRACT}\nDestination: ${to}\nGas wallet (index 0): ${gas.address}\nChecking ${indexes.length} deposit address(es)...\n`);

  const sources: Source[] = [];
  for (const index of indexes) {
    const address = deriveWallet(index).address;
    if (address === to) throw new Error(`Destination is itself deposit address #${index} - pick a different wallet.`);
    const usdt = await usdtBalance(address);
    if (usdt >= min) sources.push({ index, address, usdt });
    await new Promise((r) => setTimeout(r, 150)); // stay under public node rate limits
  }

  if (sources.length === 0) { console.log(`Nothing to sweep (no address holds ${min}+ USDT).`); return; }
  const total = sources.reduce((s, x) => s + x.usdt, 0);
  console.table(sources.map((s) => ({ index: s.index, address: s.address, usdt: s.usdt })));
  const gasPrice = (await provider.getFeeData()).gasPrice ?? parseUnits('3', 'gwei');
  const perSweep = gasPrice * TRANSFER_GAS * 13n / 10n;
  const gasBal = await provider.getBalance(gas.address);
  const needed = perSweep * BigInt(sources.length);
  console.log(`Total: ${total} USDT in ${sources.length} address(es). Gas wallet BNB: ${formatEther(gasBal)} (about ${formatEther(needed)} needed)${gasBal < needed ? '  (!) may not be enough' : ''}\n`);

  if (!execute) { console.log('DRY RUN - nothing was sent. Add --execute to really sweep.'); return; }
  if ((await ask('Type SWEEP to send these funds to the destination: ')) !== 'SWEEP') { console.log('Cancelled.'); return; }

  let moved = 0;
  for (const s of sources) {
    try {
      const owner = deriveWallet(s.index).connect(provider);
      const fresh = await usdtBalance(s.address); // re-read right before sending
      if (fresh < min) { console.log(`#${s.index}: balance changed (${fresh}), skipped`); continue; }
      const price = (await provider.getFeeData()).gasPrice ?? gasPrice;
      const need = price * TRANSFER_GAS * 13n / 10n;
      const have = await provider.getBalance(s.address);
      if (have < need) {
        const top = await gas.sendTransaction({ to: s.address, value: need - have });
        await top.wait();
        logLine({ step: 'gas-topup', index: s.index, to: s.address, bnb: formatEther(need - have), tx: top.hash });
      }
      const amount = parseUnits(String(fresh), USDT_DECIMALS);
      const tx = await new Contract(USDT_CONTRACT, ERC20, owner).transfer(to, amount, { gasLimit: TRANSFER_GAS });
      await tx.wait();
      moved += fresh;
      console.log(`#${s.index}: moved ${fresh} USDT  (tx ${tx.hash})`);
      logLine({ step: 'sweep', index: s.index, from: s.address, to, amount: fresh, tx: tx.hash });
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
