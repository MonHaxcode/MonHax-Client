const api = window.api;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KIND_LABEL = { mods: 'Mods', shaders: 'Shader', resourcepacks: 'Ressourcenpakete' };

const S = {
  page: 'home', inst: [], sel: null, tab: 'mods', versions: [], running: false, logs: [],
  disc: { inst: null, kind: 'mods', source: 'modrinth', q: '', res: null },
};

function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.className = ''), 4500);
}
const safe = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, true); } };
const fmtSize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
const fmtNum = (n) => Number(n || 0).toLocaleString('de-DE', { notation: 'compact' });

async function loadInst() {
  S.inst = await api.call('instances:list');
  if (!S.inst.find((i) => i.id === S.sel)) S.sel = S.inst[0] ? S.inst[0].id : null;
}

// ───────────── Navigation ─────────────
const pages = {};
async function go(page) {
  S.page = page;
  $$('nav button').forEach((b) => b.classList.toggle('on', b.dataset.page === page));
  ['home', 'library', 'discover', 'news', 'cosmetics', 'settings'].forEach((p) => ($('#p-' + p).hidden = p !== page));
  localStorage.setItem('last', page);
  await safe(pages[page])();
}
$$('nav button').forEach((b) => b.addEventListener('click', () => go(b.dataset.page)));
$('#acc').addEventListener('click', () => go('settings'));

async function refreshAccount() {
  const a = await api.call('account');
  $('#accName').textContent = a.name;
  $('#accAv').textContent = (a.name || 'M')[0].toUpperCase();
  $('#accState').innerHTML = `<u></u>${a.mode === 'microsoft' ? 'Online' : 'Offline'}`;
  $('#acc').classList.toggle('ms', a.mode === 'microsoft');
  return a;
}

// ───────────── Startseite, Spielstart ─────────────
const refreshPlay = () => $$('.play-btn').forEach((b) => { b.disabled = S.running; const t = b.querySelector('span'); if (t) t.textContent = S.running ? 'Läuft…' : 'Spielen'; });
const startGame = safe(async (id) => {
  if (S.running) return;
  S.running = true; S.logs = []; refreshPlay();
  try { await api.call('launch', id); toast('Minecraft wurde gestartet'); }
  catch (e) { S.running = false; refreshPlay(); throw e; }
});

pages.home = async () => {
  await loadInst();
  const saved = localStorage.getItem('sel');
  if (saved && S.inst.find((i) => i.id === saved)) S.sel = saved;
  const sel = $('#hSel');
  sel.innerHTML = S.inst.map((i) => `<option value="${esc(i.id)}" ${i.id === S.sel ? 'selected' : ''}>${esc(i.name)}</option>`).join('') || '<option value="">Noch keine Installation</option>';
  const upd = () => { const c = S.inst.find((i) => i.id === S.sel); $('#hVer').textContent = c ? `${c.loader === 'fabric' ? 'Fabric' : 'Vanilla'} ${c.mc}` : 'Lege zuerst eine Installation an'; };
  sel.onchange = () => { S.sel = sel.value; localStorage.setItem('sel', S.sel); upd(); };
  $('#homePlay').onclick = () => (S.sel ? startGame(S.sel) : openNew());
  $('#hFolder').onclick = safe(async () => { if (S.sel) await api.call('instances:open', S.sel); });
  $('#hMore').onclick = () => go('library');
  upd(); refreshPlay();
};

pages.news = async () => {
  const el = $('#p-news');
  el.innerHTML = '<h2>Neuigkeiten</h2><p class="empty">Lädt…</p>';
  const list = await api.call('news');
  el.innerHTML = `<h2>Neuigkeiten</h2><div class="news">${list.map((n) => `<div class="nc">${n.image ? `<img src="${esc(n.image)}" alt="">` : ''}<div><b>${esc(n.title)}</b><br><small>${esc(n.type)}, ${esc(n.version)}</small><p>${esc(n.text)}</p></div></div>`).join('') || '<p class="empty">Gerade keine Neuigkeiten.</p>'}</div>`;
};

