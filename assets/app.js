(function () {
  'use strict';

  var DATA_URL = 'books.json';
  var STORE_KEY = 'pb_last_view';
  var WEEK = ['日', '一', '二', '三', '四', '五', '六'];

  var state = {
    cfg: null,
    books: [],
    byDate: {},
    current: null,   // 当前展示的绘本日期
    calCursor: null  // 日历当前显示的月份 {y, m} m:0-11
  };

  var el = {
    app: document.getElementById('app'),
    main: document.getElementById('main'),
    siteTitle: document.getElementById('siteTitle'),
    footNote: document.getElementById('footNote'),
    btnCalendar: document.getElementById('btnCalendar'),
    sheet: document.getElementById('sheet'),
    calTitle: document.getElementById('calTitle'),
    calGrid: document.getElementById('calGrid'),
    calPrev: document.getElementById('calPrev'),
    calNext: document.getElementById('calNext'),
    calLatest: document.getElementById('calLatest'),
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

  /* ---------- 渲染：主视图 ---------- */
  function render() {
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
      parts.push('<div class="section-head"><h2>往期故事</h2><button type="button" id="allPast">全部 · 日历</button></div>');
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

    Array.prototype.forEach.call(document.querySelectorAll('.past-item'), function (n) {
      n.addEventListener('click', function () { go(n.getAttribute('data-date')); });
    });
  }

  /* ---------- 阅读器 ---------- */
  function openReader(book) {
    var r = document.getElementById('reader');
    var frame = document.getElementById('readerFrame');
    document.getElementById('readerTitle').textContent = book.title;
    frame.src = book.url;
    r.hidden = false;
    document.body.classList.add('locked');
    r._book = book;
  }

  function closeReader() {
    var r = document.getElementById('reader');
    var frame = document.getElementById('readerFrame');
    r.hidden = true;
    frame.src = 'about:blank';
    document.body.classList.remove('locked');
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
    document.getElementById('readerClose').addEventListener('click', closeReader);
    el.btnCalendar.addEventListener('click', openCalendar);
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
        render();
        el.footNote.textContent = '已更新 ' + state.books.length + ' 期 · ' + (state.cfg.subtitle || '');
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
