// Offline checks for the BSC deposit code: address derivation + the event scan (against a fake provider and fake DB).
process.env.BSC_MASTER_SEED = 'test test test test test test test test test test test junk';
import { Interface, zeroPadValue, parseUnits } from 'ethers';
import * as bsc from '../crypto/bsc';
import { scanRange } from '../crypto/depositWatcher';

const assert = (c: unknown, m: string) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok  ' + m); };

async function main() {
  const a1 = bsc.deriveBscAddress(1), a2 = bsc.deriveBscAddress(2);
  assert(bsc.isBscAddress(a1) && a1 !== a2, 'derives distinct valid 0x addresses');
  assert(bsc.deriveBscAddress(1) === a1, 'derivation is deterministic');
  assert(bsc.deriveBscAddress(0) !== a1, 'index 0 (gas wallet) differs from user addresses');

  // Fake chain: two Transfer logs to a1 (5 USDT and 0.5 dust), one to a stranger.
  const provider = bsc.getProvider() as any;
  const iface = new Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);
  const mk = (to: string, amt: string, tx: string, index: number) => ({
    transactionHash: tx, index, topics: [bsc.TRANSFER_TOPIC, zeroPadValue('0x' + '11'.repeat(20), 32), zeroPadValue(to.toLowerCase(), 32)],
    data: iface.encodeEventLog('Transfer', ['0x' + '11'.repeat(20), to, parseUnits(amt, 18)]).data,
  });
  let seenTopics: any;
  provider.getLogs = async (f: any) => { seenTopics = f; return [mk(a1, '5', '0xaaa', 3), mk(a1, '0.5', '0xbbb', 4), mk('0x' + '22'.repeat(20), '9', '0xccc', 5)]; };

  const credits: any[] = [];
  const fakeDb: any = { rpc: async (_n: string, p: any) => { credits.push(p); return { data: [{ credited: true }], error: null }; } };
  const n = await scanRange(fakeDb, [{ userId: 'u1', address: a1 }, { userId: 'u2', address: a2 }], 100, 200);
  assert(n === 1 && credits.length === 1, 'credits only the real deposit (dust and strangers ignored)');
  assert(credits[0].p_user_id === 'u1' && credits[0].p_amount_usdt === 5 && credits[0].p_tx_hash === '0xaaa:3' && credits[0].p_asset === 'USDT', 'credit has the right user, amount and unique tx id');
  assert(seenTopics.address === bsc.USDT_CONTRACT, 'only the USDT contract is queried');
  console.log('PASS BSC checks');
}
main().catch((e) => { console.error(e); process.exit(1); });