// ───────────── Installationen ─────────────
pages.library = async () => {
  await loadInst();
  const el = $('#p-library');
  const cur = S.inst.find((i) => i.id === S.sel);
  el.innerHTML = `
    <div class="split">
      <div class="list">
        <div class="head"><h2>Modpacks</h2><button class="btn" id="new">Neu</button></div>
        ${S.inst.map((i) => `<button class="pack ${i.id === S.sel ? 'on' : ''}" data-id="${esc(i.id)}"><b>${esc(i.name)}</b><span>${i.loader === 'fabric' ? 'Fabric' : 'Vanilla'} ${esc(i.mc)}</span></button>`).join('') || '<p class="empty">Noch kein Modpack. Leg dein erstes an.</p>'}
      </div>
      <div class="detail">${cur ? `
        <div class="top">
          <div><h2>${esc(cur.name)}</h2><p>${cur.loader === 'fabric' ? 'Fabric' : 'Vanilla'}, Minecraft ${esc(cur.mc)}, ${cur.ram} MB RAM</p></div>
          <button class="btn play play-btn" id="play" ${S.running ? 'disabled' : ''}><span>${S.running ? 'Läuft…' : 'Spielen'}</span></button>
        </div>
        <div class="tabs">${Object.keys(KIND_LABEL).map((k) => `<button data-tab="${k}" class="${S.tab === k ? 'on' : ''}">${KIND_LABEL[k]}</button>`).join('')}</div>
        <div id="files"></div>
        <div class="tools">
          <button class="ghost" id="add">Mehr hinzufügen</button>
          <button class="ghost" id="folder">Ordner öffnen</button>
          <button class="ghost danger" id="del">Löschen</button>
        </div>
        <div class="console"><div class="pbar"><i id="pb"></i></div><pre id="log"></pre></div>` : '<p class="empty">Wähle ein Modpack oder erstelle ein neues.</p>'}
      </div>
    </div>`;
  $('#new').onclick = openNew;
  $$('.pack', el).forEach((b) => (b.onclick = () => { S.sel = b.dataset.id; localStorage.setItem('sel', S.sel); pages.library(); }));
  if (!cur) return;
  $('#log').textContent = S.logs.join('\n');
  $$('.tabs button', el).forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; pages.library(); }));
  $('#play').onclick = () => startGame(cur.id);
  $('#add').onclick = () => { S.disc.inst = cur.id; S.disc.kind = S.tab; S.disc.res = null; go('discover'); };
  $('#folder').onclick = () => api.call('instances:open', cur.id);
  $('#del').onclick = safe(async () => { if (!confirm(`„${cur.name}" wirklich löschen? Alle Mods und Welten darin gehen verloren.`)) return; await api.call('instances:delete', cur.id); toast('Modpack gelöscht'); pages.library(); });
  const files = await api.call('files', cur.id, S.tab);
  $('#files').innerHTML = files.map((f) => `<div class="file"><b>${esc(f.name)}</b><small>${fmtSize(f.size)}</small><button data-rm="${esc(f.name)}" title="Entfernen">Entfernen</button></div>`).join('') || `<p class="empty">Hier ist noch nichts drin. Über „Mehr hinzufügen" findest du ${KIND_LABEL[S.tab]}.</p>`;
  $$('[data-rm]').forEach((b) => (b.onclick = safe(async () => { await api.call('files:remove', cur.id, S.tab, b.dataset.rm); pages.library(); })));
};

api.on('log', (m) => {
  S.logs.push(m);
  if (S.logs.length > 400) S.logs.shift();
  const p = $('#log');
  if (p) { p.append(document.createTextNode(m + '\n')); p.scrollTop = p.scrollHeight; }
});
api.on('progress', (p) => { const b = $('#pb'); if (b && p.total) b.style.width = Math.min(100, (p.task / p.total) * 100) + '%'; });
api.on('closed', (code) => { S.running = false; refreshPlay(); toast(code === 0 ? 'Minecraft wurde beendet' : `Minecraft wurde beendet (Code ${code})`, code !== 0); if (S.page === 'library') pages.library(); });

// Neues Modpack
async function openNew() {
  if (!S.versions.length) S.versions = await safe(() => api.call('versions'))() || [];
  $('#nVer').innerHTML = S.versions.map((v) => `<option>${esc(v)}</option>`).join('');
  $('#nName').value = '';
  $('#dlg').showModal();
}
$('#nRam').oninput = (e) => ($('#nRamV').textContent = e.target.value);
$('#nCancel').onclick = () => $('#dlg').close();
$('#nOk').onclick = safe(async () => {
  const btn = $('#nOk');
  btn.disabled = true; btn.textContent = 'Wird angelegt…';
  try {
    const inst = await api.call('instances:create', { name: $('#nName').value, mc: $('#nVer').value, loader: $('#nLoader').value, ram: $('#nRam').value });
    S.sel = inst.id; S.tab = 'mods';
    $('#dlg').close();
    toast('Modpack angelegt');
    pages.library();
  } finally { btn.disabled = false; btn.textContent = 'Anlegen'; }
});

