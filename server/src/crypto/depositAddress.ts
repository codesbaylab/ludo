import { getSupabase } from '../supabase';
import { deriveBscAddress } from './bsc';

// Returns the caller's permanent USDT (BSC / BEP20) deposit address, deriving
// and persisting one on first call. Never returns/handles a private key —
// only next_crypto_deposit_index() (server-only RPC) and the address
// itself ever leave this function.
export async function getOrCreateDepositAddress(userId: string): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase is not configured');

  const existing = await supabase
    .from('crypto_deposit_addresses')
    .select('address')
    .eq('user_id', userId)
    .eq('chain', 'bsc')
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data.address;

  const { data: index, error: indexError } = await supabase.rpc('next_crypto_deposit_index');
  if (indexError) throw indexError;
  const address = deriveBscAddress(index as number);

  const inserted = await supabase
    .from('crypto_deposit_addresses')
    .insert({ user_id: userId, derivation_index: index, address, chain: 'bsc' })
    .select('address')
    .single();

  if (inserted.error) {
    // Unique violation — a concurrent call already won the race and inserted this user's row first (the reserved index
    // above is simply unused; sequences are allowed gaps). Read whatever that call wrote instead of erroring out.
    if (inserted.error.code === '23505') {
      const retry = await supabase
        .from('crypto_deposit_addresses')
        .select('address')
        .eq('user_id', userId)
        .eq('chain', 'bsc')
        .single();
      if (retry.error) throw retry.error;
      return retry.data.address;
    }
    throw inserted.error;
  }

  return inserted.data.address;
}
