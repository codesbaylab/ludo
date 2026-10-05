import fs from 'fs';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
(async () => {
  const conn = new Connection('https://api.devnet.solana.com', 'confirmed');
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))));
  const mints = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const to = new PublicKey(process.argv[4]);
  for (const sym of ['USDT', 'USDC']) {
    const ata = await getOrCreateAssociatedTokenAccount(conn, payer, new PublicKey(mints[sym]), to);
    await mintTo(conn, payer, new PublicKey(mints[sym]), ata.address, payer, 20_000_000n);
  }
  console.log('minted 20 USDT + 20 USDC');
})();