// ───────────── Entdecken ─────────────
pages.discover = async () => {
  await loadInst();
  const d = S.disc, el = $('#p-discover');
  if (!S.inst.find((i) => i.id === d.inst)) d.inst = S.sel;
  if (!S.inst.length) { el.innerHTML = '<h2>Entdecken</h2><p class="empty">Lege zuerst ein Modpack an, dann kannst du hier Mods und Shader suchen.</p>'; return; }
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`;
  el.innerHTML = `
    <h2>Entdecken</h2>
    <div class="bar-row">
      <select id="dInst">${S.inst.map((i) => opt(i.id, `${i.name} (${i.mc})`, d.inst)).join('')}</select>
      <select id="dKind">${Object.entries(KIND_LABEL).map(([k, l]) => opt(k, l, d.kind)).join('')}</select>
      <select id="dSrc">${opt('modrinth', 'Modrinth', d.source)}${opt('curseforge', 'CurseForge', d.source)}</select>
    </div>
    <div class="bar-row"><input id="dQ" placeholder="Suchen, z. B. Sodium, Complementary, Faithful" value="${esc(d.q)}"><button class="btn" id="dGo">Suchen</button></div>
    ${d.kind === 'shaders' ? '<div class="note">Shader laufen in Fabric über Iris und Sodium. <button class="link" id="base">Beides installieren</button></div>' : ''}
    <div id="dRes"></div>`;
  $('#dInst').onchange = (e) => { d.inst = e.target.value; d.res = null; search(); };
  $('#dKind').onchange = (e) => { d.kind = e.target.value; d.res = null; pages.discover(); };
  $('#dSrc').onchange = (e) => { d.source = e.target.value; d.res = null; search(); };
  $('#dGo').onclick = () => { d.q = $('#dQ').value; search(); };
  $('#dQ').onkeydown = (e) => { if (e.key === 'Enter') $('#dGo').click(); };
  if ($('#base')) $('#base').onclick = safe(async () => { toast('Installiere Sodium und Iris…'); const out = await api.call('install:base', d.inst); toast(out.length ? `${out.length} Datei(en) installiert` : 'Schon alles installiert'); });
  if (d.res) renderResults(); else search();
};

const search = safe(async () => {
  const d = S.disc;
  $('#dRes').innerHTML = '<p class="empty">Suche läuft…</p>';
  d.res = await api.call('search', { id: d.inst, kind: d.kind, source: d.source, query: d.q });
  renderResults();
});

function renderResults() {
  const d = S.disc, box = $('#dRes');
  if (!box) return;
  box.innerHTML = d.res.map((r, i) => `
    <div class="row">${r.icon ? `<img src="${esc(r.icon)}" alt="">` : '<div class="ph"></div>'}
      <div><b>${esc(r.title)}</b><p>${esc(r.desc)}</p></div>
      <small>${fmtNum(r.downloads)}</small>
      <button class="btn" data-i="${i}">Installieren</button>
    </div>`).join('') || '<p class="empty">Nichts gefunden. Probier einen anderen Suchbegriff oder die andere Quelle.</p>';
  $$('[data-i]', box).forEach((b) => (b.onclick = safe(async () => {
    const r = d.res[b.dataset.i];
    b.disabled = true; b.textContent = 'Lädt…';
    try {
      const out = await api.call('install', { id: d.inst, kind: d.kind, source: r.source, projectId: r.id });
      toast(out.length ? `${r.title} installiert (${out.length} Datei${out.length > 1 ? 'en' : ''})` : `${r.title} ist schon installiert`);
      b.textContent = 'Installiert';
    } catch (e) { b.disabled = false; b.textContent = 'Installieren'; throw e; }
  })));
}

// ───────────── Cosmetics ─────────────
function drawSkin(c, img, k = 6) {
  const x = c.getContext('2d');
  c.width = 16 * k; c.height = 32 * k;
  x.imageSmoothingEnabled = false;
  x.scale(k, k);
  const full = img.height >= 64;
  const p = (sx, sy, w, h, dx, dy) => x.drawImage(img, sx, sy, w, h, dx, dy, w, h);
  p(4, 20, 4, 12, 4, 20); p(full ? 20 : 4, full ? 52 : 20, 4, 12, 8, 20);
  p(20, 20, 8, 12, 4, 8);
  p(44, 20, 4, 12, 0, 8); p(full ? 36 : 44, full ? 52 : 20, 4, 12, 12, 8);
  p(8, 8, 8, 8, 4, 0); p(40, 8, 8, 8, 4, 0);
}
function drawCape(c, img, k = 8) {
  const x = c.getContext('2d'), u = img.width / 64;
  c.width = 10 * k; c.height = 16 * k;
  x.imageSmoothingEnabled = false;
  x.drawImage(img, u, u, 10 * u, 16 * u, 0, 0, 10 * k, 16 * k);
}
const loadImg = (src, cb) => { const i = new Image(); i.onload = () => cb(i); i.src = src; };
S.cos = { tab: 'skin' };

pages.cosmetics = async () => {
  const el = $('#p-cosmetics'), tab = S.cos.tab;
  const skins = await api.call('skin:list');
  const capes = await api.call('cosmetic:list', 'cape');
  const ms = tab === 'cape' ? await api.call('capes') : null;
  const items = tab === 'skin' ? skins : capes;
  const aSkin = skins.find((s) => s.active), aCape = capes.find((c) => c.active);
  el.innerHTML = `
    <h2>Cosmetics</h2>
    <div class="cos-wrap">
      <div class="pv"><h3>Du trägst</h3>
        <div class="pair"><canvas id="pvS" width="96" height="192"></canvas><canvas id="pvC" width="80" height="128"></canvas></div>
        <small style="color:var(--muted)">${esc(aSkin ? aSkin.name : 'Standard-Skin')}<br>${esc(aCape ? aCape.name : 'Keine Cape')}</small>
      </div>
      <div>
        <div class="head">
          <div class="tabs" style="flex:1;margin:0;border:0"><button data-t="skin" class="${tab === 'skin' ? 'on' : ''}">Skins</button><button data-t="cape" class="${tab === 'cape' ? 'on' : ''}">Capes</button></div>
          ${tab === 'skin' ? '<label class="chk"><input type="checkbox" id="slim"> Slim-Modell</label>' : ''}
          <button class="ghost" id="byUrl">Per Link laden</button><button class="btn" id="up">Hochladen</button>
        </div>
        <div class="grid">${items.map((s) => `
          <div class="card ${s.active ? 'on' : ''}"><canvas data-k="${tab}" data-src="${s.data}"></canvas><b>${esc(s.name)}</b>
            ${tab === 'skin' ? `<select data-slim="${s.id}"><option value="0" ${s.slim ? '' : 'selected'}>Classic</option><option value="1" ${s.slim ? 'selected' : ''}>Slim</option></select>` : ''}
            <div class="acts"><button class="btn" data-use="${s.id}" data-on="${s.active ? 1 : 0}">${s.active ? 'Ablegen' : 'Anziehen'}</button><button class="ghost" data-exp="${s.id}">Speichern</button><button class="ghost danger" data-del="${s.id}">Löschen</button></div></div>`).join('') || `<p class="empty">${tab === 'skin' ? 'Lade eine Skin-PNG (64×64) hoch.' : 'Lade eine Cape-PNG (64×32) hoch.'}</p>`}</div>
        ${tab === 'cape' ? (ms.online ? `<div class="head"><h3>Capes deines Microsoft-Kontos</h3></div><div class="grid">${ms.capes.map((c) => `<div class="card ${c.state === 'ACTIVE' ? 'on' : ''}"><canvas data-k="cape" data-src="${esc(c.url.replace(/^http:/, 'https:'))}"></canvas><b>${esc(c.alias || 'Cape')}</b><div class="acts"><button class="ghost" data-ms="${c.state === 'ACTIVE' ? '' : esc(c.id)}">${c.state === 'ACTIVE' ? 'Ablegen' : 'Tragen'}</button></div></div>`).join('') || '<p class="empty">Keine Capes auf deinem Konto.</p>'}</div>` : '') : ''}
        <p class="note">${tab === 'skin' ? 'Skins: Mit Microsoft-Konto gehen sie direkt zu Mojang und sind überall sichtbar. Offline legt der Launcher sie beim Start als Ressourcenpaket ins Pack.' : 'Capes: Der Launcher legt beim Start die MonHax-Cosmetics-Mod (Fabric 1.21.1) ins Pack, damit du deine Cape im Spiel siehst. Andere Spieler sehen sie noch nicht.'}</p>
      </div>
    </div>`;
  $$('canvas[data-src]', el).forEach((c) => loadImg(c.dataset.src, (i) => (c.dataset.k === 'skin' ? drawSkin(c, i) : drawCape(c, i))));
  if (aSkin) loadImg(aSkin.data, (i) => drawSkin($('#pvS'), i)); else drawSkin($('#pvS'), Object.assign(new Image(), { width: 64, height: 64 }));
  if (aCape) loadImg(aCape.data, (i) => drawCape($('#pvC'), i, 8));
  $$('[data-t]', el).forEach((b) => (b.onclick = () => { S.cos.tab = b.dataset.t; pages.cosmetics(); }));
  $('#up').onclick = safe(async () => {
    const ok = tab === 'skin' ? await api.call('skin:add', { slim: $('#slim').checked }) : await api.call('cosmetic:add', { kind: 'cape' });
    if (ok) { toast('Gespeichert'); pages.cosmetics(); }
  });
  $('#byUrl').onclick = () => { $('#uSlimW').hidden = tab !== 'skin'; $('#uUrl').value = ''; $('#dlg2').showModal(); };
  $$('[data-use]', el).forEach((b) => (b.onclick = safe(async () => {
    const id = b.dataset.on === '1' ? null : b.dataset.use;
    if (tab === 'skin') { const r = await api.call('skin:apply', id); toast(r.online ? 'Skin zu deinem Microsoft-Konto hochgeladen' : 'Skin ist aktiv und gilt beim nächsten Start'); }
    else { await api.call('cosmetic:use', { kind: 'cape', id }); toast(id ? 'Cape ist aktiv und gilt beim nächsten Start' : 'Cape abgelegt'); }
    pages.cosmetics();
  })));
  $$('[data-exp]', el).forEach((b) => (b.onclick = safe(async () => { if (await api.call('cosmetic:export', { kind: tab, id: b.dataset.exp })) toast('Datei gespeichert'); })));
  $$('[data-del]', el).forEach((b) => (b.onclick = safe(async () => { await api.call('cosmetic:remove', { kind: tab, id: b.dataset.del }); pages.cosmetics(); })));
  $$('[data-slim]', el).forEach((s) => (s.onchange = safe(async () => { await api.call('skin:slim', { id: s.dataset.slim, slim: s.value === '1' }); })));
  $$('[data-ms]', el).forEach((b) => (b.onclick = safe(async () => { await api.call('cape:set', b.dataset.ms || null); toast('Cape geändert'); pages.cosmetics(); })));
};
$('#uCancel').onclick = () => $('#dlg2').close();
$('#uOk').onclick = safe(async () => {
  await api.call('cosmetic:url', { kind: S.cos.tab, url: $('#uUrl').value.trim(), slim: $('#uSlim').checked });
  $('#dlg2').close(); toast('Geladen'); pages.cosmetics();
});
$$('[data-win]').forEach((b) => (b.onclick = () => api.call('win', b.dataset.win)));

// ───────────── Einstellungen ─────────────
pages.settings = async () => {
  const el = $('#p-settings');
  const s = await api.call('settings:get');
  const a = await refreshAccount();
  el.innerHTML = `
    <h2>Einstellungen</h2>
    <div class="form set">
      <h3>Konto</h3>
      <p style="color:var(--muted)">${a.mode === 'microsoft' ? `Angemeldet als ${esc(a.name)}.` : 'Du spielst offline. Online-Server brauchen ein Microsoft-Konto.'}</p>
      <div class="acts" style="margin:0">${a.mode === 'microsoft' ? '<button class="ghost" id="out">Abmelden</button>' : '<button class="btn" id="ms">Mit Microsoft anmelden</button>'}</div>
      <label>Offline-Name<input id="sOff" value="${esc(s.offlineName)}"></label>
    </div>
    <div class="form set">
      <h3>CurseForge</h3>
      <label>API-Key (kostenlos auf console.curseforge.com)<input id="sKey" type="password" value="${esc(s.cfKey)}" placeholder="Nur für die CurseForge-Suche nötig"></label>
    </div>
    <div class="form set">
      <h3>Java</h3>
      <label>Pfad zu java.exe (Minecraft 26.x braucht Java 25, 1.21.1 braucht Java 21)<input id="sJava" value="${esc(s.java)}"></label>
      <div><button class="btn" id="save">Speichern</button></div>
    </div>`;
  $('#save').onclick = safe(async () => { await api.call('settings:set', { cfKey: $('#sKey').value, java: $('#sJava').value, offlineName: $('#sOff').value }); await refreshAccount(); toast('Gespeichert'); });
  if ($('#ms')) $('#ms').onclick = safe(async () => { await api.call('login:ms'); toast('Angemeldet'); pages.settings(); });
  if ($('#out')) $('#out').onclick = safe(async () => { await api.call('logout'); pages.settings(); });
};

refreshAccount();
go('home');
