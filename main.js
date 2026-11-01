const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const { Client, Authenticator } = require('minecraft-launcher-core');
const { Auth } = require('msmc');

// ───────────── Pfade ─────────────
const DATA = path.join(app.getPath('userData'), 'launcher');
const ROOT = path.join(DATA, 'shared');       // libraries, assets, versions (geteilt)
const INST = path.join(DATA, 'instances');    // ein Ordner pro Modpack
const SKINS = path.join(DATA, 'skins');
const CAPES = path.join(DATA, 'capes');
for (const d of [ROOT, INST, SKINS, CAPES]) fs.mkdirSync(d, { recursive: true });
const CFG = path.join(DATA, 'config.json');
const DB = path.join(DATA, 'instances.json');

const UA = { 'User-Agent': 'MonHaxLauncher/1.0' };
const KINDS = { mods: 'mods', shaders: 'shaderpacks', resourcepacks: 'resourcepacks' };

const readJson = async (f, d) => { try { return JSON.parse(await fsp.readFile(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => fsp.writeFile(f, JSON.stringify(v, null, 2));
const getCfg = async () => ({ cfKey: '', java: 'java', offlineName: 'Player', skins: [], activeSkin: null, capes: [], activeCape: null, ...(await readJson(CFG, {})) });
const saveCfg = (c) => writeJson(CFG, c);
const getDb = () => readJson(DB, []);

const session = { ms: null, name: null };
let win = null;
let running = false;

// ───────────── HTTP ─────────────
async function getJson(url, opt = {}) {
  const r = await fetch(url, { ...opt, headers: { ...UA, ...(opt.headers || {}) } });
  if (!r.ok) throw new Error(`Anfrage fehlgeschlagen (${r.status}) bei ${new URL(url).hostname}`);
  return r.json();
}
async function download(url, dest) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`Download fehlgeschlagen (${r.status})`);
  await fsp.writeFile(dest, Buffer.from(await r.arrayBuffer()));
}

// ───────────── Modrinth ─────────────
const MR = 'https://api.modrinth.com/v2';
const mrType = { mods: 'mod', shaders: 'shader', resourcepacks: 'resourcepack' };
const enc = (v) => encodeURIComponent(JSON.stringify(v));

async function mrSearch({ kind, query, mc, loader }) {
  const f = [[`project_type:${mrType[kind]}`]];
  if (mc) f.push([`versions:${mc}`]);
  if (kind === 'mods' && loader === 'fabric') f.push(['categories:fabric']);
  const d = await getJson(`${MR}/search?query=${encodeURIComponent(query || '')}&facets=${enc(f)}&limit=24`);
  return d.hits.map((h) => ({ id: h.project_id, title: h.title, desc: h.description, icon: h.icon_url, downloads: h.downloads, source: 'modrinth' }));
}

async function mrInstall({ kind, projectId, mc, loader, dir, done = new Set() }) {
  if (done.has(projectId)) return [];
  done.add(projectId);
  const q = [`game_versions=${enc([mc])}`];
  if (kind === 'mods' && loader === 'fabric') q.push(`loaders=${enc(['fabric'])}`);
  const vs = await getJson(`${MR}/project/${projectId}/version?${q.join('&')}`);
  if (!vs.length) throw new Error(`Keine passende Version für ${mc} gefunden (${projectId})`);
  const v = vs.find((x) => x.version_type === 'release') || vs[0];
  const file = v.files.find((f) => f.primary) || v.files[0];
  const target = path.join(dir, KINDS[kind]);
  await fsp.mkdir(target, { recursive: true });
  const dest = path.join(target, file.filename);
  const out = [];
  if (!fs.existsSync(dest)) { await download(file.url, dest); out.push(file.filename); }
  if (kind === 'mods') {
    for (const dep of v.dependencies || []) {
      if (dep.dependency_type === 'required' && dep.project_id) {
        out.push(...(await mrInstall({ kind, projectId: dep.project_id, mc, loader, dir, done })));
      }
    }
  }
  return out;
}

// ───────────── CurseForge ─────────────
const CF = 'https://api.curseforge.com/v1';
const cfClass = { mods: 6, shaders: 6552, resourcepacks: 12 };
const cf = (p, key) => {
  if (!key) throw new Error('CurseForge-API-Key fehlt. Trag ihn in den Einstellungen ein.');
  return getJson(CF + p, { headers: { 'x-api-key': key, Accept: 'application/json' } });
};

async function cfSearch({ kind, query, mc, loader }, key) {
  let p = `/mods/search?gameId=432&classId=${cfClass[kind]}&searchFilter=${encodeURIComponent(query || '')}&pageSize=24&sortField=2&sortOrder=desc`;
  if (mc) p += `&gameVersion=${encodeURIComponent(mc)}`;
  if (kind === 'mods' && loader === 'fabric') p += '&modLoaderType=4';
  const d = await cf(p, key);
  return d.data.map((m) => ({ id: String(m.id), title: m.name, desc: m.summary, icon: m.logo && m.logo.thumbnailUrl, downloads: m.downloadCount, source: 'curseforge' }));
}

async function cfInstall({ kind, projectId, mc, loader, dir, key, done = new Set() }) {
  if (done.has(projectId)) return [];
  done.add(projectId);
  let p = `/mods/${projectId}/files?gameVersion=${encodeURIComponent(mc)}&pageSize=30`;
  if (kind === 'mods' && loader === 'fabric') p += '&modLoaderType=4';
  const files = (await cf(p, key)).data.sort((a, b) => new Date(b.fileDate) - new Date(a.fileDate));
  if (!files.length) throw new Error(`Keine passende Datei für ${mc} gefunden`);
  const f = files.find((x) => x.releaseType === 1) || files[0];
  if (!f.downloadUrl) throw new Error(`${f.fileName}: Der Autor erlaubt keine Downloads außerhalb von CurseForge. Nimm die Modrinth-Quelle.`);
  const target = path.join(dir, KINDS[kind]);
  await fsp.mkdir(target, { recursive: true });
  const dest = path.join(target, f.fileName);
  const out = [];
  if (!fs.existsSync(dest)) { await download(f.downloadUrl, dest); out.push(f.fileName); }
  if (kind === 'mods') {
    for (const dep of f.dependencies || []) {
      if (dep.relationType === 3) out.push(...(await cfInstall({ kind, projectId: String(dep.modId), mc, loader, dir, key, done })));
    }
  }
  return out;
}

// ───────────── Fabric ─────────────
async function installFabric(mc) {
  const l = await getJson(`https://meta.fabricmc.net/v2/versions/loader/${mc}`);
  if (!l.length) throw new Error(`Fabric unterstützt ${mc} noch nicht.`);
  const pick = l.find((x) => x.loader.stable) || l[0];
  const prof = await getJson(`https://meta.fabricmc.net/v2/versions/loader/${mc}/${pick.loader.version}/profile/json`);
  const d = path.join(ROOT, 'versions', prof.id);
  await fsp.mkdir(d, { recursive: true });
  await writeJson(path.join(d, prof.id + '.json'), prof);
  return prof.id;
}

// ───────────── Skin als Ressourcenpaket (Offline-Modus) ─────────────
async function applySkinPack(dir, cfg) {
  const pack = path.join(dir, 'resourcepacks', 'MonHaxSkin');
  const skin = cfg.skins.find((s) => s.id === cfg.activeSkin);
  if (!skin) { await fsp.rm(pack, { recursive: true, force: true }); return; }
  const png = await fsp.readFile(path.join(SKINS, skin.id + '.png'));
  const base = path.join(pack, 'assets', 'minecraft', 'textures', 'entity');
  const names = ['alex', 'ari', 'efe', 'kai', 'makena', 'noor', 'steve', 'sunny', 'zuri'];
  for (const t of ['wide', 'slim']) {
    const d = path.join(base, 'player', t);
    await fsp.mkdir(d, { recursive: true });
    for (const n of names) await fsp.writeFile(path.join(d, n + '.png'), png);
  }
  await fsp.writeFile(path.join(base, 'steve.png'), png); // ältere Versionen
  await fsp.writeFile(path.join(base, 'alex.png'), png);
  await writeJson(path.join(pack, 'pack.mcmeta'), {
    pack: { pack_format: 34, description: 'MonHax Launcher Skin', supported_formats: { min_inclusive: 1, max_inclusive: 999 }, min_format: 1, max_format: 999 },
  });
  const of = path.join(dir, 'options.txt');
  let t = '';
  try { t = await fsp.readFile(of, 'utf8'); } catch {}
  const entry = 'file/MonHaxSkin';
  const m = t.match(/^resourcePacks:(.*)$/m);
  if (m) {
    try {
      const arr = JSON.parse(m[1]);
      if (!arr.includes(entry)) arr.push(entry);
      t = t.replace(m[0], 'resourcePacks:' + JSON.stringify(arr));
    } catch {}
  } else {
    t += `${t && !t.endsWith('\n') ? '\n' : ''}resourcePacks:["vanilla","${entry}"]\n`;
  }
  await fsp.writeFile(of, t);
}

// ───────────── IPC ─────────────
const h = (ch, fn) => ipcMain.handle(ch, async (_e, ...a) => {
  try { return { ok: true, data: await fn(...a) }; } catch (err) { return { ok: false, error: err.message || String(err) }; }
});
const send = (c, d) => { if (win && !win.isDestroyed()) win.webContents.send(c, d); };
const mcHeaders = (json) => ({ Authorization: 'Bearer ' + session.ms.access_token, ...(json ? { 'Content-Type': 'application/json' } : {}) });

h('versions', async () => {
  const m = await getJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
  return m.versions.filter((v) => v.type === 'release').slice(0, 80).map((v) => v.id);
});

h('instances:list', () => getDb());

h('instances:create', async ({ name, mc, loader, ram }) => {
  if (!name || !name.trim()) throw new Error('Gib dem Modpack einen Namen.');
  const db = await getDb();
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + crypto.randomBytes(2).toString('hex');
  const inst = { id, name: name.trim(), mc, loader, ram: Number(ram) || 4096, created: Date.now() };
  const dir = path.join(INST, id);
  try {
    for (const k of Object.values(KINDS)) await fsp.mkdir(path.join(dir, k), { recursive: true });
    if (loader === 'fabric') {
      inst.customId = await installFabric(mc);
      await mrInstall({ kind: 'mods', projectId: 'fabric-api', mc, loader, dir });
    }
  } catch (e) {
    await fsp.rm(dir, { recursive: true, force: true });
    throw e;
  }
  db.push(inst);
  await writeJson(DB, db);
  return inst;
});

h('instances:delete', async (id) => {
  await writeJson(DB, (await getDb()).filter((i) => i.id !== id));
  await fsp.rm(path.join(INST, id), { recursive: true, force: true });
});

h('instances:open', (id) => shell.openPath(path.join(INST, id)));

h('files', async (id, kind) => {
  const d = path.join(INST, id, KINDS[kind]);
  let names = [];
  try { names = await fsp.readdir(d); } catch {}
  names = names.filter((n) => !n.startsWith('.') && n !== 'MonHaxSkin');
  return Promise.all(names.map(async (name) => ({ name, size: (await fsp.stat(path.join(d, name))).size })));
});

h('files:remove', async (id, kind, name) => {
  if (name.includes('..') || name.includes('/') || name.includes('\\')) throw new Error('Ungültiger Dateiname');
  await fsp.rm(path.join(INST, id, KINDS[kind], name), { recursive: true, force: true });
});

h('search', async (o) => {
  const cfg = await getCfg();
  const inst = (await getDb()).find((i) => i.id === o.id);
  if (!inst) throw new Error('Wähle zuerst ein Modpack.');
  const args = { kind: o.kind, query: o.query, mc: inst.mc, loader: inst.loader };
  return o.source === 'curseforge' ? cfSearch(args, cfg.cfKey) : mrSearch(args);
});

h('install', async (o) => {
  const cfg = await getCfg();
  const inst = (await getDb()).find((i) => i.id === o.id);
  if (!inst) throw new Error('Modpack nicht gefunden');
  const args = { kind: o.kind, projectId: o.projectId, mc: inst.mc, loader: inst.loader, dir: path.join(INST, o.id) };
  return o.source === 'curseforge' ? cfInstall({ ...args, key: cfg.cfKey }) : mrInstall(args);
});

h('install:base', async (id) => {
  const inst = (await getDb()).find((i) => i.id === id);
  if (!inst) throw new Error('Modpack nicht gefunden');
  const out = [];
  for (const slug of ['sodium', 'iris']) {
    out.push(...(await mrInstall({ kind: 'mods', projectId: slug, mc: inst.mc, loader: inst.loader, dir: path.join(INST, id) })));
  }
  return out;
});

// Account
h('account', async () => {
  const cfg = await getCfg();
  return session.ms ? { mode: 'microsoft', name: session.name } : { mode: 'offline', name: cfg.offlineName };
});
h('login:ms', async () => {
  const x = await new Auth('select_account').launch('electron');
  const mc = await x.getMinecraft();
  session.ms = mc.mclc();
  session.name = mc.profile.name;
  return { mode: 'microsoft', name: session.name };
});
h('logout', () => { session.ms = null; session.name = null; });

// Einstellungen
h('settings:get', async () => { const c = await getCfg(); return { cfKey: c.cfKey, java: c.java, offlineName: c.offlineName }; });
h('settings:set', async (v) => {
  const c = await getCfg();
  for (const k of ['cfKey', 'java', 'offlineName']) if (typeof v[k] === 'string') c[k] = v[k].trim();
  await saveCfg(c);
});

// Cosmetics
h('skin:list', async () => {
  const c = await getCfg();
  return Promise.all(c.skins.map(async (s) => ({
    ...s,
    active: c.activeSkin === s.id,
    data: 'data:image/png;base64,' + (await fsp.readFile(path.join(SKINS, s.id + '.png'))).toString('base64'),
  })));
});
h('skin:add', async ({ slim }) => {
  const r = await dialog.showOpenDialog(win, { filters: [{ name: 'Skin (PNG)', extensions: ['png'] }], properties: ['openFile'] });
  if (r.canceled) return false;
  const buf = await fsp.readFile(r.filePaths[0]);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('Das ist keine PNG-Datei.');
  const w = buf.readUInt32BE(16), ht = buf.readUInt32BE(20);
  if (w !== 64 || (ht !== 64 && ht !== 32)) throw new Error(`Ein Skin ist 64×64 Pixel groß (deine Datei: ${w}×${ht}).`);
  const c = await getCfg();
  const id = crypto.randomBytes(4).toString('hex');
  await fsp.writeFile(path.join(SKINS, id + '.png'), buf);
  c.skins.push({ id, name: path.basename(r.filePaths[0], '.png'), slim: !!slim });
  await saveCfg(c);
  return true;
});
h('skin:apply', async (id) => {
  const c = await getCfg();
  c.activeSkin = id || null;
  await saveCfg(c);
  const s = c.skins.find((x) => x.id === id);
  if (s && session.ms) {
    const fd = new FormData();
    fd.append('variant', s.slim ? 'slim' : 'classic');
    fd.append('file', new Blob([await fsp.readFile(path.join(SKINS, s.id + '.png'))], { type: 'image/png' }), 'skin.png');
    const r = await fetch('https://api.minecraftservices.com/minecraft/profile/skins', { method: 'POST', headers: mcHeaders(false), body: fd });
    if (!r.ok) throw new Error(`Skin-Upload zu Mojang fehlgeschlagen (${r.status})`);
    return { online: true };
  }
  return { online: false };
});
h('skin:remove', async (id) => {
  const c = await getCfg();
  c.skins = c.skins.filter((s) => s.id !== id);
  if (c.activeSkin === id) c.activeSkin = null;
  await saveCfg(c);
  await fsp.rm(path.join(SKINS, id + '.png'), { force: true });
});
h('capes', async () => {
  if (!session.ms) return { online: false, capes: [] };
  const p = await getJson('https://api.minecraftservices.com/minecraft/profile', { headers: mcHeaders(false) });
  return { online: true, capes: p.capes || [] };
});
h('cape:set', async (id) => {
  if (!session.ms) throw new Error('Melde dich zuerst mit Microsoft an.');
  const url = 'https://api.minecraftservices.com/minecraft/profile/capes/active';
  const r = id
    ? await fetch(url, { method: 'PUT', headers: mcHeaders(true), body: JSON.stringify({ capeId: id }) })
    : await fetch(url, { method: 'DELETE', headers: mcHeaders(false) });
  if (!r.ok) throw new Error(`Cape konnte nicht gesetzt werden (${r.status})`);
});

// Cosmetics (lokale Bibliothek)
const dirOf = (k) => (k === 'skin' ? SKINS : CAPES);
const listKey = (k) => (k === 'skin' ? 'skins' : 'capes');
const activeKey = (k) => (k === 'skin' ? 'activeSkin' : 'activeCape');
function pngCheck(buf, kind) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('Das ist keine PNG-Datei.');
  const w = buf.readUInt32BE(16), ht = buf.readUInt32BE(20);
  if (kind === 'skin' && !(w === 64 && (ht === 64 || ht === 32))) throw new Error(`Ein Skin ist 64×64 Pixel groß (deine Datei: ${w}×${ht}).`);
  if (kind === 'cape' && !(w % 64 === 0 && ht === w / 2)) throw new Error(`Eine Cape ist 64×32 Pixel groß (deine Datei: ${w}×${ht}).`);
}
async function addCosmetic(kind, buf, name, slim) {
  pngCheck(buf, kind);
  const c = await getCfg();
  const id = crypto.randomBytes(4).toString('hex');
  await fsp.writeFile(path.join(dirOf(kind), id + '.png'), buf);
  c[listKey(kind)] = [...(c[listKey(kind)] || []), { id, name: name || 'Ohne Namen', slim: !!slim }];
  await saveCfg(c);
}
h('cosmetic:list', async (kind) => {
  const c = await getCfg();
  return Promise.all((c[listKey(kind)] || []).map(async (s) => ({
    ...s, active: c[activeKey(kind)] === s.id,
    data: 'data:image/png;base64,' + (await fsp.readFile(path.join(dirOf(kind), s.id + '.png'))).toString('base64'),
  })));
});
h('cosmetic:add', async ({ kind, slim }) => {
  const r = await dialog.showOpenDialog(win, { filters: [{ name: 'PNG', extensions: ['png'] }], properties: ['openFile'] });
  if (r.canceled) return false;
  await addCosmetic(kind, await fsp.readFile(r.filePaths[0]), path.basename(r.filePaths[0], '.png'), slim);
  return true;
});
h('cosmetic:url', async ({ kind, url, slim }) => {
  if (!/^https:\/\//i.test(url || '')) throw new Error('Der Link muss mit https:// beginnen.');
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`Download fehlgeschlagen (${r.status})`);
  const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || '').replace(/\.png$/i, '');
  await addCosmetic(kind, Buffer.from(await r.arrayBuffer()), name || 'Download', slim);
});
h('cosmetic:export', async ({ kind, id }) => {
  const c = await getCfg();
  const it = (c[listKey(kind)] || []).find((x) => x.id === id);
  if (!it) throw new Error('Nicht gefunden');
  const r = await dialog.showSaveDialog(win, { defaultPath: (it.name || kind) + '.png', filters: [{ name: 'PNG', extensions: ['png'] }] });
  if (r.canceled) return false;
  await fsp.copyFile(path.join(dirOf(kind), id + '.png'), r.filePath);
  return true;
});
h('cosmetic:remove', async ({ kind, id }) => {
  const c = await getCfg();
  c[listKey(kind)] = (c[listKey(kind)] || []).filter((x) => x.id !== id);
  if (c[activeKey(kind)] === id) c[activeKey(kind)] = null;
  await saveCfg(c);
  await fsp.rm(path.join(dirOf(kind), id + '.png'), { force: true });
});
h('cosmetic:use', async ({ kind, id }) => {
  const c = await getCfg();
  c[activeKey(kind)] = id || null;
  await saveCfg(c);
});
h('skin:slim', async ({ id, slim }) => {
  const c = await getCfg();
  const s = c.skins.find((x) => x.id === id);
  if (s) s.slim = !!slim;
  await saveCfg(c);
});

