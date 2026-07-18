// IndexedDB wrapper — no external dependencies, promise-based.
const DB_NAME = 'kyushu-expense-db';
const DB_VERSION = 3;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('people')) {
        db.createObjectStore('people', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('expenses')) {
        const store = db.createObjectStore('expenses', { keyPath: 'id', autoIncrement: true });
        store.createIndex('date', 'date');
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function wrapReq(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const DB = {
  // ---- settings ----
  async getSettings() {
    const store = await tx('settings', 'readonly');
    return wrapReq(store.get('main'));
  },
  async saveSettings(settings) {
    const store = await tx('settings', 'readwrite');
    return wrapReq(store.put({ ...settings, id: 'main' }));
  },

  // ---- people ----
  async getPeople() {
    const store = await tx('people', 'readonly');
    return wrapReq(store.getAll());
  },
  async addPerson(name) {
    const store = await tx('people', 'readwrite');
    return wrapReq(store.add({ name, archived: false }));
  },
  async updatePerson(person) {
    const store = await tx('people', 'readwrite');
    return wrapReq(store.put(person));
  },
  async deletePerson(id) {
    const store = await tx('people', 'readwrite');
    return wrapReq(store.delete(id));
  },

  // ---- expenses ----
  async getExpenses() {
    const store = await tx('expenses', 'readonly');
    return wrapReq(store.getAll());
  },
  async getExpense(id) {
    const store = await tx('expenses', 'readonly');
    return wrapReq(store.get(id));
  },
  async addExpense(expense) {
    const store = await tx('expenses', 'readwrite');
    return wrapReq(store.add(expense));
  },
  async updateExpense(expense) {
    const store = await tx('expenses', 'readwrite');
    return wrapReq(store.put(expense));
  },
  async deleteExpense(id) {
    const store = await tx('expenses', 'readwrite');
    return wrapReq(store.delete(id));
  },
};
