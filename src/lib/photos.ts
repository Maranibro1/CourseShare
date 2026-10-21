import { createStore, del, get, set } from 'idb-keyval';

/**
 * Proof photos are kept in IndexedDB, not in the main state, so localStorage
 * never fills up. They are deleted once a task is approved.
 */
const store = typeof indexedDB !== 'undefined' ? createStore('kazikwanza', 'photos') : undefined;

export async function savePhoto(taskId: string, dataUrl: string): Promise<void> {
  if (!store) return;
  await set(taskId, dataUrl, store);
}

export async function loadPhoto(taskId: string): Promise<string | undefined> {
  if (!store) return undefined;
  return get<string>(taskId, store);
}

export async function deletePhoto(taskId: string): Promise<void> {
  if (!store) return;
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
