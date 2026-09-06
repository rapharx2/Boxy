globalThis.browser ??= globalThis.chrome;
// BoxyDB: helper global de IndexedDB para guardar previews (base64), arquivos
// de texto completo (archives) e desenhos (sketches) fora do storage.local
globalThis.BoxyDB = (() => {
  const DB_NAME = 'boxy';
  const DB_VERSION = 3; // v2: store 'archives'; v3: store 'sketches' (desenhos vetoriais)
  const STORE = 'previews';
  const ARCHIVE_STORE = 'archives';
  const SKETCH_STORE = 'sketches';
  let dbPromise = null;

  function openDB() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          // Cria apenas os stores que faltam — nunca destrói os existentes
          if (!req.result.objectStoreNames.contains(STORE)) {
            req.result.createObjectStore(STORE);
          }
          if (!req.result.objectStoreNames.contains(ARCHIVE_STORE)) {
            req.result.createObjectStore(ARCHIVE_STORE);
          }
          if (!req.result.objectStoreNames.contains(SKETCH_STORE)) {
            req.result.createObjectStore(SKETCH_STORE);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => { dbPromise = null; reject(req.error); };
      });
    }
    return dbPromise;
  }

  function withStore(storeName, mode, fn) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const req = fn(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
  }

  function getAllKeysOf(storeName) {
    return withStore(storeName, 'readonly', store => store.getAllKeys());
  }

  return {
    setPreview(id, dataUrl) {
      return withStore(STORE, 'readwrite', store => store.put(dataUrl, id));
    },
    getPreview(id) {
      return withStore(STORE, 'readonly', store => store.get(id));
    },
    deletePreview(id) {
      return withStore(STORE, 'readwrite', store => store.delete(id));
    },
    getAllPreviews() {
      return openDB().then(db => new Promise((resolve, reject) => {
        const map = {};
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            map[cursor.key] = cursor.value;
            cursor.continue();
          } else {
            resolve(map);
          }
        };
        req.onerror = () => reject(req.error);
      }));
    },
    // --- Arquivo permanente (texto completo do artigo) ---
    setArchive(id, data) {
      return withStore(ARCHIVE_STORE, 'readwrite', store => store.put(data, id));
    },
    getArchive(id) {
      return withStore(ARCHIVE_STORE, 'readonly', store => store.get(id))
        .then(value => value ?? null);
    },
    deleteArchive(id) {
      return withStore(ARCHIVE_STORE, 'readwrite', store => store.delete(id));
    },
    getAllArchiveIds() {
      return getAllKeysOf(ARCHIVE_STORE);
    },
    // --- Sketch (#11): desenhos vetoriais + fundo (screenshot) ---
    setSketch(id, data) {
      return withStore(SKETCH_STORE, 'readwrite', store => store.put(data, id));
    },
    getSketch(id) {
      return withStore(SKETCH_STORE, 'readonly', store => store.get(id))
        .then(value => value ?? null);
    },
    deleteSketch(id) {
      return withStore(SKETCH_STORE, 'readwrite', store => store.delete(id));
    },
    getAllSketchIds() {
      return getAllKeysOf(SKETCH_STORE);
    }
  };
})();
