/**
 * End-to-end rehearsal on Solana DEVNET with throwaway test coins (no real money):
 *   1. derives a deposit address from a random throwaway seed,
 *   2. creates test SPL mints standing in for USDT and USDC (plus a look-alike that must be ignored)
 *      and mints some of each to that address,
 *   3. runs the real watcher logic (processAddress) against an in-memory fake Supabase: both coins
 *      credited once, look-alike ignored, a second poll credits nothing,
 *   4. runs the real sweep tool (--execute) and checks both coins arrive at a fresh destination.
 *
 *   npm run test:devnet     (gas wallet gets devnet SOL via airdrop, or set DEVNET_PAYER_FILE=<keypair json> funded from faucet.solana.com)
 */
import fs from 'fs';
import { spawnSync } from 'child_process';
import * as bip39 from 'bip39';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';

const RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const fail = (m: string): never => { console.error('FAIL:', m); process.exit(1); };
const ok = (m: string) => console.log('ok  -', m);

// ---- child mode: runs with the coin env vars set, so solana.ts picks up the test mints ----
async function check() {
  const { processAddress } = await import('../crypto/depositWatcher');
  const sol = await import('../crypto/solana');
  const address = sol.deriveSolanaAddress(1);
  const credits = new Map<string, { asset: string; amount: number }>();
  const fakeSupabase: any = {
    from: () => ({ select: () => ({ in: async (_c: string, hashes: string[]) => ({ data: hashes.filter((h) => credits.has(h)).map((h) => ({ tx_hash: h })) }) }) }),
    rpc: async (_n: string, a: any) => {
      if (credits.has(a.p_tx_hash)) return { data: [{ credited: false }], error: null };
      credits.set(a.p_tx_hash, { asset: a.p_asset, amount: a.p_amount_usdt });
      return { data: [{ credited: true }], error: null };
    },
  };
  await processAddress(fakeSupabase, { userId: 'u1', address }, 90);
  const first = [...credits.values()].sort((a, b) => a.asset.localeCompare(b.asset));
  if (JSON.stringify(first) !== JSON.stringify([{ asset: 'USDC', amount: 7.5 }, { asset: 'USDT', amount: 5 }])) fail('unexpected credits: ' + JSON.stringify(first));
  ok('watcher credited 5 USDT + 7.5 USDC, ignored the look-alike coin');
  await processAddress(fakeSupabase, { userId: 'u1', address }, 90);
  if (credits.size !== 2) fail('second poll credited again');
  ok('second poll credited nothing (idempotent)');
}

async function main() {
  if (process.argv.includes('--check')) return check();

  const seed = bip39.generateMnemonic(); // throwaway, devnet only
  process.env.SOLANA_MASTER_SEED = seed;
  process.env.SOLANA_RPC_URL = RPC;
  const sol = await import('../crypto/solana');
  const conn = sol.getConnection();
  const gas = sol.deriveSolanaKeypair(0);
  const user = sol.deriveSolanaKeypair(1);
  console.log('gas wallet:', gas.publicKey.toBase58(), '\ndeposit address:', user.publicKey.toBase58());

  if ((await conn.getBalance(gas.publicKey)) < 0.05 * LAMPORTS_PER_SOL) {
    const payerJson = process.env.DEVNET_PAYER_SECRET || (process.env.DEVNET_PAYER_FILE ? fs.readFileSync(process.env.DEVNET_PAYER_FILE, 'utf8') : '');
    if (payerJson) {
      const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(payerJson)));
      await sendAndConfirmTransaction(conn, new Transaction().add(
        SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: gas.publicKey, lamports: 0.1 * LAMPORTS_PER_SOL })), [payer]);
    } else {
      const sig = await conn.requestAirdrop(gas.publicKey, LAMPORTS_PER_SOL);
      await conn.confirmTransaction(sig, 'confirmed');
    }
  }
  const bal = await conn.getBalance(gas.publicKey);
  if (bal < 0.02 * LAMPORTS_PER_SOL) fail('gas wallet has no devnet SOL (faucet.solana.com -> ' + gas.publicKey.toBase58() + ')');
  ok(`gas wallet funded (${bal / LAMPORTS_PER_SOL} SOL)`);

  const usdt = await createMint(conn, gas, gas.publicKey, null, 6);
  const usdc = await createMint(conn, gas, gas.publicKey, null, 6);
  const fake = await createMint(conn, gas, gas.publicKey, null, 6);
  for (const [mint, amount] of [[usdt, 5], [usdc, 7.5], [fake, 100]] as [PublicKey, number][]) {
    const ata = await getOrCreateAssociatedTokenAccount(conn, gas, mint, user.publicKey);
    await mintTo(conn, gas, mint, ata.address, gas, BigInt(Math.round(amount * 1e6)));
  }
  ok('minted 5 test-USDT, 7.5 test-USDC and 100 look-alike coins to the deposit address');

  const env = {
    ...process.env,
    SOLANA_MASTER_SEED: seed, SOLANA_RPC_URL: RPC,
    USDT_MINT_OVERRIDE: usdt.toBase58(), USDC_MINT_OVERRIDE: usdc.toBase58(),
  };
  const run = (args: string[], input?: string) =>
    spawnSync('npx', ['tsx', ...args], { env, input, encoding: 'utf8', shell: true });

  // Finalized commitment can lag a few seconds behind the mint transactions.
  await new Promise((r) => setTimeout(r, 15_000));
  const c = run(['src/test/testDevnetDeposits.ts', '--check']);
  process.stdout.write(c.stdout); process.stderr.write(c.stderr);
  if (c.status !== 0) fail('watcher check failed');

  const dest = Keypair.generate().publicKey.toBase58();
  const s = run(['src/tools/sweep.ts', '--to', dest, '--max-index', '1', '--min', '1', '--execute'], 'SWEEP\n');
  process.stdout.write(s.stdout); process.stderr.write(s.stderr);
  if (s.status !== 0 || !/moved 5 USDT/.test(s.stdout) || !/moved 7\.5 USDC/.test(s.stdout)) fail('sweep did not move both coins');
  ok('sweep moved both coins; look-alike left alone');

  for (const [name, mint, want] of [['USDT', usdt, 5], ['USDC', usdc, 7.5]] as [string, PublicKey, number][]) {
    const got = await conn.getTokenAccountBalance(sol.tokenAccount(dest, mint.toBase58()), 'finalized');
    if (Number(got.value.uiAmountString) !== want) fail(`${name} at destination is ${got.value.uiAmountString}, wanted ${want}`);
  }
  ok('destination holds 5 USDT + 7.5 USDC');
  console.log('\nALL DEVNET CHECKS PASSED');
}

main().catch((e) => { console.error(e); process.exit(1); });
