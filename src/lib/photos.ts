import { createStore, del, get, set } from 'idb-keyval';
import { SERVER_MODE, api, apiHeaders, apiUrl } from './store';

/*
 * Proof photos. On their own, they're kept in IndexedDB (not in the main
 * state, so localStorage never fills up). With the sync server they are
 * uploaded, so the verifier can see them on their own phone; the server
 * deletes them once the task has been reviewed.
 */
const store = !SERVER_MODE && typeof indexedDB !== 'undefined' ? createStore('kazikwanza', 'photos') : undefined;

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',');
  const type = /data:([^;]+)/.exec(head)?.[1] ?? 'image/jpeg';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export async function savePhoto(taskId: string, dataUrl: string): Promise<void> {
  if (SERVER_MODE) {
    await api(`/photos/${encodeURIComponent(taskId)}`, { method: 'PUT', body: dataUrlToBlob(dataUrl), headers: { 'Content-Type': 'image/jpeg' } });
    return;
  }
  if (!store) return;
  await set(taskId, dataUrl, store);
}

/** A URL an <img> can show, or undefined when there is no photo. */
export async function loadPhoto(taskId: string): Promise<string | undefined> {
  if (SERVER_MODE) {
    const res = await fetch(apiUrl(`/photos/${encodeURIComponent(taskId)}`), { headers: apiHeaders(), cache: 'no-store' });
    if (!res.ok) return undefined;
    return URL.createObjectURL(await res.blob());
  }
  if (!store) return undefined;
  return get<string>(taskId, store);
}

export async function deletePhoto(taskId: string): Promise<void> {
  // The server removes photos itself once a task is reviewed or deleted.
  if (SERVER_MODE || !store) return;
  await del(taskId, store);
}

/** Shrinks a camera photo to at most 1024px on its long side as JPEG. */
export function compressImage(file: File, maxSide = 1024, quality = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Choose a photo'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      URL.revokeObjectURL(url);
      if (!ctx) {
        reject(new Error('Could not read that photo'));
        return;
      }
      // JPEG has no transparency; paint white behind see-through images.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that photo'));
    };
    img.src = url;
  });
}
