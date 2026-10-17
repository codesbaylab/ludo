import type { Client, Room } from 'colyseus';

// Quick chat: players can only send ids from this fixed list (no free text), so there is nothing to moderate and
// no way to pass card information at a Rummy table. The wording lives in design/chat.js - keep the ids in sync.
export const CHAT_IDS = new Set([
  'e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7',                       // emoji
  'gg', 'nice', 'oops', 'hurry', 'wp', 'thanks', 'hello', 'unlucky',    // phrases
]);
const MIN_GAP_MS = 1200;

export function registerChat(room: Room<any>, seatOf: (client: Client) => { name: string } | undefined): void {
  const last = new Map<string, number>();
  room.onMessage('chat', (client, message: any) => {
    const id = message && typeof message.id === 'string' ? message.id : '';
    if (!CHAT_IDS.has(id)) return;
    const seat = seatOf(client);
    if (!seat) return;
    const now = Date.now();
    if (now - (last.get(client.sessionId) ?? 0) < MIN_GAP_MS) return;
    last.set(client.sessionId, now);
    room.broadcast('chat', { sid: client.sessionId, name: seat.name, id });
  });
}
