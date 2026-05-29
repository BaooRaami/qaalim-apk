const db = (() => {
  const DB_NAME    = 'qaalim_db';
  const DB_VERSION = 6;
  const STORE      = 'articles';
  const CACHE      = 'daily_cache';
  const OPENED     = 'opened_cache';
  const READ       = 'read_cache';
  const FOLLOWED   = 'followed_authors';
  const SETTINGS   = 'settings';

  let _db = null;

  // ── Init ────────────────────────────────────────────────────────
  function init() {
    return new Promise((resolve, reject) => {
      if (_db) { resolve(_db); return; }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const database = event.target.result;
        if (!database.objectStoreNames.contains(STORE)) {
          const store = database.createObjectStore(STORE, { keyPath: 'url' });
          store.createIndex('savedAt', 'savedAt', { unique: false });
        }
        if (!database.objectStoreNames.contains(CACHE)) {
          database.createObjectStore(CACHE, { keyPath: 'date' });
        }
        if (!database.objectStoreNames.contains(OPENED)) {
          database.createObjectStore(OPENED, { keyPath: 'url' });
        }
        if (!database.objectStoreNames.contains(READ)) {
          database.createObjectStore(READ, { keyPath: 'url' });
        }
        if (!database.objectStoreNames.contains(FOLLOWED)) {
          database.createObjectStore(FOLLOWED, { keyPath: 'name' });
        }
        if (!database.objectStoreNames.contains(SETTINGS)) {
          database.createObjectStore(SETTINGS, { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        _db = event.target.result;
        resolve(_db);
      };

      request.onerror = (event) => {
        console.error('Qaalim DB: Failed to open.', event.target.error);
        reject(event.target.error);
      };
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────
  function getStore(mode = 'readonly') {
    return _db.transaction(STORE, mode).objectStore(STORE);
  }

  function getCacheStore(mode = 'readonly') {
    return _db.transaction(CACHE, mode).objectStore(CACHE);
  }

  function getSettingsStore(mode = 'readonly') {
    return _db.transaction(SETTINGS, mode).objectStore(SETTINGS);
  }

  function getOpenedStore(mode = 'readonly') {
    return _db.transaction(OPENED, mode).objectStore(OPENED);
  }

  function run(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror  = () => reject(request.error);
    });
  }

  // ── Articles ─────────────────────────────────────────────────────
  function saveArticle(article) {
    article.savedAt = article.savedAt || Date.now();
    return run(getStore('readwrite').put(article));
  }

  function getAllArticles() {
    return run(getStore().getAll());
  }

  function deleteArticle(url) {
    return run(getStore('readwrite').delete(url));
  }

  function isArticleSaved(url) {
    return run(getStore().get(url)).then(result => !!result);
  }

  function getArticle(url) {
    return run(getStore().get(url));
  }

  // ── Daily Cache ──────────────────────────────────────────────────
  function saveDailyCache(date, articles) {
    return run(getCacheStore('readwrite').put({ date, articles }));
  }

  function getDailyCache(date) {
    return run(getCacheStore().get(date));
  }

  function clearDailyCache() {
    return run(getCacheStore('readwrite').clear());
  }

  function saveTextSettings(settings) {
    return run(getSettingsStore('readwrite').put({ key: 'text', settings }));
  }

  function getTextSettings() {
    return run(getSettingsStore().get('text')).then(r => {
      return r?.settings || null;
    });
  }
  // ── Opened Cache ─────────────────────────────────────────────────
  function saveOpenedArticle(url, title, paragraphs) {
    return run(getOpenedStore('readwrite').put({ url, title, paragraphs, savedAt: Date.now() }));
  }

  function getOpenedArticle(url) {
    return run(getOpenedStore().get(url));
  }

  function clearOpenedCache() {
    return run(getOpenedStore('readwrite').clear());
  }

  function getAllOpenedArticles() {
    return run(getOpenedStore().getAll());
  }

  // ── Read Cache ────────────────────────────────────────────────────
  function getReadStore(mode = 'readonly') {
    return _db.transaction(READ, mode).objectStore(READ);
  }

  // ── Followed Authors ──────────────────────────────────────────────
  function getFollowedStore(mode = 'readonly') {
    return _db.transaction(FOLLOWED, mode).objectStore(FOLLOWED);
  }

  function followAuthor(name) {
    return run(getFollowedStore('readwrite').put({ name }));
  }

  function unfollowAuthor(name) {
    return run(getFollowedStore('readwrite').delete(name));
  }

  function getAllFollowed() {
    return run(getFollowedStore().getAll());
  }

  function markRead(url) {
    return run(getReadStore('readwrite').put({ url, readAt: Date.now() }));
  }

  function getAllRead() {
    return run(getReadStore().getAll());
  }

  function clearReadCache() {
    return run(getReadStore('readwrite').clear());
  }

  // ── Public API ───────────────────────────────────────────────────
  return {
    init,
    saveArticle, getAllArticles, deleteArticle, isArticleSaved, getArticle,
    saveDailyCache, getDailyCache, clearDailyCache,
    saveOpenedArticle, getOpenedArticle, clearOpenedCache, getAllOpenedArticles,
    saveTextSettings, getTextSettings,
    markRead, getAllRead, clearReadCache,
    followAuthor, unfollowAuthor, getAllFollowed,
  };
})();