async function prepareCosmetics(dir, cfg, inst) {
  const cape = (cfg.capes || []).find((x) => x.id === cfg.activeCape);
  await fsp.mkdir(path.join(dir, 'monhax'), { recursive: true });
  await writeJson(path.join(dir, 'monhax', 'cosmetics.json'), { cape: cape ? path.join(CAPES, cape.id + '.png') : null });
  const jar = app.isPackaged ? path.join(process.resourcesPath, 'monhax-cosmetics.jar') : path.join(__dirname, 'resources', 'monhax-cosmetics.jar');
  if (inst.loader === 'fabric' && inst.mc === '1.21.1' && fs.existsSync(jar)) {
    await fsp.copyFile(jar, path.join(dir, 'mods', 'monhax-cosmetics.jar'));
  }
}

h('news', async () => {
  const d = await getJson('https://launchercontent.mojang.com/v2/javaPatchNotes.json');
  return (d.entries || []).slice(0, 12).map((e) => ({
    title: e.title, type: e.type, version: e.version, date: e.date, text: e.shortText,
    image: e.image && e.image.url ? 'https://launchercontent.mojang.com' + e.image.url : null,
  }));
});

h('win', (a) => {
  if (a === 'min') win.minimize();
  else if (a === 'max') (win.isMaximized() ? win.unmaximize() : win.maximize());
  else win.close();
});

