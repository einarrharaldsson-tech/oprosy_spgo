const DB_NAME = 'oprosy-offline-conduct';
const DB_VERSION = 1;
const SESSION_STORE = 'conduct_sessions';
const CHUNK_STORE = 'conduct_audio_chunks';

let dbPromise = null;

function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB error'));
  });
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        const sessions = db.createObjectStore(SESSION_STORE, {
          keyPath: 'localSessionId',
        });
        sessions.createIndex('by_status', 'status', { unique: false });
        sessions.createIndex('by_survey', 'surveyId', { unique: false });
        sessions.createIndex('by_updated_at', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(CHUNK_STORE)) {
        const chunks = db.createObjectStore(CHUNK_STORE, {
          keyPath: ['localSessionId', 'chunkIndex'],
        });
        chunks.createIndex('by_session', 'localSessionId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

async function withStore(storeName, mode, handler) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    Promise.resolve(handler(store))
      .then((value) => {
        result = value;
      })
      .catch((err) => {
        reject(err);
        try {
          tx.abort();
        } catch {
          /* ignore */
        }
      });
  });
}

function sessionNow() {
  return new Date().toISOString();
}

export function createLocalSessionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function saveConductSession(session) {
  const record = {
    retryCount: 0,
    uploadedChunkIndexes: [],
    totalChunks: 0,
    ...session,
    updatedAt: sessionNow(),
  };
  return withStore(SESSION_STORE, 'readwrite', async (store) => {
    await promisifyRequest(store.put(record));
    return record;
  });
}

export async function patchConductSession(localSessionId, patch) {
  return withStore(SESSION_STORE, 'readwrite', async (store) => {
    const current = (await promisifyRequest(store.get(localSessionId))) || {
      localSessionId,
      createdAt: sessionNow(),
    };
    const next = {
      retryCount: 0,
      uploadedChunkIndexes: [],
      totalChunks: 0,
      ...current,
      ...patch,
      localSessionId,
      updatedAt: sessionNow(),
    };
    await promisifyRequest(store.put(next));
    return next;
  });
}

export async function getConductSession(localSessionId) {
  return withStore(SESSION_STORE, 'readonly', (store) =>
    promisifyRequest(store.get(localSessionId))
  );
}

export async function listConductSessions() {
  return withStore(SESSION_STORE, 'readonly', async (store) => {
    const rows = await promisifyRequest(store.getAll());
    return rows.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  });
}

export async function listPendingConductSessions() {
  const rows = await listConductSessions();
  return rows.filter((row) => ['active', 'queued', 'uploading', 'failed'].includes(row.status));
}

export async function getLatestActiveSessionForSurvey(surveyId) {
  const rows = await listConductSessions();
  return (
    rows.find(
      (row) =>
        Number(row.surveyId) === Number(surveyId) &&
        ['active', 'queued', 'uploading', 'failed'].includes(row.status)
    ) || null
  );
}

export async function saveAudioChunk(localSessionId, chunkIndex, blob) {
  return withStore(CHUNK_STORE, 'readwrite', async (store) => {
    await promisifyRequest(
      store.put({
        localSessionId,
        chunkIndex,
        blob,
        size: blob.size,
        createdAt: sessionNow(),
      })
    );
  });
}

export async function getAudioChunk(localSessionId, chunkIndex) {
  return withStore(CHUNK_STORE, 'readonly', (store) =>
    promisifyRequest(store.get([localSessionId, chunkIndex]))
  );
}

export async function listAudioChunks(localSessionId) {
  return withStore(CHUNK_STORE, 'readonly', async (store) => {
    const index = store.index('by_session');
    const rows = await promisifyRequest(index.getAll(IDBKeyRange.only(localSessionId)));
    return rows.sort((a, b) => Number(a.chunkIndex) - Number(b.chunkIndex));
  });
}

export async function listAudioChunkIndexes(localSessionId) {
  const rows = await listAudioChunks(localSessionId);
  return rows.map((row) => Number(row.chunkIndex));
}

export async function deleteConductSession(localSessionId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([SESSION_STORE, CHUNK_STORE], 'readwrite');
    const sessions = tx.objectStore(SESSION_STORE);
    const chunks = tx.objectStore(CHUNK_STORE);
    const index = chunks.index('by_session');
    const request = index.openCursor(IDBKeyRange.only(localSessionId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    request.onerror = () => reject(request.error || new Error('IndexedDB cursor failed'));
    sessions.delete(localSessionId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IndexedDB delete failed'));
  });
}
