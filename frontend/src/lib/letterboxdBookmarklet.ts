const BOOKMARKLET_BODY = `/* MoviesWrapped Letterboxd exporter. Run on letterboxd.com while on /<user>/... */
(function (root) {
  var MW_ORIGIN = __MW_ORIGIN__;
  function txt(el) { return el ? el.textContent.trim() : null; }
  function parseFilmsPage(doc) {
    var out = [];
    doc.querySelectorAll('li.griditem, li.poster-container').forEach(function (li) {
      var p = li.querySelector('[data-item-slug],[data-film-slug]'); if (!p) return;
      var name = p.getAttribute('data-item-name') || '';
      var m = name.match(/^(.*) \\((\\d{4})\\)$/);
      var r = li.querySelector('.rating[class*="rated-"]');
      var rm = r && r.className.match(/rated-(\\d+)/);
      out.push({ slug: p.getAttribute('data-item-slug') || p.getAttribute('data-film-slug'),
        title: m ? m[1] : name, year: m ? +m[2] : null,
        rating: rm ? +rm[1] / 2 : null, liked: !!li.querySelector('.like, .icon-liked') });
    });
    return out;
  }
  function parseDiaryPage(doc) {
    var out = [];
    doc.querySelectorAll('tr.diary-entry-row').forEach(function (tr) {
      var p = tr.querySelector('[data-item-slug],[data-film-slug]');
      var d = tr.querySelector('a.daydate, .col-daydate a');
      var dm = d && d.getAttribute('href').match(/\\/for\\/(\\d{4})\\/(\\d{2})\\/(\\d{2})\\//);
      var r = tr.querySelector('.col-rating .rating[class*="rated-"]');
      var rm = r && r.className.match(/rated-(\\d+)/);
      if (!rm) { var inp = tr.querySelector('.col-rating input.rateit-field'); if (inp && +inp.value) rm = [0, inp.value]; }
      var name = p ? (p.getAttribute('data-item-name') || '') : '';
      var m = name.match(/^(.*) \\((\\d{4})\\)$/);
      out.push({ slug: p ? (p.getAttribute('data-item-slug') || p.getAttribute('data-film-slug')) : null,
        title: txt(tr.querySelector('.col-production h2 a, h3 a')) || (m ? m[1] : name),
        year: +(txt(tr.querySelector('.col-releaseyear')) || (m && m[2])) || null,
        rating: rm ? +rm[1] / 2 : null,
        watchedDate: dm ? dm[1] + '-' + dm[2] + '-' + dm[3] : null,
        rewatch: !tr.querySelector('.col-rewatch.icon-status-off'),
        viewingId: tr.getAttribute('data-viewing-id') });
    });
    return out;
  }
  function lastPage(doc) {
    var n = 1; doc.querySelectorAll('.paginate-pages a, .paginate-page a').forEach(function (a) { var v = parseInt(a.textContent, 10); if (v > n) n = v; });
    return n;
  }
  root.MWParse = { parseFilmsPage: parseFilmsPage, parseDiaryPage: parseDiaryPage, lastPage: lastPage };
  if (typeof location === 'undefined' || !/letterboxd\\.com$/.test(location.hostname)) return;

  var user = location.pathname.split('/').filter(Boolean)[0];
  if (!user || /^(film|films|lists|members|journal|search|settings)$/.test(user)) { alert('Open your Letterboxd profile first (letterboxd.com/<username>/).'); return; }
  var box = document.createElement('div');
  box.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#14181c;color:#fff;padding:12px;border:2px solid #00e054;font:14px sans-serif;max-width:320px';
  document.body.appendChild(box);
  function status(s) { box.textContent = 'MoviesWrapped: ' + s; }
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  async function get(path) {
    for (var t = 0; t < 3; t++) {
      var res = await fetch(path, { credentials: 'include' });
      if (res.ok) return new DOMParser().parseFromString(await res.text(), 'text/html');
      await sleep(1500 * (t + 1));
    }
    throw new Error('HTTP error on ' + path);
  }
  async function crawl(base, parser, label) {
    var first = await get(base), all = parser(first), last = lastPage(first);
    for (var i = 2; i <= last; i++) { status(label + ' page ' + i + '/' + last); all = all.concat(parser(await get(base + 'page/' + i + '/'))); await sleep(300); }
    return all;
  }
  (async function () {
    try {
      status('reading films…');
      var films = await crawl('/' + user + '/films/', parseFilmsPage, 'films');
      status('reading diary…');
      var diary = await crawl('/' + user + '/films/diary/', parseDiaryPage, 'diary');
      var data = { source: 'letterboxd', user: user, exportedAt: new Date().toISOString(), films: films, diary: diary };
      var json = JSON.stringify(data);
      try { await navigator.clipboard.writeText(json); } catch (e) {}
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      a.download = 'letterboxd-' + user + '.json'; a.textContent = 'Download JSON'; a.style.color = '#00e054';
      box.textContent = 'MoviesWrapped: ' + films.length + ' films, ' + diary.length + ' diary entries. Copied to clipboard. ';
      box.appendChild(a); a.click();
      var b = document.createElement('button'); b.textContent = ' Send to MoviesWrapped'; box.appendChild(b);
      b.onclick = function () {
        var w = window.open(MW_ORIGIN + '/import', 'mw');
        var tries = 0, iv = setInterval(function () { if (w) w.postMessage({ type: 'mw-letterboxd', data: data }, MW_ORIGIN); if (++tries > 20) clearInterval(iv); }, 500);
        window.addEventListener('message', function (ev) { if (ev.origin === MW_ORIGIN && ev.data === 'mw-ack') { clearInterval(iv); status('sent ✓'); } });
      };
    } catch (e) { status('failed: ' + e.message); }
  })();
})(typeof window !== 'undefined' ? window : globalThis);`;

export function bookmarkletSource(origin: string): string {
  return BOOKMARKLET_BODY.replace('__MW_ORIGIN__', JSON.stringify(origin.replace(/\/$/, '')));
}

export function bookmarkletHref(origin: string): string {
  return `javascript:${encodeURIComponent(bookmarkletSource(origin))}`;
}