// Spiel starten
h('launch', async (id) => {
  if (running) throw new Error('Es läuft bereits ein Spiel.');
  const cfg = await getCfg();
  const inst = (await getDb()).find((i) => i.id === id);
  if (!inst) throw new Error('Modpack nicht gefunden');
  const dir = path.join(INST, id);
  if (!session.ms) await applySkinPack(dir, cfg);
  await prepareCosmetics(dir, cfg, inst);
  const auth = session.ms || Authenticator.getAuth(cfg.offlineName || 'Player');
  const l = new Client();
  l.on('debug', (m) => send('log', String(m)));
  l.on('data', (m) => send('log', String(m).trimEnd()));
  l.on('progress', (p) => send('progress', p));
  l.on('close', (code) => { running = false; send('closed', code); });
  running = true;
  try {
    const proc = await l.launch({
      authorization: auth,
      root: ROOT,
      javaPath: cfg.java || 'java',
      version: { number: inst.mc, type: 'release', ...(inst.customId ? { custom: inst.customId } : {}) },
      memory: { max: `${inst.ram}M`, min: '1024M' },
      overrides: { gameDirectory: dir },
    });
    if (!proc) throw new Error('Start fehlgeschlagen. Prüfe den Java-Pfad in den Einstellungen.');
  } catch (e) {
    running = false;
    throw e;
  }
  return true;
});

// ───────────── Fenster ─────────────
function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 760, minWidth: 960, minHeight: 620,
    backgroundColor: '#08060f', frame: false, autoHideMenuBar: true, title: 'MonHax Launcher',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
