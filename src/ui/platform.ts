import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export const isNative = (): boolean => Capacitor.isNativePlatform();
export const platformName = (): 'android' | 'ios' | 'web' => Capacitor.getPlatform() as 'android' | 'ios' | 'web';

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);
}

/** true si la PWA se abrió desde la pantalla de inicio (modo app). */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

/* ---------------- Almacenamiento persistente ---------------- */

export interface StorageStatus {
  persisted: boolean | null; // null = el navegador no informa
  usage: number | null;
  quota: number | null;
}

export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function getStorageStatus(): Promise<StorageStatus> {
  try {
    const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
    const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
    return { persisted, usage: est?.usage ?? null, quota: est?.quota ?? null };
  } catch {
    return { persisted: null, usage: null, quota: null };
  }
}

/* ---------------- Archivos de respaldo ---------------- */

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

/**
 * Abre el menú nativo para COMPARTIR/GUARDAR el archivo (WhatsApp, AirDrop, correo, Bluetooth, Archivos...).
 * - Android (APK): escribe el archivo en la caché privada y abre la hoja nativa de compartir.
 * - iPhone (PWA): Web Share con archivo; si no está disponible, descarga el archivo.
 * Debe llamarse directamente desde una pulsación del usuario (requisito de iOS).
 */
export async function shareFile(filename: string, text: string, mime = 'application/json'): Promise<ShareOutcome> {
  if (isNative()) {
    const res = await Filesystem.writeFile({ path: filename, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
    try {
      await Share.share({ title: filename, files: [res.uri], dialogTitle: 'Guardar o enviar respaldo' });
      return 'shared';
    } catch (e) {
      if (String((e as Error)?.message ?? e).toLowerCase().includes('cancel')) return 'cancelled';
      throw e;
    }
  }
  const file = new File([text], filename, { type: mime });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare && nav.share && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: filename });
      return 'shared';
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'cancelled';
      // NotAllowedError u otro: usar descarga
    }
  }
  downloadFile(filename, text, mime);
  return 'downloaded';
}

export function downloadFile(filename: string, text: string, mime = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Android: guarda una copia en Documentos/InventarioMovil (carpeta pública que sobrevive a desinstalar la app). */
export async function saveToDocuments(filename: string, text: string): Promise<string> {
  try {
    const perm = await Filesystem.checkPermissions();
    if (perm.publicStorage !== 'granted') {
      const req = await Filesystem.requestPermissions();
      if (req.publicStorage !== 'granted') throw new Error('Permiso de almacenamiento denegado.');
    }
  } catch (e) {
    if ((e as Error).message?.includes('denegado')) throw e;
  }
  await Filesystem.writeFile({
    path: `InventarioMovil/${filename}`,
    data: text,
    directory: Directory.Documents,
    encoding: Encoding.UTF8,
    recursive: true,
  });
  return `Documentos/InventarioMovil/${filename}`;
}

/** Selector de archivos del sistema (Archivos en iPhone, selector de documentos en Android). */
export function pickTextFile(accept = 'application/json,.json,text/plain'): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      input.remove();
      if (!f) return resolve(null);
      if (f.size > 300 * 1024 * 1024) return reject(new Error('El archivo es demasiado grande para ser un respaldo de esta app.'));
      try {
        resolve({ name: f.name, text: await f.text() });
      } catch {
        reject(new Error('No se pudo leer el archivo seleccionado.'));
      }
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    document.body.appendChild(input);
    input.click();
  });
}

/* ---------------- Fotos ---------------- */

/** Reduce una imagen a máx. 1280 px y la convierte a JPEG para ahorrar espacio. */
export async function compressImage(file: File, maxSide = 1280, quality = 0.8): Promise<{ data: ArrayBuffer; mime: string; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('No se pudo leer la imagen.'));
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('El dispositivo no permite procesar imágenes.');
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality));
    if (!blob) throw new Error('No se pudo comprimir la imagen.');
    return { data: await blob.arrayBuffer(), mime: 'image/jpeg', width: w, height: h };
  } finally {
    URL.revokeObjectURL(url);
  }
}
