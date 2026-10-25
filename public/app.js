(function () {
  'use strict';

  var REFRESH_MS = 60000;
  var els = {
    name: document.getElementById('name'),
    loader: document.getElementById('loader'),
    count: document.getElementById('count'),
    badge: document.getElementById('badge'),
    error: document.getElementById('error'),
    button: document.getElementById('refresh'),
    updated: document.getElementById('updated')
  };
  var lastGood = null;   // last successfully retrieved data, kept if a refresh fails
  var inFlight = false;  // prevents overlapping requests

  function ago(iso) {
    var s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    return Math.floor(s / 3600) + ' h ago';
  }

  function render(stale, errMsg) {
    els.loader.classList.add('hidden');
    if (lastGood) {
      els.count.classList.remove('hidden');
      els.count.textContent = lastGood.followerCount.toLocaleString('en-US');
      els.count.classList.toggle('stale', stale);
      var notes = [];
      if (lastGood.isEstimate) notes.push('Approximate');
      if (stale) notes.push('May be out of date');
      els.badge.textContent = notes.join(' | ');
      els.badge.classList.toggle('hidden', notes.length === 0);
      els.badge.classList.toggle('warn', stale);
      els.name.textContent = '@' + lastGood.accountName;
      els.updated.textContent = 'Last updated: ' + new Date(lastGood.updatedAt).toLocaleString() + ' (' + ago(lastGood.updatedAt) + ')';
    } else {
      els.count.classList.add('hidden');
      els.badge.classList.add('hidden');
    }
    if (errMsg) {
      els.error.textContent = errMsg;
      els.error.classList.remove('hidden');
    } else {
      els.error.classList.add('hidden');
    }
  }

  function load() {
    if (inFlight) return;
    inFlight = true;
    els.button.disabled = true;
    if (!lastGood) els.loader.classList.remove('hidden');

    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 20000); // allows for a sleeping Render service waking up

    fetch('/api/followers', { cache: 'no-store', signal: controller.signal })
      .then(function (res) {
        return res.json().then(function (body) { return { ok: res.ok, body: body }; });
      })
      .then(function (r) {
        if (r.ok && typeof r.body.followerCount === 'number') {
          lastGood = r.body;
          var msg = r.body.stale && r.body.error ? 'Could not refresh: ' + r.body.error.message + ' Showing the last known count.' : '';
          render(Boolean(r.body.stale), msg);
        } else {
          var m = (r.body && r.body.error && r.body.error.message) || 'Unexpected response from the server.';
          render(Boolean(lastGood), 'Could not load the follower count: ' + m);
        }
      })
      .catch(function (err) {
        var m = err.name === 'AbortError' ? 'The server took too long to respond (it may be waking up). Try again in a moment.' : 'Could not reach the server. Check your connection.';
        render(Boolean(lastGood), m + (lastGood ? ' Showing the last known count.' : ''));
      })
      .finally(function () {
        clearTimeout(timer);
        inFlight = false;
        els.button.disabled = false;
      });
  }

  els.button.addEventListener('click', load);
  setInterval(load, REFRESH_MS);
  setInterval(function () { if (lastGood) render(Boolean(lastGood.stale) || !els.error.classList.contains('hidden'), els.error.classList.contains('hidden') ? '' : els.error.textContent); }, 15000);
  load();
})();
