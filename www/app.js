const { createApp, ref, computed, onMounted, watch } = Vue;

createApp({
  setup() {
    const appReady = ref(false);
    const activeTab = ref('home');
    const activeArticle = ref(null);
    const searchActive = ref(false);
    const searchQuery = ref('');
    const searchInputRef = ref(null);
    const activeChip = ref('today');
    const proxyUrls = [
      'https://api.codetabs.com/v1/proxy?quest=',
      'https://corsproxy.io/?url='
    ];
    const baseUrl = 'https://dailyurducolumns.com';
    const currentProxyIndex = ref(0);
    const todayArticles = ref([]);
    const cachedUrls = ref(new Set());
    const readUrls = ref(new Set());
    const dateArticles = ref([]);
    const authorArticles = ref([]);
    const activeAuthorLabel = ref('');
    const authorArticlePage = ref(1);
    const authorHasMore = ref(false);
    const activeAuthorSlug = ref('');
    const loadingMore = ref(false);
    const loading = ref(false);
    const error = ref(null);

    const selectedDateLabel = ref('');
    const currentDateKey = ref('');

    // ── Article View State ───────────────────────────────────────────
    const articleContent = ref({ title: '', paragraphs: [] });
    const articleLoading = ref(false);
    const articleError = ref(null);

    const textOptionsOpen = ref(false);
    const articleBodyRef = ref(null);
    const downloadAllHomeState = ref(false);
    const downloadAllSavedState = ref(false);
    const savedArticles = ref([]);
    const fontSize = ref(20);
    const lineHeight = ref(2);
    const textAlign = ref('justify');
    const autoScrollActive = ref(false);

    const fontSizeMin = 12;
    const fontSizeMax = 32;
    const fontSizeStep = 1;
    const lineHeightMin = 1;
    const lineHeightMax = 3;
    const lineHeightStep = 0.1;
    const scrollSpeedMin = 1;
    const scrollSpeedMax = 10;
    const scrollSpeedStep = 1;
    const scrollSpeed = ref(1);
    const theme = ref('midnight');

    // ── Author Sheet State ───────────────────────────────────────────
    const authorSheetOpen = ref(false);
    const exitWarningActive = ref(false);    
    const authorSearch = ref('');
    const allAuthors = ref([]);
    const followedAuthors = ref(new Set());
    const authorPageSize = 50;
    const authorPage = ref(1);
    const authorSentinelRef = ref(null);
    let authorObserver = null;

    function adjustFontSize(delta) {
      const next = fontSize.value + delta;
      if (next >= fontSizeMin && next <= fontSizeMax) fontSize.value = next;
    }

    function adjustLineHeight(delta) {
      const next = Math.round((lineHeight.value + delta) * 10) / 10;
      if (next >= lineHeightMin && next <= lineHeightMax) lineHeight.value = next;
    }

    function setTextAlign(align) {
      textAlign.value = align;
    }

    function toggleAutoScroll() {
      autoScrollActive.value = !autoScrollActive.value;
    }

    function adjustScrollSpeed(delta) {
      const next = scrollSpeed.value + delta;
      if (next >= scrollSpeedMin && next <= scrollSpeedMax) scrollSpeed.value = next;
    }

    function setTheme(newTheme) {
      theme.value = newTheme;
      document.documentElement.classList.remove('theme-midnight', 'theme-warm-dark', 'theme-paper', 'theme-forest', 'theme-slate');
      document.documentElement.classList.add('theme-' + newTheme);
      saveSettings();
    }

    async function openAuthorSheet() {
      authorSheetOpen.value = true;
      authorPage.value = 1;
      if (allAuthors.value.length === 0) {
        try {
          const res = await fetch('0libs/authors.json');
          const data = await res.json();
          allAuthors.value = data.authors || [];
        } catch (e) {
          allAuthors.value = [];
        }
      }
      await Vue.nextTick();
      const input = document.querySelector('.author-search-input');
      if (input) input.focus();
    }

    function closeAuthorSheet() {
      teardownAuthorObserver();
      authorSheetOpen.value = false;
      authorSearch.value = '';
    }

    function onAuthorSearchEnter() {
      const visible = filteredAuthors.value;
      if (visible.length === 1) scrapeAuthor(visible[0]);
    }

    async function toggleFollowAuthor(name) {
      if (followedAuthors.value.has(name)) {
        followedAuthors.value.delete(name);
        await db.unfollowAuthor(name);
      } else {
        followedAuthors.value.add(name);
        await db.followAuthor(name);
      }
      followedAuthors.value = new Set(followedAuthors.value);
    }

    async function refreshFollowedAuthors() {
      const all = await db.getAllFollowed();
      followedAuthors.value = new Set(all.map(a => a.name));
    }

    async function refreshSavedArticles() {
      savedArticles.value = await db.getAllArticles();
    }

    async function toggleSaveArticle() {
      if (!activeArticle.value) return;
      const a = activeArticle.value;
      const existing = savedArticles.value.find(s => s.url === a.url);
      if (existing) {
        await db.deleteArticle(a.url);
        showToast('Article removed from Saved');
      } else {
        const article = { url: a.url, title: a.title, author: a.author, date: a.date, savedAt: Date.now() };
        if (downloadAllSavedState.value || articleContent.value.title) {
          try {
            const proxyUrl = buildProxyUrl(a.url);
            const res = await fetch(proxyUrl);
            const html = await res.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const parsed = parseUrduContent(doc);
            if (parsed) {
              article.urduTitle = parsed.title || a.title;
              article.paragraphs = parsed.paragraphs;
            }
          } catch (e) { /* fetch failed, save without paragraphs */ }
        }
        await db.saveArticle(article);
        showToast('Article saved');
      }
      await refreshSavedArticles();
    }

    async function openSavedArticle(article) {
      activeArticle.value = article;
      await db.markRead(article.url);
      readUrls.value.add(article.url);
      articleLoading.value = true;
      articleError.value = null;
      articleContent.value = { title: '', paragraphs: [] };

      try {
        const cached = await db.getArticle(article.url);
        if (cached && cached.paragraphs && cached.paragraphs.length > 0) {
          articleContent.value = { title: cached.urduTitle || cached.title || article.title, paragraphs: cached.paragraphs };
          articleLoading.value = false;
          return;
        }

        const proxyUrl = buildProxyUrl(article.url);
        const res = await fetch(proxyUrl);
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const parsed = parseUrduContent(doc);
        if (!parsed) {
          articleError.value = 'Could not find article content.';
          articleLoading.value = false;
          return;
        }
        articleContent.value = parsed;
        if (downloadAllSavedState.value) {
          await db.saveArticle({ url: article.url, title: article.title, author: article.author, date: article.date, urduTitle: parsed.title || article.urduTitle || article.title, paragraphs: parsed.paragraphs, savedAt: article.savedAt || Date.now() });
          await refreshSavedArticles();
        }
      } catch (e) {
        articleError.value = e.message;
      } finally {
        articleLoading.value = false;
      }
    }

    async function downloadAllSavedArticles() {
      const toDownload = savedArticles.value.filter(a => !a.paragraphs || a.paragraphs.length === 0);
      if (toDownload.length === 0) { showToast('All saved articles already downloaded ✓'); return; }
      const total = toDownload.length;
      let success = 0;
      for (const a of toDownload) {
        toastMessage.value = `Downloading saved ${success + 1} of ${total}…`;
        toastVisible.value = true;
        if (toastTimer) clearTimeout(toastTimer);
        try {
          const proxyUrl = buildProxyUrl(a.url);
          const res = await fetch(proxyUrl);
          const html = await res.text();
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const parsed = parseUrduContent(doc);
          if (!parsed) continue;
          const plain = { url: a.url, title: a.title, author: a.author, date: a.date, paragraphs: parsed.paragraphs, savedAt: a.savedAt || Date.now() };
          await db.saveArticle(plain);
          success++;
        } catch (e) { /* skip failed */ }
      }
      await refreshSavedArticles();
      showToast(`Downloaded ${success} of ${total} saved articles ✓`);
    }

    const filteredAuthorsAll = computed(() => {
      const q = authorSearch.value.trim().toLowerCase();
      if (!q) return allAuthors.value;
      return allAuthors.value.filter(name => name.toLowerCase().includes(q));
    });

    const filteredAuthors = computed(() => {
      return filteredAuthorsAll.value.slice(0, authorPage.value * authorPageSize);
    });

    const hasMoreAuthors = computed(() => {
      return filteredAuthors.value.length < filteredAuthorsAll.value.length;
    });

    function setupAuthorObserver() {
      if (authorObserver) { authorObserver.disconnect(); authorObserver = null; }
      const sentinel = authorSentinelRef.value;
      if (!sentinel) return;
      authorObserver = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasMoreAuthors.value) {
          authorPage.value++;
        }
      }, { threshold: 0.1 });
      authorObserver.observe(sentinel);
    }

    function teardownAuthorObserver() {
      if (authorObserver) { authorObserver.disconnect(); authorObserver = null; }
    }

    const followedAuthorsList = computed(() => {
      return allAuthors.value.filter(name => followedAuthors.value.has(name));
    });

    const isArticleSaved = computed(() => {
      if (!activeArticle.value) return false;
      return savedArticles.value.some(a => a.url === activeArticle.value.url);
    });

    const filteredHomeArticles = computed(() => {
      const source = activeChip.value === 'today' ? todayArticles.value : activeChip.value === 'date' ? dateArticles.value : authorArticles.value;
      if (!searchQuery.value.trim()) return source;
      return source.filter(a => matchesSearch(a, searchQuery.value));
    });

    const filteredSavedArticles = computed(() => {
      if (!searchQuery.value.trim()) return savedArticles.value;
      return savedArticles.value.filter(a => matchesSearch(a, searchQuery.value));
    });

    function openTextOptions() {
      textOptionsOpen.value = true;
    }

    function closeTextOptions() {
      textOptionsOpen.value = false;
      saveSettings();

    }

    async function refreshCachedUrls() {
      const all = await db.getAllOpenedArticles();
      cachedUrls.value = new Set(all.map(a => a.url));
    }

    async function refreshReadUrls() {
      const all = await db.getAllRead();
      readUrls.value = new Set(all.map(a => a.url));
    }

    async function toggleDownloadAllHome() {
      downloadAllHomeState.value = !downloadAllHomeState.value;
      saveSettings();
      if (downloadAllHomeState.value && todayArticles.value.length > 0) {
        await downloadAllHomeArticles(todayArticles.value);
      }
    }

    async function toggleDownloadAllSaved() {
      downloadAllSavedState.value = !downloadAllSavedState.value;
      saveSettings();
      if (downloadAllSavedState.value && savedArticles.value.length > 0) {
        await downloadAllSavedArticles();
      }
    }

    function saveSettings() {
      db.saveTextSettings({ fontSize: fontSize.value, lineHeight: lineHeight.value, textAlign: textAlign.value, scrollSpeed: scrollSpeed.value, downloadAllHome: downloadAllHomeState.value, downloadAllSaved: downloadAllSavedState.value , theme: theme.value });
    }

    async function loadTextSettings() {
      const saved = await db.getTextSettings();
      if (saved) {
        fontSize.value = saved.fontSize ?? 18;
        lineHeight.value = saved.lineHeight ?? 2;
        textAlign.value = saved.textAlign ?? 'right';
        scrollSpeed.value = saved.scrollSpeed ?? 3;
        downloadAllHomeState.value = saved.downloadAllHome ?? false;
        downloadAllSavedState.value = saved.downloadAllSaved ?? false;
      
        theme.value = saved.theme ?? 'midnight';
        document.documentElement.className = 'theme-' + theme.value;
      }
    }

    const homeBarTitle = computed(() => {
      if (activeChip.value === 'date' && selectedDateLabel.value) return 'Articles from ' + selectedDateLabel.value;
      if (activeChip.value === 'author' && activeAuthorLabel.value) return 'Articles by ' + activeAuthorLabel.value;
      return 'Latest Articles';
    });

    const tabs = [
      { id: 'home', label: 'Home', icon: 'home' },
      { id: 'feed', label: 'Feed', icon: 'feed' },
      { id: 'saved', label: 'Saved', icon: 'saved' },
      { id: 'settings', label: 'Settings', icon: 'settings' },
    ];

    // ── Date Helpers ─────────────────────────────────────────────────
    function getTodayKey() {
      const today = new Date();
      const y = today.getFullYear();
      const m = String(today.getMonth() + 1).padStart(2, '0');
      const d = String(today.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    // Formats a YYYY-MM-DD string to "Month DD, YYYY" for display
    function formatDisplayDate(key) {
      const [y, m, d] = key.split('-');
      return `${monthNames[parseInt(m) - 1]} ${d}, ${y}`;
    }

    // Converts article date string (e.g. "July 15, 2025") to YYYY-MM-DD
    function parseArticleDate(dateStr) {
      if (!dateStr) return null;
      const parts = dateStr.replace(',', '').split(' ');
      if (parts.length < 3) return null;
      const mIdx = monthNames.findIndex(mn => mn.toLowerCase() === parts[0].toLowerCase());
      if (mIdx === -1) return null;
      const m = String(mIdx + 1).padStart(2, '0');
      const d = String(parts[1]).padStart(2, '0');
      const y = parts[2];
      return `${y}-${m}-${d}`;
    }

    // ── Article Parser ───────────────────────────────────────────────
    function parseArticles(doc) {
      return [...doc.querySelectorAll('.cat-box.recent-box .cat-box-content article.item-list')].map(a => {
        const titleA = a.querySelector('h2.post-box-title a');
        const authorA = a.querySelector('.post-meta-author a');
        const dateEl = a.querySelector('.tie-date');
        const href = titleA?.getAttribute('href') || '';
        return {
          title: titleA?.textContent.trim() || '',
          author: authorA?.textContent.trim() || '',
          date: dateEl?.textContent.trim() || '',
          url: href.startsWith('http') ? href : baseUrl + href,
        };
      });
    }

    // ── Today Articles: Offline-First Logic ──────────────────────────
    async function fetchLatestArticles() {
      const res = await fetchWithProxySwitch(baseUrl + '/LstColumns.aspx');
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return parseArticles(doc);
    }

    async function loadTodayArticles() {
      loading.value = true;
      error.value = null;
      todayArticles.value = [];

      const todayKey = getTodayKey();

      try {
        // Step 1: Check if today's cache exists — no network needed at all
        const todayCache = await db.getDailyCache(todayKey);
        if (todayCache && todayCache.articles && todayCache.articles.length > 0) {
          todayArticles.value = todayCache.articles;
          loading.value = false;
          return;
        }

        // Step 2: No today-cache — show latest cached articles instantly if available
        const latestCache = await db.getDailyCache('__latest__');
        if (latestCache && latestCache.articles && latestCache.articles.length > 0) {
          todayArticles.value = latestCache.articles;
          loading.value = false;
          // Step 3: Fetch in background
          backgroundFetch(todayKey);
          return;
        }

        // Step 4: No cache at all — show skeleton and fetch normally
        let fetched = [];
        try {
          fetched = await fetchLatestArticles();
        } catch (networkErr) {
          error.value = 'No internet connection and no cached articles.';
          loading.value = false;
          return;
        }

        const firstArticleDate = fetched.length > 0 ? parseArticleDate(fetched[0].date) : null;
        const datesMatch = firstArticleDate === todayKey;
        if (datesMatch) {
          await db.clearDailyCache();
          await db.clearOpenedCache();
          await db.clearReadCache();
          await db.saveDailyCache(todayKey, fetched);
        }
        await db.saveDailyCache('__latest__', fetched);
        todayArticles.value = fetched;
        if (downloadAllHomeState.value) downloadAllHomeArticles(fetched);

      } catch (e) {
        error.value = e.message;
      } finally {
        loading.value = false;
      }
    }

    async function backgroundFetch(todayKey) {
      showToast('Checking for new articles…');
      try {
        const fetched = await fetchLatestArticles();

        const firstArticleDate = fetched.length > 0 ? parseArticleDate(fetched[0].date) : null;
        const datesMatch = firstArticleDate === todayKey;

        if (datesMatch) {
          await db.clearDailyCache();
          await db.clearOpenedCache();
          await db.clearReadCache();
          await db.saveDailyCache(todayKey, fetched);
          await db.saveDailyCache('__latest__', fetched);
          todayArticles.value = fetched;
          showToast('Fresh articles loaded ✓');
        } else {
          await db.saveDailyCache('__latest__', fetched);
          showToast('No new articles yet');
        }
        if (downloadAllHomeState.value) {
          const allCached = await Promise.all(fetched.map(a => db.getOpenedArticle(a.url)));
          const hasMissing = allCached.some(c => !c);
          if (hasMissing) await downloadAllHomeArticles(fetched);
        }
      } catch (e) {
        showToast('Could not reach server — showing cached');
      }
    }

    async function downloadAllHomeArticles(articles) {
      const toDownload = [];
      for (const a of articles) {
        const existing = await db.getOpenedArticle(a.url);
        if (!existing) toDownload.push(a);
      }
      if (toDownload.length === 0) { showToast('All articles already downloaded ✓'); return; }

      const total = toDownload.length;
      let done = 0;

      for (const a of toDownload) {
        toastMessage.value = `Downloading ${done + 1} of ${total}…`;
        toastVisible.value = true;
        if (toastTimer) clearTimeout(toastTimer);
        try {
          const proxyUrl = buildProxyUrl(a.url);
          const res = await fetch(proxyUrl);
          const html = await res.text();
          const doc = new DOMParser().parseFromString(html, 'text/html');

          const parsed = parseUrduContent(doc);
          if (!parsed) { done++; continue; }
          await db.saveOpenedArticle(a.url, parsed.title || a.title, parsed.paragraphs);
          await refreshCachedUrls();
        } catch (e) { /* skip failed article silently */ }
        done++;
      }
      showToast(`Downloaded ${done} of ${total} articles ✓`);
    }

    // ── Date-based scrape ────────────────────────────────
    async function scrape(path) {
      loading.value = true;
      error.value = null;
      dateArticles.value = [];
      try {
        const res = await fetchWithProxySwitch(baseUrl + path);
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        dateArticles.value = parseArticles(doc);
      } catch (e) {
        error.value = e.message;
      } finally {
        loading.value = false;
      }
    }

    // ── Author slug helper ───────────────────────────────
    function authorToSlug(name) {
      return name.trim().toLowerCase().replace(/\s+/g, '-');
    }

    // ── Author-based scrape ──────────────────────────────
    async function fetchAuthorPage(slug, page) {
      const res = await fetchWithProxySwitch(baseUrl + '/' + slug + '/' + page);
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return parseArticles(doc);
    }

    async function scrapeAuthor(name) {
      if (activeChip.value === 'author' && activeAuthorLabel.value === name) {
        closeAuthorSheet();
        return;
      }
      const slug = authorToSlug(name);
      activeAuthorLabel.value = name;
      activeAuthorSlug.value = slug;
      activeChip.value = 'author';
      authorArticles.value = [];
      authorArticlePage.value = 1;
      authorHasMore.value = false;
      loading.value = true;
      error.value = null;
      closeAuthorSheet();
      try {
        const articles = await fetchAuthorPage(slug, 1);
        authorArticles.value = articles;
        authorHasMore.value = articles.length > 0;
        if (articles.length === 0) error.value = 'No articles found for this author.';
      } catch (e) {
        error.value = e.message;
      } finally {
        loading.value = false;
      }
    }

    async function loadMoreAuthorArticles() {
      if (!authorHasMore.value || loadingMore.value) return;
      loadingMore.value = true;
      try {
        const nextPage = authorArticlePage.value + 1;
        const articles = await fetchAuthorPage(activeAuthorSlug.value, nextPage);
        if (articles.length === 0) {
          authorHasMore.value = false;
        } else {
          authorArticles.value = [...authorArticles.value, ...articles];
          authorArticlePage.value = nextPage;
        }
      } catch (e) {
        showToast('Could not load more articles.');
      } finally {
        loadingMore.value = false;
      }
    }

    // -- Date Picker --
    const dateInputRef = ref(null);
    const selectedDate = ref('');
    const maxDate = ref('');

    function openDateSheet() {
      maxDate.value = getTodayKey();
      const previous = selectedDate.value;
      selectedDate.value = '';
      const input = dateInputRef.value;
      if (input) {
        const onCancel = () => {
          selectedDate.value = previous;
          input.removeEventListener('blur', onCancel);
        };
        input.addEventListener('blur', onCancel);
        input.showPicker ? input.showPicker() : input.click();
      }
    }

    // ── Toast ────────────────────────────────────────────────────────
    const toastMessage = ref('');
    const toastVisible = ref(false);
    let toastTimer = null;

    function showToast(msg) {
      toastMessage.value = msg;
      toastVisible.value = true;
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toastVisible.value = false; }, 3000);
    }

    function onDateChange() {
      if (!selectedDate.value) return;
      const todayKey = getTodayKey();
      if (selectedDate.value === todayKey) {
        activeChip.value = 'today';
        selectedDateLabel.value = '';
        error.value = null;
        if (todayArticles.value.length === 0) loadTodayArticles();
        return;
      }
      if (activeChip.value === 'date' && selectedDate.value === currentDateKey.value) {
        return;
      }
      selectedDateLabel.value = formatDisplayDate(selectedDate.value);
      activeChip.value = 'date';
      currentDateKey.value = selectedDate.value;
      const [y, m, d] = selectedDate.value.split('-');
      const path = `/columns/${y}${m}${d}`;
      scrape(path);
    }

    function buildProxyUrl(articleUrl) {
      const path = articleUrl.replace(baseUrl + baseUrl, baseUrl).replace(baseUrl, '');
      return proxyUrls[currentProxyIndex.value] + baseUrl + path;
    }

    async function fetchWithProxySwitch(url) {
      let lastError = null;
      for (let i = 0; i < proxyUrls.length; i++) {
        const proxy = proxyUrls[i];
        try {
          const res = await fetch(proxy + url);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          if (i !== currentProxyIndex.value) {
            currentProxyIndex.value = i;
            showToast('Switched to alternate method');
          }
          return res;
        } catch (e) {
          lastError = e;
        }
      }
      throw lastError || new Error('All proxies failed');
    }

    function parseUrduContent(doc) {
      const articleEl = doc.querySelector('article.post.post-listing.hentry.the-post');
      let urduPost = articleEl ? articleEl.querySelector('.UrduPost') : null;
      if (!urduPost) {
        const allUrduPosts = [...doc.querySelectorAll('.UrduPost')];
        urduPost = allUrduPosts.find(div => div.querySelectorAll('p').length > 2);
      }
      if (!urduPost) return null;
      const titleEl = urduPost.querySelector('h2');
      const title = titleEl ? titleEl.textContent.trim() : '';
      const paragraphs = [...urduPost.querySelectorAll('p')]
        .map(p => p.textContent.trim())
        .filter(text => text.length > 0);
      return { title, paragraphs };
    }

    async function openArticle(article) {
      activeArticle.value = article;
      await db.markRead(article.url);
      readUrls.value.add(article.url);
      articleLoading.value = true;
      articleError.value = null;
      articleContent.value = { title: '', paragraphs: [] };

      try {
        // Step 1: Check opened_cache first (offline-first, always on)
        const cached = await db.getOpenedArticle(article.url);
        if (cached && cached.paragraphs && cached.paragraphs.length > 0) {
          articleContent.value = { title: cached.title, paragraphs: cached.paragraphs };
          articleLoading.value = false;
          return;
        }

        // Step 2: No cache — fetch from network
        const proxyUrl = buildProxyUrl(article.url);
        const res = await fetch(proxyUrl);
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');

        const parsed = parseUrduContent(doc);
        if (!parsed) {
          articleError.value = 'Could not find article content.';
          articleLoading.value = false;
          return;
        }
        articleContent.value = parsed;
        if (activeChip.value === 'today') {
          await db.saveOpenedArticle(article.url, parsed.title, parsed.paragraphs);
          await refreshCachedUrls();
        }

      } catch (e) {
        articleError.value = e.message;
      } finally {
        articleLoading.value = false;
      }
    }

    function closeArticle() {
      activeArticle.value = null;
      articleContent.value = { title: '', paragraphs: [] };
      articleError.value = null;
      autoScrollActive.value = false;
    }

    async function shareArticle() {
      if (!articleContent.value.title && articleContent.value.paragraphs.length === 0) return;

      const title = articleContent.value.title || '';
      const body = articleContent.value.paragraphs.join('\n\n');
      const shareText = title ? `*${title}*\n\n${body}` : body;

      if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        await window.Capacitor.Plugins.Share.share({ text: shareText });
      } else if (navigator.share) {
        await navigator.share({ text: shareText });
      } else {
        await navigator.clipboard.writeText(shareText);
        showToast('Article copied to clipboard');
      }
    }

    function handleBackButton() {
      // 1. Close search if open
      if (searchActive.value) { deactivateSearch(); return; }
      // 2. Close any open modal
      if (textOptionsOpen.value) { closeTextOptions(); return; }
      if (authorSheetOpen.value) { closeAuthorSheet(); return; }
      // 3. If in article view, go back to the tab it came from
      if (activeArticle.value) { closeArticle(); return; }
      // 4. If on any main tab other than Home, go to Home
      if (activeTab.value !== 'home') { activeTab.value = 'home'; return; }
      // 5. On Home tab — show exit warning toast
      if (!exitWarningActive.value) {
        exitWarningActive.value = true;
        showToast('Press back again to exit');
        setTimeout(() => { exitWarningActive.value = false; }, 2000);
        return;
      }
      // 6. Exit the app
      if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
        window.Capacitor.Plugins.App.exitApp();
      }    
    }

    let scrollInterval = null;
    let wakeLockSentinel = null;

    async function requestWakeLock() {
      if (!('wakeLock' in navigator)) return;
      try {
        wakeLockSentinel = await navigator.wakeLock.request('screen');
        wakeLockSentinel.addEventListener('release', () => {
          wakeLockSentinel = null;
        });
      } catch (e) { /* silently fail on unsupported browsers */ }
    }

    function releaseWakeLock() {
      if (wakeLockSentinel) {
        wakeLockSentinel.release();
        wakeLockSentinel = null;
      }
    }

    async function reacquireWakeLockIfNeeded() {
      if (autoScrollActive.value && !wakeLockSentinel) {
        await requestWakeLock();
      }
    }

    const skeletonLines = 'lllslllsllls'.replace(/\s/g, '').split('').map(c => ({ class: c === 'l' ? 'long' : 'short' }));
    const skeletonCards = 'ttttt'.split('').map(() => ({}));

    let scrollPauseTimer = null;
    let isAutoScrolling = false;
    const SCROLL_RESUME_DELAY = 500;

    function pauseAutoScrollTemporarily() {
      if (!autoScrollActive.value || isAutoScrolling) return;
      if (scrollInterval) { clearInterval(scrollInterval); scrollInterval = null; }
      if (scrollPauseTimer) clearTimeout(scrollPauseTimer);
      scrollPauseTimer = setTimeout(() => {
        if (autoScrollActive.value && !scrollInterval) {
          scrollInterval = setInterval(() => {
            const body = articleBodyRef.value || document.querySelector('.article-view-body');
            if (!body) return;
            isAutoScrolling = true;
            body.scrollBy({ top: scrollSpeed.value, behavior: 'auto' });
            setTimeout(() => { isAutoScrolling = false; }, 50);
            if (body.scrollTop + body.clientHeight >= body.scrollHeight - 2) {
              autoScrollActive.value = false;
            }
          }, 120);
        }
      }, SCROLL_RESUME_DELAY);
    }

    watch(autoScrollActive, (isActive) => {
      if (scrollInterval) { clearInterval(scrollInterval); scrollInterval = null; }
      if (scrollPauseTimer) clearTimeout(scrollPauseTimer);
      if (!isActive) { releaseWakeLock(); return; }
      requestWakeLock();
      scrollInterval = setInterval(() => {
        const body = articleBodyRef.value || document.querySelector('.article-view-body');
        if (!body) return;
        isAutoScrolling = true;
        body.scrollBy({ top: scrollSpeed.value, behavior: 'auto' });
        setTimeout(() => { isAutoScrolling = false; }, 50);
        if (body.scrollTop + body.clientHeight >= body.scrollHeight - 2) {
          autoScrollActive.value = false;
        }
      }, 120);
    });

    watch(activeArticle, () => { 
      autoScrollActive.value = false; 
      releaseWakeLock();
      if (scrollPauseTimer) clearTimeout(scrollPauseTimer);
    });

    watch(articleBodyRef, (el) => {
      if (!el) return;
      const handler = pauseAutoScrollTemporarily;
      el.addEventListener('scroll', handler, { passive: true });
      el.addEventListener('touchstart', handler, { passive: true });
      el.addEventListener('touchmove', handler, { passive: true });
      el.addEventListener('mousedown', handler, { passive: true });
    });
    watch(authorSearch, () => { authorPage.value = 1; });
    watch(authorSheetOpen, async (val) => {
      if (val) { await Vue.nextTick(); setupAuthorObserver(); }
      else teardownAuthorObserver();
    });
    watch(filteredAuthors, async () => {
      await Vue.nextTick();
      setupAuthorObserver();
    });

    function onChipClick(chipId) {
      error.value = null;
      if (chipId === 'date') {
        openDateSheet();
        return;
      }
      if (chipId === 'author') {
        openAuthorSheet();
        return;
      }
      activeChip.value = chipId;
    }

    watch(activeChip, (v) => {
      if (v === 'today' && todayArticles.value.length === 0) loadTodayArticles();
    });

    watch(activeTab, () => {
      deactivateSearch();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        reacquireWakeLockIfNeeded();
      }
    });

        function activateSearch() {
      searchActive.value = true;
      Vue.nextTick(() => {
        if (searchInputRef.value) searchInputRef.value.focus();
      });
    }

    function deactivateSearch() {
      searchActive.value = false;
      searchQuery.value = '';
    }

    function clearSearch() {
      searchQuery.value = '';
      Vue.nextTick(() => {
        if (searchInputRef.value) searchInputRef.value.focus();
      });
    }

    function onSearchEnter() {
      let single = null;
      if (activeTab.value === 'home') {
        single = filteredHomeArticles.value;
      } else if (activeTab.value === 'saved') {
        single = filteredSavedArticles.value;
      }
      if (single && single.length === 1) {
        const article = single[0];
        if (activeTab.value === 'saved') {
          openSavedArticle(article);
        } else {
          openArticle(article);
        }
        deactivateSearch();
      }
    }

    function matchesSearch(article, query) {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      const text = ((article.title || '') + ' ' + (article.author || '')).toLowerCase();
      return text.includes(q);
    }

    onMounted(async () => {
      await db.init();
      appReady.value = true;
      loadTodayArticles();
      refreshCachedUrls();
      refreshReadUrls();
      refreshFollowedAuthors();
      refreshSavedArticles();
      maxDate.value = getTodayKey();
      loadTextSettings();

      // Android hardware back button (Capacitor)
      if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
        window.Capacitor.Plugins.App.addListener('backButton', handleBackButton);
      }    
    });

    return {
      appReady, activeTab, activeChip, homeBarTitle, tabs, icons, articleBodyRef,
      searchActive, searchQuery, searchInputRef,theme, setTheme,
      activateSearch, deactivateSearch, clearSearch, onSearchEnter,
      filteredHomeArticles, filteredSavedArticles,
      toastMessage, toastVisible, activeArticle, openArticle, closeArticle,
      todayArticles, dateArticles, loading, error,
      dateInputRef, selectedDate, maxDate, selectedDateLabel,
      openDateSheet, onDateChange, onChipClick,
      articleContent, articleLoading, articleError,
      textOptionsOpen, fontSize, lineHeight, textAlign,
      adjustFontSize, adjustLineHeight, setTextAlign,
      openTextOptions, closeTextOptions, fontSizeStep, lineHeightStep, scrollSpeedStep,
      autoScrollActive, toggleAutoScroll, scrollSpeed, adjustScrollSpeed,
      downloadAllHomeState, toggleDownloadAllHome, downloadAllSavedState, toggleDownloadAllSaved,
      cachedUrls, refreshCachedUrls, readUrls, refreshReadUrls,
      savedArticles, refreshSavedArticles, isArticleSaved, toggleSaveArticle, openSavedArticle,
      authorSheetOpen, authorSearch, allAuthors, shareArticle,
      followedAuthors, followedAuthorsList, filteredAuthors,
      openAuthorSheet, closeAuthorSheet, toggleFollowAuthor, scrapeAuthor, onAuthorSearchEnter,
      hasMoreAuthors, authorSentinelRef, skeletonLines, skeletonCards,
      authorArticles, activeAuthorLabel, authorHasMore, loadingMore, loadMoreAuthorArticles,
    };
  }

}).mount('#app');