import { Injectable } from '@angular/core';
import { PendingUpload } from './models';

@Injectable({ providedIn: 'root' })
export class UploadStoreService {
  private dbp: Promise<IDBDatabase> | null = null;

  list(token: string): Promise<PendingUpload[]> {
    return this.transaction('readonly', store => store.getAll()).then(rows => {
      const all = (rows || []) as PendingUpload[];
      return all.filter(item => item.token === token);
    }).catch(() => []);
  }

  put(pending: PendingUpload): Promise<void> {
    return this.transaction('readwrite', store => store.put(pending)).then(() => undefined);
  }

  remove(localId: string): Promise<void> {
    return this.transaction('readwrite', store => store.delete(localId)).then(() => undefined).catch(() => undefined);
  }

  private open(): Promise<IDBDatabase> {
    if (this.dbp) {
      return this.dbp;
    }
    this.dbp = new Promise((resolve, reject) => {
      const request = indexedDB.open('epv-answer-sheets', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('pending')) {
          db.createObjectStore('pending', { keyPath: 'localId' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.dbp = null;
        reject(request.error);
      };
    });
    return this.dbp;
  }

  private transaction<T>(mode: 'readonly' | 'readwrite', run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return this.open().then(db => new Promise<T>((resolve, reject) => {
      const tx = db.transaction('pending', mode);
      const request = run(tx.objectStore('pending'));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));
  }
}
