// Хранилище на телефоне. Каждое изменение записывается сразу.
const DB_NAME = 'poker-diary';
let db;

const open = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore('sessions', { keyPath: 'id' });
    request.result.createObjectStore('hands', { keyPath: 'id' });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const run = (name, work) => new Promise((resolve, reject) => {
  const tx = db.transaction(name, 'readwrite');
  work(tx.objectStore(name));
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});

const all = (name) => new Promise((resolve, reject) => {
  const request = db.transaction(name).objectStore(name).getAll();
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export async function load() {
  db = await open();
  return { sessions: await all('sessions'), hands: await all('hands') };
}

export const putSession = (s) => run('sessions', (o) => o.put(s));
export const putHand = (h) => run('hands', (o) => o.put(h));
export const deleteHand = (id) => run('hands', (o) => o.delete(id));
export const deleteSession = (id, handIds) => Promise.all([
  run('sessions', (o) => o.delete(id)),
  run('hands', (o) => handIds.forEach((handId) => o.delete(handId))),
]);
export const putMany = (sessions, hands) => Promise.all([
  run('sessions', (o) => sessions.forEach((s) => o.put(s))),
  run('hands', (o) => hands.forEach((h) => o.put(h))),
]);
