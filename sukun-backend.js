/* Sukun Supabase auth + per-account app data sync. Requires supabase-config.js. */
(() => {
  const configReady = window.SUKUN_SUPABASE_URL && window.SUKUN_SUPABASE_ANON_KEY &&
    !window.SUKUN_SUPABASE_URL.includes('YOUR-PROJECT') &&
    !window.SUKUN_SUPABASE_ANON_KEY.includes('YOUR_SUPABASE');
  const isLogin = /(^|\/)index\.html?$/.test(location.pathname) || location.pathname.endsWith('/');
  const originalSet = Storage.prototype.setItem;
  const originalRemove = Storage.prototype.removeItem;
  const localOwnerKey = 'sukun_local_owner';
  let client = null, user = null, ready = false, syncing = false;
  const pending = new Map();

  function message(text, bad = false) {
    const el = document.getElementById('sukunAuthMessage');
    if (el) { el.textContent = text; el.style.color = bad ? '#9c3b45' : ''; }
  }
  function tracked(k) { return typeof k === 'string' && k.startsWith('sk_'); }
  function save(k, v) {
    if (!client || !user || !ready || !tracked(k)) return;
    let value = v;
    try { value = JSON.parse(v); } catch (_) {}
    pending.set(k, value);
    if (syncing) return;
    syncing = true;
    (async () => {
      while (pending.size) {
        const [data_key, data_value] = pending.entries().next().value;
        pending.delete(data_key);
        const { error } = await client.from('sukun_user_data').upsert(
          { user_id: user.id, data_key, data_value, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,data_key' }
        );
        if (error) { console.error('Sukun sync failed:', error.message); message('Sync nahi ho paya. Connection check karke dobara try karein.', true); }
      }
      syncing = false;
    })();
  }
  Storage.prototype.setItem = function (key, value) {
    originalSet.call(this, key, value);
    if (this === localStorage) save(String(key), String(value));
  };
  Storage.prototype.removeItem = function (key) {
    originalRemove.call(this, key);
    if (this === localStorage && user && tracked(String(key))) {
      client.from('sukun_user_data').delete().eq('user_id', user.id).eq('data_key', String(key))
        .then(({ error }) => { if (error) console.error('Sukun delete sync failed:', error.message); });
    }
  };

  if (!configReady || !window.supabase) {
    window.SukunBackend = { configured: false, ready: Promise.resolve(null) };
    if (!isLogin) location.replace('index.html');
    return;
  }
  client = window.supabase.createClient(window.SUKUN_SUPABASE_URL, window.SUKUN_SUPABASE_ANON_KEY);
  window.SukunBackend = {
    configured: true,
    storage: client.storage,
    get userId() { return user?.id || null; },
    async getAccessToken() { const { data } = await client.auth.getSession(); return data.session?.access_token || null; },
    async partnerReply(message, history) {
      await window.SukunBackend.ready;
      const { data, error } = await client.functions.invoke('partner-chat', { body: { message, history } });
      if (error) {
        let detail = '';
        try { const body = await error.context?.json(); detail = body?.error || ''; } catch (_) {}
        throw new Error(detail || error.message || 'Partner API request failed.');
      }
      return data;
    },
    async partnerSpeak(text) {
      await window.SukunBackend.ready;
      const { data, error } = await client.functions.invoke('partner-chat', { body: { action: 'speak', text } });
      if (error) {
        let detail = '';
        try { const body = await error.context?.json(); detail = body?.error || ''; } catch (_) {}
        throw new Error(detail || error.message || 'Partner voice request failed.');
      }
      return data;
    },
    ready: (async () => {
      const { data: { session }, error } = await client.auth.getSession();
      if (error) console.error('Supabase session error:', error.message);
      user = session?.user || null;
      if (!isLogin && !user) { location.replace('index.html'); return null; }
      if (isLogin && user) { location.replace('app.html'); return user; }
      if (!isLogin && user && window.top === window) {
        location.replace('app.html?page=' + encodeURIComponent(location.pathname.split('/').pop() || 'Sukun.html'));
        return user;
      }
      if (user) {
        const localOwner = localStorage.getItem(localOwnerKey);
        if (localOwner && localOwner !== user.id) {
          for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (tracked(key)) originalRemove.call(localStorage, key);
          }
        }
        originalSet.call(localStorage, localOwnerKey, user.id);
        const { data, error: loadError } = await client.from('sukun_user_data')
          .select('data_key,data_value').eq('user_id', user.id);
        ready = !loadError;
        if (loadError) {
          message('Data load nahi hua. Supabase SQL setup check karein.', true);
          console.error('Sukun load failed:', loadError.message);
        } else if (data?.length) {
          let changed = false;
          const cloudKeys = new Set(data.map(row => row.data_key));
          for (const row of data) {
            if (tracked(row.data_key)) {
              const value = typeof row.data_value === 'string' ? row.data_value : JSON.stringify(row.data_value);
              if (localStorage.getItem(row.data_key) !== value) changed = true;
              originalSet.call(localStorage, row.data_key, value);
            }
          }
          const marker = 'sukun_hydrated_' + user.id;
          if (changed && sessionStorage.getItem(marker) !== '1') {
            sessionStorage.setItem(marker, '1');
            location.reload();
            return user;
          }
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (tracked(k) && !cloudKeys.has(k)) save(k, localStorage.getItem(k));
          }
        } else {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (tracked(k)) save(k, localStorage.getItem(k));
          }
        }
        ready = true;
        await new Promise(resolve => document.readyState === 'loading'
          ? document.addEventListener('DOMContentLoaded', resolve, { once: true }) : resolve());
        const miniPlay = document.getElementById('pp'), miniRow = miniPlay?.closest('.ctr');
        if (miniPlay && miniRow) {
          const controls = [...miniRow.querySelectorAll('button')], prev = controls[0], next = controls[2];
          const repeat = document.createElement('button'); repeat.type = 'button'; repeat.textContent = 'Repeat: All';
          repeat.setAttribute('aria-label', 'Repeat playlist'); repeat.style.cssText = 'border:1px solid rgba(255,255,255,.6);background:rgba(255,255,255,.4);border-radius:12px;padding:6px 8px;color:var(--ink);font:600 11px Nunito,sans-serif'; miniRow.append(repeat);
          const paint = () => {
            const state = window.parent.SukunPlayer?.getState(); if (!state) return;
            miniPlay.setAttribute('aria-label', state.paused ? 'Play' : 'Pause');
            document.getElementById('ppI').innerHTML = state.paused ? '<path d="M7 4v16l13-8z"/>' : '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>';
            const title = document.getElementById('track');
            if (title) { title.textContent = state.name ? 'Now Playing: ' + state.name : 'No music playing'; if (state.name) { const small = document.createElement('small'); small.textContent = state.subtitle || ''; small.style.cssText = 'display:block;font-weight:400;color:var(--mute)'; title.append(small); } }
            const progress = document.getElementById('pi');
            if (progress) { const seconds = state.currentTime || 0; progress.style.width = (state.duration ? Math.min(100, seconds / state.duration * 100) : (seconds % 120) / 1.2) + '%'; }
            const mode = state.repeatMode || 'all'; repeat.textContent = 'Repeat: ' + (mode === 'all' ? 'All' : mode === 'one' ? 'One' : 'Off'); repeat.setAttribute('aria-pressed', mode !== 'off');
          };
          prev.onclick = () => window.parent.SukunPlayer?.previous().catch(() => {});
          miniPlay.onclick = () => window.parent.SukunPlayer?.toggle().catch(() => {});
          next.onclick = () => window.parent.SukunPlayer?.next().catch(() => {});
          repeat.onclick = () => window.parent.SukunPlayer?.cycleRepeat();
          setInterval(paint, 450); paint();
        }
        const isPartnerPage = location.pathname.toLowerCase().endsWith('/partner.html');
        if (isPartnerPage) return user;
        const account = document.createElement('div');
        account.id = 'sukunAccount';
        account.innerHTML = '<span></span><button type="button">Logout</button>';
        account.style.cssText = 'position:fixed;left:14px;bottom:100px;z-index:45;display:flex;align-items:center;gap:10px;max-width:calc(100vw - 28px);padding:7px 10px;background:#ffffffed;border:1px solid #ffffff;border-radius:999px;font:600 12px Nunito,sans-serif;color:#405766;box-shadow:0 4px 18px #1d2a3618';
        const email = account.querySelector('span');
        email.textContent = user.email || 'Signed in';
        email.style.cssText = 'max-width:min(220px,calc(100vw - 135px));overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        account.querySelector('button').style.cssText = 'border:0;border-radius:99px;padding:5px 9px;background:#6d8aa3;color:white;cursor:pointer;font:inherit';
        account.querySelector('button').onclick = async () => { await client.auth.signOut(); location.replace('index.html'); };
        const buddy = document.getElementById('bd');
        if (buddy) {
          account.style.cssText = 'position:relative;left:auto;bottom:auto;z-index:41;display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;max-width:100%;margin:0;padding:7px 10px;box-sizing:border-box;pointer-events:auto;background:#ffffffed;border:1px solid #ffffff;border-radius:999px;font:600 12px Nunito,sans-serif;color:#405766;box-shadow:0 4px 18px #1d2a3618';
          const buddyPlacement = document.createElement('style');
          buddyPlacement.textContent = '@media(max-width:760px){#bd .bd-r,#bd #sukunAccount{display:none!important}}';
          document.head.append(buddyPlacement);
          buddy.append(account);
        } else {
          const mobilePlacement = document.createElement('style');
          mobilePlacement.textContent = '@media(max-width:760px){#sukunAccount{left:10px!important;bottom:180px!important}}';
          document.head.append(mobilePlacement);
          document.body.append(account);
        }
        return user;
      }
      return null;
    })(),
    async signIn(email, password) { return client.auth.signInWithPassword({ email, password }); },
    async signUp(email, password) { return client.auth.signUp({ email, password }); }
  };
})();
