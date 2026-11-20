import { get, set } from 'idb-keyval';
import { cle } from './pages';

/** Photo d'énoncé jointe à une page : JPEG réduit, stocké en data URL (part avec la page à l'export et à chaque correction). */
export interface Photo {
  id: string;
  src: string;
  w: number;
  h: number;
  /** Photo posée sur la feuille : coin haut-gauche (x, y) et largeur l, en unités feuille (hauteur = l × h / w). Absente = seulement dans le panneau. */
  pos?: PosPhoto;
}

export interface PosPhoto {
  x: number;
  y: number;
  l: number;
}

export const LARGEUR_PHOTO_MIN = 60;

export const PHOTOS_MAX = 6;
const COTE_MAX = 1600; // plus grand côté, en pixels
const QUALITE = 0.85;

let liste: Photo[] = [];

const valide = (p: unknown): p is Photo => {
  const o = p as Partial<Photo> | null;
  return !!o && typeof o.id === 'string' && typeof o.src === 'string' && o.src.startsWith('data:image/') && typeof o.w === 'number' && typeof o.h === 'number' &&
    (o.pos === undefined || (!!o.pos && [o.pos.x, o.pos.y, o.pos.l].every((v) => typeof v === 'number' && Number.isFinite(v)) && o.pos.l > 0));
};

export async function chargerPhotos(): Promise<void> {
  liste = [];
  try {
    const raw = await get(cle('photos'));
    if (Array.isArray(raw)) liste = raw.filter(valide).slice(0, PHOTOS_MAX);
  } catch (e) {
    console.warn('Lecture des photos impossible', e);
  }
}

function sauver(): void {
  set(cle('photos'), liste).catch((e) => console.warn('Sauvegarde des photos impossible', e));
}

export const listePhotos = (): readonly Photo[] => liste;
export const photosPourServeur = (): string[] => liste.map((p) => p.src);

/** Remplace toutes les photos (import d'une page). */
export function remplacerPhotos(photos: Photo[]): void {
  liste = photos.filter(valide).slice(0, PHOTOS_MAX);
  sauver();
}

/** Pose la photo sur la feuille (ou l'en retire si pos est absent). `sauvegarder: false` pendant un geste, puis sauverPhotos() à la fin. */
export function definirPos(id: string, pos: PosPhoto | undefined, sauvegarder = true): void {
  liste = liste.map((x) => (x.id === id ? { ...x, pos } : x));
  if (sauvegarder) sauver();
}

export const sauverPhotos = sauver;

export function ajouterPhoto(p: Omit<Photo, 'id'>): Photo | null {
  if (liste.length >= PHOTOS_MAX) return null;
  const photo = { ...p, id: crypto.randomUUID() };
  liste = [...liste, photo];
  sauver();
  return photo;
}

export function modifierPhoto(id: string, p: Omit<Photo, 'id'>): void {
  liste = liste.map((x) => (x.id === id ? { ...x, ...p } : x));
  sauver();
}

export function retirerPhoto(id: string): void {
  liste = liste.filter((p) => p.id !== id);
  sauver();
}

function charger(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, ko) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => ko(new Error('image illisible'));
    img.src = src;
  });
}

/** Dessine `source` (image entière ou partie) dans un canvas réduit à COTE_MAX et renvoie le JPEG. */
function versJpeg(img: HTMLImageElement, x = 0, y = 0, w = img.naturalWidth, h = img.naturalHeight): Omit<Photo, 'id'> {
  const k = Math.min(1, COTE_MAX / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * k));
  const ch = Math.max(1, Math.round(h * k));
  const c = Object.assign(document.createElement('canvas'), { width: cw, height: ch });
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff'; // fond blanc pour les PNG transparents
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(img, x, y, w, h, 0, 0, cw, ch);
  return { src: c.toDataURL('image/jpeg', QUALITE), w: cw, h: ch };
}

/** Fichier choisi (appareil photo ou photothèque) → photo réduite. L'orientation EXIF est appliquée par le navigateur. */
export async function fichierVersPhoto(f: File): Promise<Omit<Photo, 'id'>> {
  const url = URL.createObjectURL(f);
  try {
    return versJpeg(await charger(url));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Recadre une photo : (x, y, w, h) en pixels de la photo. */
export async function recadrer(p: Photo, x: number, y: number, w: number, h: number): Promise<Omit<Photo, 'id'>> {
  const img = await charger(p.src);
  const cx = Math.max(0, Math.min(img.naturalWidth - 1, Math.round(x)));
  const cy = Math.max(0, Math.min(img.naturalHeight - 1, Math.round(y)));
  return versJpeg(img, cx, cy, Math.max(1, Math.min(img.naturalWidth - cx, Math.round(w))), Math.max(1, Math.min(img.naturalHeight - cy, Math.round(h))));
}

/**
 * Recadre la photo `id` et met à jour la liste. Sur la feuille, le contenu garde sa taille et sa place :
 * le coin haut-gauche avance du décalage du cadrage, la largeur suit le nouveau nombre de pixels.
 */
export async function recadrerPhoto(id: string, x: number, y: number, w: number, h: number): Promise<Photo> {
  const p = liste.find((q) => q.id === id);
  if (!p) throw new Error('photo introuvable');
  const nouvelle = await recadrer(p, x, y, w, h);
  const k = p.pos ? p.pos.l / p.w : 1; // unités feuille par pixel de photo
  const pos = p.pos ? { x: p.pos.x + Math.max(0, x) * k, y: p.pos.y + Math.max(0, y) * k, l: nouvelle.w * k } : undefined;
  const maj: Photo = { ...p, ...nouvelle, pos };
  liste = liste.map((q) => (q.id === id ? maj : q));
  sauver();
  return maj;
}
