import { get, set } from 'idb-keyval';
import { cle } from './pages';

/** Un message de la discussion avec le tuteur. L'historique est gardé par feuille, sur cet appareil. */
export interface Message {
  role: 'eleve' | 'tuteur';
  texte: string;
  ts: number;
  /** Ligne concernée (ex. G7), si le message portait sur une ligne. */
  ligne?: string;
}

const MAX = 120;
let messages: Message[] = [];

export async function chargerConversation(): Promise<void> {
  messages = [];
  try {
    const raw = await get(cle('conversation'));
    if (Array.isArray(raw)) messages = raw.filter((m) => m && (m.role === 'eleve' || m.role === 'tuteur') && typeof m.texte === 'string');
  } catch (e) {
    console.warn('Lecture de la discussion impossible', e);
  }
}

function sauver(): void {
  set(cle('conversation'), messages).catch((e) => console.warn('Sauvegarde de la discussion impossible', e));
}

export function messagesConversation(): readonly Message[] {
  return messages;
}

export function ajouterMessage(role: Message['role'], texte: string, ligne?: string): void {
  messages = [...messages, { role, texte, ts: Date.now(), ...(ligne ? { ligne } : {}) }].slice(-MAX);
  sauver();
}

/** Les derniers échanges, sous la forme compacte envoyée à Claude (le serveur ne garde pas de conversation). */
export function derniers(n: number): { role: 'eleve' | 'tuteur'; texte: string }[] {
  return messages.slice(-n).map(({ role, texte }) => ({ role, texte }));
}

export function effacerConversation(): void {
  messages = [];
  sauver();
}
