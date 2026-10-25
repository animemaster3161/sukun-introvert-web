(() => {
  const clientReady = window.supabase && window.SUKUN_SUPABASE_URL && window.SUKUN_SUPABASE_ANON_KEY &&
    !window.SUKUN_SUPABASE_URL.includes('YOUR-PROJECT') && !window.SUKUN_SUPABASE_ANON_KEY.includes('YOUR_SUPABASE');
  const frame = document.getElementById('app'), audio = new Audio();
  const $ = id => document.getElementById(id);
  let queue = [], current = null, objectUrl = null, timer = null, repeatMode = 'all', volumeLevel = .7, muted = false, ambientEnabled = true;
  let quotaClient = null;
  let ctx = null, sceneMaster = null, sceneGains = {}, mixLevels = { rain: 0, ocean: 0, wind: 0, pad: 0 };
  let sceneStarted = 0, sceneElapsed = 0;
  audio.preload = 'auto'; audio.volume = volumeLevel;
  const clock = n => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(Math.floor(n % 60)).padStart(2, '0');

  async function requireSession() {
    if (!clientReady) { location.replace('index.html'); return false; }
    quotaClient = window.supabase.createClient(window.SUKUN_SUPABASE_URL, window.SUKUN_SUPABASE_ANON_KEY);
    const { data } = await quotaClient.auth.getSession();
    if (!data.session) { location.replace('index.html'); return false; }
    quotaClient.auth.onAuthStateChange((_event, session) => { if (!session) location.replace('index.html'); });
    return true;
  }

  function initScenes() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    sceneMaster = ctx.createGain(); sceneMaster.gain.value = muted || !ambientEnabled ? 0 : volumeLevel; sceneMaster.connect(ctx.destination);
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), noiseData = buffer.getChannelData(0);
    for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;
    const noise = () => { const source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true; source.start(); return source; };
    const gain = name => { const node = ctx.createGain(); node.gain.value = 0; node.connect(sceneMaster); sceneGains[name] = node; return node; };
    const filter = (type, frequency, q) => { const node = ctx.createBiquadFilter(); node.type = type; node.frequency.value = frequency; if (q) node.Q.value = q; return node; };
    const lfo = (target, rate, depth) => { const osc = ctx.createOscillator(), amount = ctx.createGain(); osc.frequency.value = rate; amount.gain.value = depth; osc.connect(amount); amount.connect(target); osc.start(); };
    let f = filter('bandpass', 2200, .4); noise().connect(f); f.connect(gain('rain'));
    f = filter('lowpass', 600); const oceanGain = ctx.createGain(); oceanGain.gain.value = .5; noise().connect(f); f.connect(oceanGain); oceanGain.connect(gain('ocean')); lfo(oceanGain.gain, .12, .45);
    f = filter('bandpass', 500, 1.2); noise().connect(f); f.connect(gain('wind')); lfo(f.frequency, .08, 250);
    f = filter('lowpass', 800); [220, 261.63, 329.63, 392].forEach(freq => { const osc = ctx.createOscillator(), amp = ctx.createGain(); osc.type = 'triangle'; osc.frequency.value = freq; amp.gain.value = .1; osc.connect(amp); amp.connect(f); osc.start(); }); f.connect(gain('pad'));
    applyMix();
  }
  function applyMix() {
    if (ctx) Object.keys(sceneGains).forEach(key => sceneGains[key].gain.setTargetAtTime(mixLevels[key] || 0, ctx.currentTime, .35));
  }
  function setMix(levels) {
    mixLevels = { ...mixLevels, ...levels };
    if (!ctx) initScenes();
    applyMix();
    if (ambientEnabled && !muted && Object.values(mixLevels).some(value => value > 0)) ctx.resume().catch(() => {});
  }
  function update() {
    document.body.classList.toggle('has-song', !!current);
    $('songTitle').textContent = current?.name || 'No song playing';
    $('songSubtitle').textContent = current?.subtitle || 'Playing across Sukun pages';
    $('toggle').textContent = isPaused() ? '▶' : 'Ⅱ';
    $('toggle').setAttribute('aria-label', isPaused() ? 'Play' : 'Pause');
    $('songTime').textContent = clock(current?.type === 'scene' ? sceneElapsed + (ctx && ctx.state === 'running' ? (ctx.currentTime - sceneStarted) : 0) : audio.currentTime || 0);
    $('repeat').textContent = repeatMode === 'one' ? '↻ One' : repeatMode === 'all' ? '↻ All' : '↻ Off';
    $('repeat').setAttribute('aria-label', 'Repeat ' + repeatMode);
  }
  function isPaused() { return !current || (current.type === 'scene' ? !ctx || ctx.state !== 'running' : audio.paused); }
  function setQueue(items) {
    queue = Array.isArray(items) ? items : [];
    if (current) current = queue.find(track => track.id === current.id) || current;
    update();
  }
  function startTrack(track) {
    if (!track) return Promise.resolve();
    if (current?.type === 'scene' && ctx?.state === 'running') { sceneElapsed += ctx.currentTime - sceneStarted; ctx.suspend(); }
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
    current = track; sceneElapsed = 0; sceneStarted = 0;
    if (track.type === 'scene') {
      audio.pause(); audio.removeAttribute('src'); audio.load();
      initScenes(); setMix(track.levels || {}); sceneStarted = ctx.currentTime;
      return ctx.resume().then(update);
    }
    if (track.feature === 'playlist') setMix(track.levels || mixLevels);
    else if (ctx || Object.values(mixLevels).some(value => value > 0)) {
      initScenes(); applyMix();
      if (ambientEnabled && !muted && Object.values(mixLevels).some(value => value > 0)) ctx.resume().catch(() => {});
    }
    if (track.url) audio.src = track.url;
    else if (track.blob) { objectUrl = URL.createObjectURL(track.blob); audio.src = objectUrl; }
    audio.loop = repeatMode === 'one';
    update(); return audio.play().then(update);
  }
  function playTrack(id) { const track = queue.find(item => item.id === id); if (!track) return Promise.reject(new Error('Track is missing from the playlist.')); return startTrack(track); }
  function pause() {
    if (!current) return;
    if (current.type === 'scene' && ctx?.state === 'running') { sceneElapsed += ctx.currentTime - sceneStarted; ctx.suspend(); }
    else audio.pause();
    update();
  }
  function resume() {
    if (!current) return queue.length ? playTrack(queue[0].id) : Promise.resolve();
    if (current.type === 'scene') { sceneStarted = ctx.currentTime; return ctx.resume().then(update); }
    audio.loop = repeatMode === 'one'; return audio.play().then(update);
  }
  function toggle() { return isPaused() ? resume() : (pause(), Promise.resolve()); }
  function stop() {
    pause(); current = null; sceneElapsed = 0; clearTimeout(timer);
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
    audio.removeAttribute('src'); audio.load(); update();
  }
  function move(delta) {
    if (!queue.length) return Promise.resolve();
    const lane = current ? queue.filter(item => item.type === current.type) : queue;
    const index = current ? lane.findIndex(item => item.id === current.id) : -1;
    let next = index + delta;
    if (next < 0 || next >= lane.length) {
      if (repeatMode !== 'all') return delta > 0 ? (stop(), Promise.resolve()) : playTrack(lane[0].id);
      next = (next + lane.length) % lane.length;
    }
    return playTrack(lane[next].id);
  }
  function next() { return move(1); }
  function previous() { if (current?.type !== 'scene' && audio.currentTime > 3) { audio.currentTime = 0; return Promise.resolve(); } return move(-1); }
  function cycleRepeat() { repeatMode = repeatMode === 'all' ? 'one' : repeatMode === 'one' ? 'off' : 'all'; audio.loop = repeatMode === 'one'; update(); return repeatMode; }
  function setRepeatMode(mode) { if (['all', 'one', 'off'].includes(mode)) repeatMode = mode; audio.loop = repeatMode === 'one'; update(); }
  function seek(seconds) { if (current?.type !== 'scene' && Number.isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(seconds, audio.duration)); }
  function applyVolume() { audio.volume = muted ? 0 : volumeLevel; if (sceneMaster && ctx) sceneMaster.gain.setTargetAtTime(muted || !ambientEnabled ? 0 : volumeLevel, ctx.currentTime, .04); }
  function setVolume(value) { volumeLevel = Math.max(0, Math.min(1, Number(value) / 100)); muted = false; applyVolume(); $('volume').value = Math.round(volumeLevel * 100); }
  function setMuted(value) { muted = !!value; applyVolume(); update(); }
  function setAmbientEnabled(value) { ambientEnabled = !!value; applyVolume(); if (ambientEnabled && Object.values(mixLevels).some(level => level > 0) && ctx) ctx.resume().catch(() => {}); update(); }
  function setTimer(minutes) { clearTimeout(timer); if (minutes) timer = setTimeout(stop, minutes * 60000); }
  window.SukunPlayer = { setQueue, playTrack, toggle, pause, resume, stop, next, previous, seek, setVolume, setMuted, setAmbientEnabled, setMix, setTimer, cycleRepeat, setRepeatMode, getState: () => ({ id: current?.id || null, name: current?.name || '', subtitle: current?.subtitle || '', type: current?.type || '', feature: current?.feature || '', paused: isPaused(), currentTime: current?.type === 'scene' ? sceneElapsed + (ctx && ctx.state === 'running' ? ctx.currentTime - sceneStarted : 0) : audio.currentTime || 0, duration: current?.type === 'scene' ? 0 : Number.isFinite(audio.duration) ? audio.duration : 0, volume: volumeLevel, muted, ambientEnabled, repeatMode, levels: { ...mixLevels } }) };

  const quotaStatus = { playlist: null, partner: null }, quotaErrors = { playlist: 0, partner: 0 };
  const featureFromFrame = () => {
    try {
      const path = frame.contentWindow.location.pathname.toLowerCase();
      return path.endsWith('/playlist.html') ? 'playlist' : path.endsWith('/partner.html') ? 'partner' : '';
    } catch (_) { return ''; }
  };
  function quotaOverlay(feature, status, error) {
    try {
      const doc = frame.contentDocument, main = doc?.querySelector('main');
      if (!main) return;
      let overlay = doc.getElementById('sukunQuotaOverlay');
      if (!status && !error) { overlay?.remove(); return; }
      if (!overlay) {
        overlay = doc.createElement('section'); overlay.id = 'sukunQuotaOverlay';
        overlay.setAttribute('role', 'status');
        overlay.style.cssText = 'position:absolute;inset:0;z-index:48;display:grid;place-items:center;padding:24px;background:rgba(25,35,45,.5);backdrop-filter:blur(8px);text-align:center;color:#1d2a36';
        const panel = doc.createElement('div');
        panel.style.cssText = 'max-width:440px;padding:26px;border:1px solid rgba(255,255,255,.8);border-radius:22px;background:rgba(255,255,255,.9);box-shadow:0 12px 35px rgba(20,30,40,.25)';
        const heading = doc.createElement('h2'); heading.style.cssText = 'margin:0 0 10px;font:700 22px Nunito,system-ui,sans-serif';
        const message = doc.createElement('p'); message.style.cssText = 'margin:0;font:600 15px/1.5 Nunito,system-ui,sans-serif';
        panel.append(heading, message); overlay.append(panel); main.style.position = 'relative'; main.append(overlay);
      }
      const [heading, message] = overlay.querySelectorAll('h2,p');
      heading.textContent = error ? 'Daily limit setup needed' : 'Aaj ka time poora ho gaya';
      message.textContent = error
        ? 'Daily limits activate karne ke liye Supabase SQL Editor mein supabase-quota.sql run karein. Baaki features chalte rahenge.'
        : (feature === 'playlist' ? 'Playlist ka 18-minute daily limit poora ho gaya. Kal phir use kar paayenge.' : 'Partner ka 18-minute daily limit poora ho gaya. Kal phir use kar paayenge.');
    } catch (_) {}
  }
  async function tickQuota(feature) {
    if (!quotaClient || !['playlist', 'partner'].includes(feature)) return;
    const { data, error } = await quotaClient.rpc('sukun_tick_feature', { p_feature: feature });
    if (error || !data?.length) {
      quotaErrors[feature]++;
      if (quotaErrors[feature] >= 3 && featureFromFrame() === feature) quotaOverlay(feature, null, true);
      return;
    }
    quotaErrors[feature] = 0;
    const row = data[0]; quotaStatus[feature] = row;
    if (featureFromFrame() === feature) quotaOverlay(feature, !row.allowed, false);
    if (feature === 'playlist' && !row.allowed && current?.feature === 'playlist') stop();
  }
  function checkQuotaUsage() {
    if (document.visibilityState !== 'visible') return;
    const pageFeature = featureFromFrame();
    const state = window.SukunPlayer.getState();
    if (pageFeature) tickQuota(pageFeature).catch(() => {});
    if (state.feature === 'playlist' && !state.paused && pageFeature !== 'playlist') tickQuota('playlist').catch(() => {});
  }
  frame.addEventListener('load', () => {
    const feature = featureFromFrame();
    if (feature) tickQuota(feature).catch(() => {});
  });
  setInterval(checkQuotaUsage, 5000);

  $('toggle').onclick = () => toggle().catch(() => {});
  $('previous').onclick = () => previous().catch(() => {});
  $('next').onclick = () => next().catch(() => {});
  $('repeat').onclick = cycleRepeat;
  $('stop').onclick = stop;
  $('volume').oninput = e => setVolume(e.target.value);
  audio.addEventListener('timeupdate', update);
  audio.addEventListener('ended', () => { if (repeatMode !== 'one') next().catch(() => {}); });

  (async () => {
    if (!await requireSession()) return;
    const target = new URLSearchParams(location.search).get('page') || 'Sukun.html';
    const allowed = new Set(['Sukun.html','goals.html','journal.html','myday.html','playlist.html','routine.html','partner.html']);
    frame.src = allowed.has(target) ? target : 'Sukun.html';
  })();
})();
