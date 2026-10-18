(function () {
  'use strict';

  var DATA_URL = 'books.json';
  var STORE_KEY = 'pb_last_view';
  var WEEK = ['日', '一', '二', '三', '四', '五', '六'];

  // 技能主题库的规范分类（顺序即分类导航呈现顺序）；导航只展示“书架里已有绘本”的分类
  var CATEGORY_ORDER = [
    '生命科学', '物质科学', '地球与宇宙', '天文航天', '地球与海洋',
    '物理万象', '化学启蒙', '数学与思维', '技术工程', '技术与生活',
    '人体与健康', 'AI与机器人', '安全与好习惯', '经济与生活', '人文与艺术',
    '中国神话故事', '中国寓言故事', '中国成语故事', '外国神话故事', '外国寓言故事',
    '财商教育', '马术知识', '吉他知识', '心理成长'
  ];

  var state = {
    cfg: null,
    books: [],
    byDate: {},
    current: null,   // 当前展示的绘本日期
    calCursor: null,  // 日历当前显示的月份 {y, m} m:0-11
    filters: { q: '', cat: '', browse: false }
  };

  var el = {
    app: document.getElementById('app'),
    main: document.getElementById('main'),
    siteTitle: document.getElementById('siteTitle'),
    footNote: document.getElementById('footNote'),
    btnCalendar: document.getElementById('btnCalendar'),
    searchInput: document.getElementById('searchInput'),
    searchClear: document.getElementById('searchClear'),
    catChips: document.getElementById('catChips'),
    sheet: document.getElementById('sheet'),
    calTitle: document.getElementById('calTitle'),
    calGrid: document.getElementById('calGrid'),
    calPrev: document.getElementById('calPrev'),
    calNext: document.getElementById('calNext'),
    calLatest: document.getElementById('calLatest'),
    readerLoading: document.getElementById('readerLoading'),
    toast: document.getElementById('toast')
  };

  /* ---------- 工具 ---------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function parseKey(k) {
    var p = String(k).split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }

  function fmtCN(k, withYear) {
    var d = parseKey(k);
    var s = (d.getMonth() + 1) + '月' + d.getDate() + '日';
    return withYear ? d.getFullYear() + '年' + s : s;
  }

  function fmtWeek(k) {
    return '星期' + WEEK[parseKey(k).getDay()];
  }

  function daysBetween(a, b) {
    var d1 = parseKey(a), d2 = parseKey(b);
    return Math.round((d2 - d1) / 86400000);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function isHttpUrl(u) {
    return /^https?:\/\//i.test(String(u || ''));
  }

  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.toast.classList.remove('show'); }, 2000);
  }

  function inWeChat() {
    return /MicroMessenger/i.test(navigator.userAgent);
  }

  /* ---------- 数据 ---------- */
  function normalize(cfg) {
    var list = (cfg.books || []).filter(function (b) {
      return b && b.date && b.title;
    }).map(function (b) {
      return {
        date: String(b.date).slice(0, 10),
        title: b.title,
        author: b.author || '',
        ageRange: b.ageRange || '',
        category: b.category || '',
        themes: Array.isArray(b.themes) ? b.themes : [],
        intro: b.intro || '',
        tip: b.tip || '',
        url: b.url || '',
        embed: !!b.embed,
        cover: b.cover || ''
      };
    }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });

    var byDate = {};
    list.forEach(function (b) { byDate[b.date] = b; });

    state.cfg = cfg.site || {};
    state.books = list;
    state.byDate = byDate;
  }

  function latestBook() {
    return state.books.length ? state.books[0] : null;
  }

  // 决定首屏展示哪一天：今天有书→今天；否则展示最新一期
  function resolveInitial() {
    var t = todayKey();
    if (state.byDate[t]) return t;
    var latest = latestBook();
    return latest ? latest.date : t;
  }

  function pickFromHash() {
    var m = /(?:^|[#&])d=(\d{4}-\d{2}-\d{2})/.exec(location.hash || '');
    if (m && state.byDate[m[1]]) return m[1];
    return null;
  }

  /* ---------- 搜索与分类 ---------- */
  function isBrowsing() {
    var f = state.filters;
    return f.browse || f.q.trim() !== '' || f.cat !== '';
  }

  // 书架里“实际出现过”的分类，按 CATEGORY_ORDER 排序；未在表中的新分类排到后面
  function presentCategories() {
    var map = {};
    state.books.forEach(function (b) {
      if (b.category) map[b.category] = (map[b.category] || 0) + 1;
    });
    var ordered = CATEGORY_ORDER.filter(function (c) { return map[c]; });
    Object.keys(map).forEach(function (c) {
      if (ordered.indexOf(c) < 0) ordered.push(c);
    });
    return ordered.map(function (c) { return { name: c, count: map[c] }; });
  }

  function bookHaystack(b) {
    return [b.title, b.author, b.category, b.intro, b.tip, (b.themes || []).join(' ')]
      .join(' ').toLowerCase();
  }

  function filteredBooks() {
    var f = state.filters;
    var terms = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return state.books.filter(function (b) {
      if (f.cat && b.category !== f.cat) return false;
      if (terms.length) {
        var hay = bookHaystack(b);
        for (var i = 0; i < terms.length; i++) {
          if (hay.indexOf(terms[i]) === -1) return false;
        }
      }
      return true;
    });
  }

  function renderChips() {
    var cur = state.filters.cat;
    var html = '<button type="button" class="cat-chip' + (cur === '' ? ' active' : '') +
      '" data-cat="" role="tab" aria-selected="' + (cur === '' ? 'true' : 'false') + '">全部</button>';
    presentCategories().forEach(function (c) {
      var on = c.name === cur;
      html += '<button type="button" class="cat-chip' + (on ? ' active' : '') +
        '" data-cat="' + esc(c.name) + '" role="tab" aria-selected="' + (on ? 'true' : 'false') + '">' +
        esc(c.name) + '<span class="cat-n">' + c.count + '</span></button>';
    });
    el.catChips.innerHTML = html;
    Array.prototype.forEach.call(el.catChips.querySelectorAll('.cat-chip'), function (n) {
      n.addEventListener('click', function () {
        var c = n.getAttribute('data-cat');
        state.filters.cat = c;
        state.filters.browse = (c !== '') || state.filters.q.trim() !== '';
        renderChips();
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  }

  function resetFilters() {
    state.filters = { q: '', cat: '', browse: false };
    if (el.searchInput) el.searchInput.value = '';
    if (el.searchClear) el.searchClear.hidden = true;
    renderChips();
  }

  function exitBrowse() {
    resetFilters();
    state.current = resolveInitial();
    if (history.replaceState) history.replaceState(null, '', '#d=' + state.current);
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderResults() {
    var f = state.filters;
    var q = f.q.trim();
    var list = filteredBooks();
    var label = f.cat ? ('分类 · ' + f.cat) : (q ? ('搜索 “' + q + '”') : '全部绘本');
    var parts = [];

    parts.push('<div class="result-head fade-in">');
    parts.push('<h2>' + esc(label) + ' · ' + list.length + ' 本</h2>');
    parts.push('<button id="resultClear" type="button" class="text-btn">' +
      (f.cat || q ? '清除筛选' : '返回今日') + '</button>');
    parts.push('</div>');

    if (!list.length) {
      parts.push(
        '<div class="empty fade-in"><span class="glyph">🔍</span>',
        '<h2>没有找到相关绘本</h2><p>换个词，或试试别的分类吧。</p></div>'
      );
    } else {
      parts.push('<div class="grid fade-in">');
      list.forEach(function (b) {
        var thumb = b.cover
          ? '<img src="' + esc(b.cover) + '" alt="' + esc(b.title) + '" loading="lazy" onerror="this.remove();this.parentNode.classList.add(' + "'img-fail'" + ')">'
          : '<span class="grid-emoji">📖</span>';
        parts.push(
          '<button class="grid-card" type="button" data-date="' + esc(b.date) + '">',
          '<span class="grid-cover">',
          thumb,
          b.category ? '<span class="grid-cat">' + esc(b.category) + '</span>' : '',
          '</span>',
          '<span class="grid-title">' + esc(b.title) + '</span>',
          '<span class="grid-date">' + esc(fmtCN(b.date, true)) + ' · ' + esc(fmtWeek(b.date)) + '</span>',
          '</button>'
        );
      });
      parts.push('</div>');
    }

    el.main.innerHTML = parts.join('');
    var clearBtn = document.getElementById('resultClear');
    if (clearBtn) clearBtn.addEventListener('click', exitBrowse);
    Array.prototype.forEach.call(document.querySelectorAll('.grid-card'), function (n) {
      n.addEventListener('click', function () { go(n.getAttribute('data-date')); });
    });
  }

  /* ---------- 渲染：主视图 ---------- */
  function render() {
    if (isBrowsing()) {
      renderResults();
      return;
    }
    var key = state.current;
    var book = state.byDate[key];
    var t = todayKey();
    var parts = [];

    if (!book) {
      parts.push(
        '<div class="empty fade-in">',
        '<span class="glyph">🌱</span>',
        '<h2>这一期还没上架</h2>',
        '<p>今天的绘本正在路上，<br>先去读读往期的故事吧。</p>',
        '</div>'
      );
      var lat = latestBook();
      if (lat) {
        parts.push('<a class="cta ghost" href="#d=' + esc(lat.date) + '">看看最近一期 · ' + esc(lat.title) + '</a>');
      }
      el.main.innerHTML = parts.join('');
      bindMain();
      return;
    }

    var isToday = key === t;
    var diff = daysBetween(key, t);

    // 日期条
    parts.push('<div class="dateline fade-in">');
    parts.push('<span>' + esc(fmtCN(key, false)) + ' · ' + esc(fmtWeek(key)) + '</span>');
    if (isToday) parts.push('<span class="today-tag">今天</span>');
    else if (diff > 0) parts.push('<span>' + diff + ' 天前</span>');
    parts.push('<span class="bar"></span></div>');

    // 卡片
    parts.push('<article class="book fade-in">');

    var coverInner = '';
    if (book.cover) {
      coverInner = '<img src="' + esc(book.cover) + '" alt="' + esc(book.title) + ' 封面" onerror="this.remove()">';
    }
    parts.push(
      '<div class="cover" id="coverTap" role="button" tabindex="0" aria-label="打开绘本">',
      coverInner,
      isHttpUrl(book.url) || book.embed ? '' :
      '<div class="cover-fallback" aria-hidden="true"><span class="glyph">📖</span><span class="hint">绘本链接待补充</span></div>',
      '<span class="cover-badge">',
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 5.5v13M16 5.5v13"/></svg>',
      '互动绘本',
      '</span>',
      '</div>'
    );

    // 故事信息
    parts.push('<div class="book-body">');
    var chips = [];
    if (book.category) chips.push('<span class="chip sage">' + esc(book.category) + '</span>');
    if (book.ageRange) chips.push('<span class="chip accent">' + esc(book.ageRange) + '</span>');
    book.themes.slice(0, 3).forEach(function (x) {
      chips.push('<span class="chip">' + esc(x) + '</span>');
    });
    if (chips.length) parts.push('<div class="book-meta">' + chips.join('') + '</div>');

    parts.push('<h1 class="book-title">' + esc(book.title) + '</h1>');
    if (book.author) parts.push('<p class="book-author">' + esc(book.author) + '</p>');
    if (book.intro) parts.push('<p class="book-intro">' + esc(book.intro) + '</p>');

    if (book.tip) {
      parts.push(
        '<div class="book-tip"><span class="k">共读小问</span><span>' + esc(book.tip) + '</span></div>'
      );
    }

    // 主按钮：embed → 站内阅读器；http → 外链
    var canRead = isHttpUrl(book.url) || book.embed;
    if (canRead) {
      parts.push('<a class="cta" id="readBtn" href="' + esc(book.url) + '" data-date="' + esc(book.date) + '" target="_blank" rel="noopener noreferrer">');
      parts.push(book.embed ? '打开绘本阅读' : (inWeChat() ? '复制绘本链接' : '开始阅读'));
      parts.push('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>');
      parts.push('</a>');
    } else {
      parts.push('<button class="cta" type="button" disabled style="opacity:.5;box-shadow:none">绘本链接待补充</button>');
    }

    parts.push('</div></article>');

    // 往期
    var past = state.books.filter(function (b) { return b.date !== key; }).slice(0, 5);
    if (past.length) {
      parts.push('<div class="section-head"><h2>往期故事</h2><span class="head-actions"><button type="button" id="browseAll">全部绘本</button><button type="button" id="allPast">日历</button></span></div>');
      parts.push('<div class="past-list">');
      past.forEach(function (b) {
        parts.push(
          '<button class="past-item" type="button" data-date="' + esc(b.date) + '">',
          '<span class="past-thumb">',
          b.cover ? '<img src="' + esc(b.cover) + '" alt="" loading="lazy" onerror="this.parentNode.textContent=\'📖\'">' : '📖',
          '</span>',
          '<span class="past-body">',
          '<span class="past-title">' + esc(b.title) + '</span>',
          '<span class="past-sub">' + esc(fmtCN(b.date, true)) + ' · ' + esc(fmtWeek(b.date)) + '</span>',
          '</span>',
          '<span class="past-arrow">›</span>',
          '</button>'
        );
      });
      parts.push('</div>');
    }

    el.main.innerHTML = parts.join('');
    bindMain();
  }

  function bindMain() {
    var cover = document.getElementById('coverTap');
    if (cover) {
      cover.addEventListener('click', function () {
        var btn = document.getElementById('readBtn');
        if (btn) openBook(btn);
      });
    }

    var readBtn = document.getElementById('readBtn');
    if (readBtn) {
      readBtn.addEventListener('click', function (e) { openBook(readBtn, e); });
    }

    var all = document.getElementById('allPast');
    if (all) all.addEventListener('click', openCalendar);

    var browse = document.getElementById('browseAll');
    if (browse) browse.addEventListener('click', function () {
      state.filters = { q: '', cat: '', browse: true };
      el.searchInput.value = '';
      el.searchClear.hidden = true;
      renderChips();
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    Array.prototype.forEach.call(document.querySelectorAll('.past-item'), function (n) {
      n.addEventListener('click', function () { go(n.getAttribute('data-date')); });
    });
  }

  /* ---------- 阅读器 ---------- */
  var RL_BLOB = {};        // date -> blobURL（本会话内缓存，重开秒开）
  var RL_BLOB_ORDER = [];
  var RL_TOK = 0;
  var RL_TEASERS = [
    '你知道吗？天空看起来是蓝色的，是因为阳光被空气“散”开啦。',
    '月亮本身不发光，我们看到的是它“借”来的太阳光。',
    '蘑菇不是植物，它没有叶绿素，也不会开花结果。',
    '我们的舌头大约有 1 万个味蕾，酸甜苦咸都靠它们。',
    '蜗牛是世界上牙齿最多的动物之一，嘴里有上万颗小齿。',
    '蜂蜜几乎不会变质，考古学家发现的古代蜂蜜还能吃。',
    '海星没有大脑，但它有眼睛，还能把胃吐出来吃东西。',
    '彩虹其实是一整个圆，我们站在地面上通常只看到一道弧。'
  ];

  function rlEl(id) { return document.getElementById(id); }
  function setReaderLoading(on) {
    if (el.readerLoading) el.readerLoading.hidden = !on;
  }
  function setRlProgress(pct) {
    var fill = rlEl('rlBarFill'), pctEl = rlEl('rlPct');
    if (pct == null) {
      if (fill) fill.classList.add('indeterminate');
      if (pctEl) pctEl.textContent = '';
      return;
    }
    if (fill) { fill.classList.remove('indeterminate'); fill.style.width = Math.max(4, Math.min(100, pct)) + '%'; }
    if (pctEl) pctEl.textContent = pct < 100 ? pct + '%' : '马上就好…';
  }
  function startTeaser(book) {
    var q = rlEl('rlTeaser');
    if (!q) return;
    var pool = (book && book.tip ? [book.tip] : []).concat(RL_TEASERS);
    var i = 0;
    q.textContent = '💡 ' + pool[0];
    clearInterval(q._t);
    q._t = setInterval(function () {
      i = (i + 1) % pool.length;
      q.textContent = '💡 ' + pool[i];
    }, 2800);
  }
  function stopTeaser() {
    var q = rlEl('rlTeaser');
    if (q && q._t) clearInterval(q._t);
  }

  function cacheBlob(book, blob) {
    if (RL_BLOB[book.date]) URL.revokeObjectURL(RL_BLOB[book.date]);
    RL_BLOB[book.date] = URL.createObjectURL(blob);
    RL_BLOB_ORDER = RL_BLOB_ORDER.filter(function (d) { return d !== book.date; });
    RL_BLOB_ORDER.push(book.date);
    while (RL_BLOB_ORDER.length > 2) {
      var d = RL_BLOB_ORDER.shift();
      if (RL_BLOB[d]) { URL.revokeObjectURL(RL_BLOB[d]); delete RL_BLOB[d]; }
    }
  }

  function fetchBookBlob(url, onProg) {
    return new Promise(function (resolve, reject) {
      if (!window.fetch || !window.URL || !window.Blob) return reject(new Error('no-fetch'));
      fetch(url, { cache: 'force-cache' }).then(function (resp) {
        if (!resp.ok) return reject(new Error('http ' + resp.status));
        if (!resp.body || !resp.body.getReader) {
          return resp.blob().then(function (b) { onProg(100); resolve(b); });
        }
        var reader = resp.body.getReader();
        var total = +resp.headers.get('content-length') || 0;
        var received = 0, chunks = [];
        function pump() {
          reader.read().then(function (r) {
            if (r.done) {
              onProg(100);
              resolve(new Blob(chunks, { type: 'text/html' }));
              return;
            }
            chunks.push(r.value);
            received += r.value.length;
            if (total) onProg(Math.min(99, Math.round(received / total * 100)));
            else onProg(50);
            pump();
          }).catch(reject);
        }
        pump();
      }).catch(reject);
    });
  }

  // 轮询 iframe 文档 readyState，比单纯依赖 load 事件更稳（部分内置浏览器 load 不触发）
  function armFrame(frame, tok, src) {
    frame._armed = true;
    frame.src = src;
    var n = 0;
    var t = setInterval(function () {
      if (tok !== frame._tok) { clearInterval(t); return; }
      n++;
      var ready = false;
      try { ready = frame.contentDocument && frame.contentDocument.readyState === 'complete'; } catch (e) { ready = false; }
      if (ready) { clearInterval(t); setReaderLoading(false); stopTeaser(); }
      else if (n > 200) { // 30s 仍未就绪，给兜底入口
        clearInterval(t);
        var open = rlEl('rlOpen');
        if (open) { open.href = src; open.hidden = false; }
      }
    }, 150);
  }

  function showFallback(book) {
    var retry = rlEl('rlRetry'), open = rlEl('rlOpen');
    if (retry) {
      retry.hidden = false;
      retry.onclick = function () {
        retry.hidden = true; if (open) open.hidden = true;
        setReaderLoading(true); setRlProgress(null);
        var frame = document.getElementById('readerFrame');
        startLoad(book, frame, frame._tok);
      };
    }
    if (open) { open.href = book.url; open.hidden = false; }
  }

  function startLoad(book, frame, tok) {
    setRlProgress(RL_BLOB[book.date] ? 100 : (window.fetch ? null : 100));
    var blobUrl = RL_BLOB[book.date];
    if (blobUrl) {
      armFrame(frame, tok, blobUrl);
      return;
    }
    var done = false;
    var slow = setTimeout(function () {
      if (!done && tok === frame._tok) showFallback(book);
    }, 20000);
    fetchBookBlob(book.url, function (p) {
      if (tok === frame._tok) setRlProgress(p);
    }).then(function (blob) {
      done = true; clearTimeout(slow);
      if (tok !== frame._tok) return;
      cacheBlob(book, blob);
      armFrame(frame, tok, RL_BLOB[book.date]);
    }).catch(function () {
      done = true; clearTimeout(slow);
      if (tok !== frame._tok) return;
      // 不支持流式或下载失败：直接交给 iframe 加载（不确定进度），并给兜底
      setRlProgress(null);
      armFrame(frame, tok, book.url);
      setTimeout(function () { if (tok === frame._tok) showFallback(book); }, 800);
    });
  }

  function openReader(book) {
    var r = document.getElementById('reader');
    var frame = document.getElementById('readerFrame');
    document.getElementById('readerTitle').textContent = book.title;
    var tok = ++RL_TOK;
    frame._tok = tok;
    frame._armed = false;
    setReaderLoading(true);
    setRlProgress(null);
    var retry = rlEl('rlRetry'), open = rlEl('rlOpen');
    if (retry) retry.hidden = true;
    if (open) open.hidden = true;
    frame.src = 'about:blank';
    r.hidden = false;
    document.body.classList.add('locked');
    startTeaser(book);
    setTimeout(function () {
      if (tok === frame._tok && !r.hidden) startLoad(book, frame, tok);
    }, 40);
    r._book = book;
  }

  function closeReader() {
    var r = document.getElementById('reader');
    var frame = document.getElementById('readerFrame');
    frame._tok = 0;
    frame._armed = false;
    stopTeaser();
    setReaderLoading(false);
    r.hidden = true;
    frame.src = 'about:blank';
    document.body.classList.remove('locked');
  }

  // 背景预取最新一期（尊重省流量），点开时秒开
  function prefetchLatest(books) {
    if (!books || !books.length) return;
    if (window.navigator && navigator.connection && navigator.connection.saveData) return;
    if (!window.fetch || !window.URL) return;
    var run = function () {
      var b = books[0];
      if (!b || !b.embed || RL_BLOB[b.date]) return;
      fetchBookBlob(b.url, function () {}).then(function (blob) {
        cacheBlob(b, blob);
      }).catch(function () {});
    };
    if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 3000 });
    else setTimeout(run, 2500);
  }

  function onReaderFrameLoad() {
    var frame = document.getElementById('readerFrame');
    if (!frame._armed) return;
    var ready = false;
    try { ready = frame.contentDocument && frame.contentDocument.readyState === 'complete'; } catch (e) { ready = false; }
    if (ready && frame.src.indexOf('about:blank') === -1) { setReaderLoading(false); stopTeaser(); }
  }

  // embed 绘本在站内阅读器打开；外链在微信内则复制链接
  function openBook(btn, e) {
    var book = state.byDate[btn.getAttribute('data-date')];
    if (book && book.embed) {
      if (e) e.preventDefault();
      openReader(book);
      return;
    }
    if (inWeChat()) {
      var url = btn.getAttribute('href') || '';
      if (e) e.preventDefault();
      copyText(url).then(function () {
        toast('链接已复制，在浏览器中粘贴打开');
      }).catch(function () {
        prompt('复制下面的链接到浏览器打开：', url);
      });
    }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:absolute;left:-9999px;top:0';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        ok ? resolve() : reject(new Error('copy failed'));
      } catch (err) { reject(err); }
    });
  }

  function go(key) {
    if (!key) return;
    if (isBrowsing()) resetFilters();
    state.current = key;
    // 切换用 replace，避免历史堆积
    if (history.replaceState) history.replaceState(null, '', '#d=' + key);
    try { localStorage.setItem(STORE_KEY, key); } catch (e) {}
    closeCalendar();
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- 日历 ---------- */
  function openCalendar() {
    var d = parseKey(state.current || todayKey());
    state.calCursor = { y: d.getFullYear(), m: d.getMonth() };
    renderCalendar();
    el.sheet.hidden = false;
    document.body.classList.add('locked');
  }

  function closeCalendar() {
    el.sheet.hidden = true;
    document.body.classList.remove('locked');
  }

  function bookMonths() {
    // 有绘本的月份，用于限制翻页范围
    var set = {};
    state.books.forEach(function (b) {
      var d = parseKey(b.date);
      set[d.getFullYear() * 12 + d.getMonth()] = true;
    });
    var arr = Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
    return { min: arr[0], max: arr[arr.length - 1] };
  }

  function renderCalendar() {
    var cur = state.calCursor;
    var y = cur.y, m = cur.m;
    var t = todayKey();

    el.calTitle.textContent = y + ' 年 ' + (m + 1) + ' 月';

    var range = bookMonths();
    var idx = y * 12 + m;
    el.calPrev.disabled = range.min === undefined ? true : idx <= range.min - 1;
    el.calNext.disabled = range.max === undefined ? true : idx >= range.max + 1;

    var first = new Date(y, m, 1);
    var lead = (first.getDay() + 6) % 7; // 周一为首列
    var days = new Date(y, m + 1, 0).getDate();

    var html = '';
    for (var i = 0; i < lead; i++) html += '<span class="cal-cell blank"></span>';

    for (var d = 1; d <= days; d++) {
      var key = y + '-' + pad(m + 1) + '-' + pad(d);
      var has = !!state.byDate[key];
      var cls = 'cal-cell';
      if (has) cls += ' has';
      if (key === t) cls += ' today';
      if (key === state.current) cls += ' selected';
      html += '<button class="' + cls + '" type="button" data-date="' + key + '"' + (has ? '' : ' aria-disabled="true"') + '>' +
        '<span>' + d + '</span><i class="dot"></i></button>';
    }
    el.calGrid.innerHTML = html;

    Array.prototype.forEach.call(el.calGrid.querySelectorAll('.cal-cell.has'), function (n) {
      n.addEventListener('click', function () { go(n.getAttribute('data-date')); });
    });
    Array.prototype.forEach.call(el.calGrid.querySelectorAll('.cal-cell:not(.has):not(.blank)'), function (n) {
      n.addEventListener('click', function () { toast('这一天还没有绘本'); });
    });
  }

  /* ---------- 初始化 ---------- */
  function init() {
    document.getElementById('readerBack').addEventListener('click', closeReader);
    document.getElementById('readerClose').addEventListener('click', closeReader);
    document.getElementById('readerFrame').addEventListener('load', onReaderFrameLoad);
    el.btnCalendar.addEventListener('click', openCalendar);

    el.searchInput.addEventListener('input', function (e) {
      var v = e.target.value || '';
      state.filters.q = v;
      el.searchClear.hidden = v.trim() === '';
      state.filters.browse = true;
      render();
    });
    el.searchClear.addEventListener('click', function () {
      el.searchInput.value = '';
      state.filters.q = '';
      el.searchClear.hidden = true;
      if (state.filters.cat === '') state.filters.browse = false;
      render();
      el.searchInput.focus();
    });

    el.calPrev.addEventListener('click', function () {
      state.calCursor.m--; if (state.calCursor.m < 0) { state.calCursor.m = 11; state.calCursor.y--; }
      renderCalendar();
    });
    el.calNext.addEventListener('click', function () {
      state.calCursor.m++; if (state.calCursor.m > 11) { state.calCursor.m = 0; state.calCursor.y++; }
      renderCalendar();
    });
    el.calLatest.addEventListener('click', function () {
      var lat = latestBook();
      if (lat) go(lat.date); else closeCalendar();
    });
    el.sheet.addEventListener('click', function (e) {
      if (e.target.getAttribute('data-close')) closeCalendar();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !el.sheet.hidden) closeCalendar();
    });

    fetch(DATA_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (cfg) {
        normalize(cfg);
        if (state.cfg.title) {
          el.siteTitle.textContent = state.cfg.title;
          document.title = state.cfg.title;
        }
        state.current = pickFromHash() || resolveInitial();
        renderChips();
        render();
        el.footNote.textContent = '已更新 ' + state.books.length + ' 期 · ' + (state.cfg.subtitle || '');
        prefetchLatest(state.books);
      })
      .catch(function (err) {
        el.main.innerHTML =
          '<div class="empty fade-in"><span class="glyph">📚</span>' +
          '<h2>内容加载失败</h2><p>请检查网络后下拉刷新。</p></div>';
        el.footNote.textContent = '加载失败：' + err.message;
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
