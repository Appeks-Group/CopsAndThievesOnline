// Policías y ladrones: interfaz móvil. Sin frameworks; se sincroniza con la API cada 2 segundos.

const $app = document.getElementById('app');
const $who = document.getElementById('who');
const $sheet = document.getElementById('sheet');
const $backdrop = document.getElementById('sheetBackdrop');
const $toast = document.getElementById('toast');

const TEAM_COLORS = ['#2f6fd6', '#1b9e77', '#d95f02', '#7570b3', '#e7298a', '#66a61e', '#a6761d', '#1f78b4', '#b15928', '#6a3d9a', '#008b8b', '#555555'];
const THIEF_COLORS = ['#c0392b', '#8e44ad', '#d35400', '#16a085', '#2c3e50', '#c71585'];
const PHASE_TEXT = {
  colocar_patrullas: 'Colocación de patrullas',
  sortear_botines: 'Sorteo de botines',
  colocar_ladrones: 'Colocación de ladrones',
  turno_ladrones: 'Turno de los ladrones',
  turno_policias: 'Turno de los policías',
  terminado: 'Partida terminada',
};
const SPY_WARNING = 'Asegúrate que nadie más de tu equipo esté cerca.';

const params = new URLSearchParams(location.search);
const session = { gameId: params.get('g'), token: params.get('t') };
let state = null;
let pollTimer = null;
let ui = { selectedPatrol: null, selectedThief: null, arrestPatrol: null };
let privacy = false;

// ---------- utilidades ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const L = (id) => String.fromCharCode(96 + id); // patrulla 1 -> "a"
function toast(msg, ms = 2600) {
  $toast.textContent = msg;
  $toast.classList.remove('hidden');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $toast.classList.add('hidden'), ms);
}
async function api(path, opts = {}) {
  const res = await fetch(`/api/${path}`, { headers: { 'content-type': 'application/json' }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error de conexión.');
  return data;
}
const linkFor = (token) => `${location.origin}${location.pathname}?g=${state.id}&t=${token}`;
function rememberGame(label) {
  const list = JSON.parse(localStorage.getItem('pyl_games') || '[]').filter((x) => !(x.g === session.gameId && x.t === session.token));
  list.unshift({ g: session.gameId, t: session.token, label, at: Date.now() });
  localStorage.setItem('pyl_games', JSON.stringify(list.slice(0, 8)));
}
function adjacencyOf(map) {
  const adj = {};
  for (let i = 1; i <= map.size; i++) adj[i] = new Set();
  for (const [a, b] of map.edges) { adj[a].add(b); adj[b].add(a); }
  return adj;
}
const STEP = 60, PAD = 28;
const posOf = (map, id) => [PAD + ((id - 1) % map.cols) * STEP, PAD + Math.floor((id - 1) / map.cols) * STEP];
const myTeam = () => state.teams.find((t) => t.id === state.me.teamId);

// ---------- inicio ----------

function renderHome() {
  $who.textContent = '';
  const recent = JSON.parse(localStorage.getItem('pyl_games') || '[]');
  $app.innerHTML = `
    <h1>Policías y ladrones</h1>
    <div class="card">
      <h2>Unirme a una partida</h2>
      <p class="muted">Escanea el código QR que te muestra el jefe o pega aquí tu enlace.</p>
      <div class="row"><input id="joinLink" placeholder="Pega tu enlace" /><button id="joinBtn">Entrar</button></div>
    </div>
    ${recent.length ? `<div class="card"><h2>Partidas recientes en este teléfono</h2><ul class="list">${recent.map((r) =>
      `<li><span>${esc(r.label)} <span class="muted">· ${esc(r.g)}</span></span><a class="btn secondary" href="?g=${esc(r.g)}&t=${esc(r.t)}">Abrir</a></li>`).join('')}</ul></div>` : ''}
    <div class="card">
      <h2>Crear partida (jefe)</h2>
      <div class="grid2">
        <div><label>Equipos de policías</label><input id="cTeams" type="number" min="1" max="12" value="6"></div>
        <div><label>Patrullas por equipo</label><input id="cPatrols" type="number" min="1" max="4" value="2"></div>
        <div><label>Columnas del mapa</label><input id="cCols" type="number" min="4" max="16" value="10"></div>
        <div><label>Filas del mapa</label><input id="cRows" type="number" min="4" max="16" value="8"></div>
        <div><label>Atajos diagonales</label><input id="cDiag" type="number" min="0" max="200" value="22"></div>
        <div><label>Botines en el mapa</label><input id="cLoot" type="number" min="1" max="40" value="12"></div>
        <div><label>Botines para que ganen los ladrones</label><input id="cLootWin" type="number" min="1" max="40" value="5"></div>
        <div><label>Turnos máximos</label><input id="cTurns" type="number" min="1" max="99" value="15"></div>
      </div>
      <h2 style="margin-top:14px">Nombres de los equipos</h2>
      <div id="teamNames" class="grid2"></div>
      <h2 style="margin-top:14px">Ladrones en el tablero</h2>
      <p class="muted">Sus nombres se anuncian a todos. Los controla un solo teléfono: el del equipo de ladrones.</p>
      <div id="thiefRows"></div>
      <button class="secondary" id="addThief">Agregar ladrón</button>
      <h2 style="margin-top:14px">Ladrón oculto</h2>
      <p class="muted">No tiene ficha ni pantalla: juega dentro de su equipo de policías. Solo el jefe lo ve aquí.</p>
      <div class="grid2">
        <div><label>Nombre (vacío = sin ladrón oculto)</label><input id="hName" placeholder="Nombre"></div>
        <div><label>Equipo donde juega</label><select id="hTeam"></select></div>
      </div>
      <p></p>
      <button class="block" id="createBtn">Crear partida</button>
    </div>`;

  const teamsInput = document.getElementById('cTeams');
  const namesBox = document.getElementById('teamNames');
  const thieves = [{ name: 'Ladrón 1', team: 1 }, { name: 'Ladrón 2', team: 2 }];
  const teamOptions = (n, sel) => Array.from({ length: n }, (_, k) => `<option value="${k + 1}" ${sel === k + 1 ? 'selected' : ''}>Equipo ${k + 1}</option>`).join('');
  const drawThieves = () => {
    const n = Math.max(1, Math.min(12, Number(teamsInput.value) || 1));
    const box = document.getElementById('thiefRows');
    box.innerHTML = thieves.map((t, i) => `
      <div class="thiefrow">
        <div><label>Nombre</label><input data-k="name" data-i="${i}" value="${esc(t.name)}"></div>
        <div><label>Salió del</label><select data-k="team" data-i="${i}">${teamOptions(n, t.team)}</select></div>
        <button class="secondary" data-del="${i}" title="Quitar">×</button>
      </div>`).join('');
    box.querySelectorAll('[data-k]').forEach((el) => el.addEventListener('change', () => {
      thieves[el.dataset.i][el.dataset.k] = el.dataset.k === 'team' ? Number(el.value) : el.value;
    }));
    box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      if (thieves.length > 1) { thieves.splice(Number(b.dataset.del), 1); drawThieves(); }
    }));
    const h = document.getElementById('hTeam');
    const prev = Number(h.value) || 3;
    h.innerHTML = teamOptions(n, Math.min(prev, n));
  };
  const drawNames = () => {
    const n = Math.max(1, Math.min(12, Number(teamsInput.value) || 1));
    const prev = [...namesBox.querySelectorAll('input')].map((i) => i.value);
    namesBox.innerHTML = Array.from({ length: n }, (_, i) =>
      `<div><label><span class="swatch" style="background:${TEAM_COLORS[i]}"></span>Equipo ${i + 1}</label><input data-i="${i}" value="${esc(prev[i] || `Equipo ${i + 1}`)}"></div>`).join('');
    drawThieves();
  };
  teamsInput.addEventListener('input', drawNames);
  drawNames();
  document.getElementById('addThief').onclick = () => {
    if (thieves.length >= 6) return toast('Máximo 6 ladrones.');
    thieves.push({ name: `Ladrón ${thieves.length + 1}`, team: 1 });
    drawThieves();
  };
  document.getElementById('joinBtn').onclick = () => {
    const v = document.getElementById('joinLink').value.trim();
    try { location.search = new URL(v).search; } catch { toast('Pega el enlace completo que te compartió el jefe.'); }
  };
  document.getElementById('createBtn').onclick = async (e) => {
    e.target.disabled = true;
    const num = (id) => Number(document.getElementById(id).value);
    const hName = document.getElementById('hName').value.trim();
    const cfg = {
      teams: num('cTeams'), patrolsPerTeam: num('cPatrols'), cols: num('cCols'), rows: num('cRows'),
      diagonals: num('cDiag'), loot: num('cLoot'), lootToWin: num('cLootWin'), maxTurns: num('cTurns'),
      teamNames: [...namesBox.querySelectorAll('input')].map((i) => i.value.trim()),
      thieves,
      hiddenThief: hName ? { name: hName, team: num('hTeam') } : null,
    };
    try {
      const r = await api('games', { method: 'POST', body: JSON.stringify(cfg) });
      location.search = `?g=${r.gameId}&t=${r.hostToken}`;
    } catch (err) { toast(err.message); e.target.disabled = false; }
  };
}

// ---------- sincronización ----------

async function load(force = false) {
  try {
    const q = new URLSearchParams({ token: session.token });
    if (state && !force) q.set('since', state.version);
    const data = await api(`games/${session.gameId}/state?${q}`);
    if (data.unchanged) return;
    setState(data);
  } catch (err) {
    if (!state) $app.innerHTML = `<div class="banner danger"><strong>No pude abrir la partida</strong>${esc(err.message)}</div><a class="btn" href="./">Volver al inicio</a>`;
  }
}
function setState(data) {
  const prev = state;
  state = data;
  if (prev && prev.log.length && state.log.length > prev.log.length) {
    const last = state.log[state.log.length - 1];
    if (['robo', 'arresto', 'fin'].includes(last.kind)) toast(last.text, 4000);
  }
  // si la ficha seleccionada ya no puede actuar, se limpia la selección
  if (state.me.role === 'team' && !(state.me.moveOptions || {})[ui.selectedPatrol]) ui.selectedPatrol = null;
  if (state.me.role !== 'team' || state.phase !== 'turno_policias' || state.me.step !== 'accion' || !myTeam().patrols.some((p) => p.id === ui.arrestPatrol) || (state.me.actedThisTurn || []).includes(ui.arrestPatrol)) ui.arrestPatrol = null;
  if (state.me.role === 'thieves') {
    const active = state.thieves.filter((t) => !t.captured && (state.phase === 'colocar_ladrones' ? !t.placed : ['mover', 'accion'].includes(t.step)));
    if (!active.some((t) => t.id === ui.selectedThief)) ui.selectedThief = active[0]?.id ?? null;
  }
  // Si este teléfono no ve el modal de un resultado, no re-renderiza encima
  if (!$sheet.dataset.locked) render();
}
async function act(action) {
  try {
    const data = await api(`games/${session.gameId}/action`, { method: 'POST', body: JSON.stringify({ token: session.token, ...action }) });
    const { result, ...view } = data;
    if (!$sheet.dataset.locked) closeSheet();
    setState(view);
    return result || true;
  } catch (err) { toast(err.message); return false; }
}
function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (!document.hidden) load(); }, 2000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(true); });
}

// ---------- render principal ----------

function render() {
  const me = state.me;
  if (me.role === 'host') $who.textContent = 'Jefe de juego';
  else if (me.role === 'team') $who.innerHTML = `<span class="swatch" style="background:${TEAM_COLORS[me.teamId - 1]}"></span>${esc(me.name)}`;
  else $who.textContent = 'Equipo de ladrones';
  rememberGame(me.role === 'host' ? 'Jefe' : me.role === 'team' ? me.name : 'Equipo de ladrones');

  const free = state.thieves.filter((t) => !t.captured).length;
  let html = `
    ${bannerHtml()}
    <div class="stats">
      <div class="stat"><b>${state.turn}/${state.config.maxTurns}</b><span>Turno</span></div>
      <div class="stat"><b>${state.stolenCount}/${state.config.lootToWin}</b><span>Botines robados</span></div>
      <div class="stat"><b>${free}/${state.thieves.length}</b><span>Ladrones libres</span></div>
    </div>
    ${me.role === 'team' ? teamControls() : ''}
    ${me.role === 'thieves' ? thievesControls() : ''}
    <div class="mapwrap" id="mapwrap">${mapSvg()}${privacy ? `<div class="privacy" id="privacy"><div><strong>Pantalla oculta</strong><p>Toca para mostrar el mapa.</p></div></div>` : ''}</div>`;

  if (me.role === 'team') html += teamHistory();
  if (me.role === 'host') html += hostPanel();

  html += `<div class="card"><h2>Marcador de fichas</h2>${state.scoresSecret ? '<p class="muted">Las fichas por botines robados se suman al final, para no delatar de qué equipo salió cada ladrón.</p>' : ''}<ul class="list">${[...state.teams].sort((a, b) => b.points - a.points).map((t) =>
    `<li><span><span class="swatch" style="background:${TEAM_COLORS[t.id - 1]}"></span>${esc(t.name)}</span><b>${t.points}</b></li>`).join('')}</ul></div>`;
  html += `<div class="card"><h2>Bitácora</h2><div class="log">${[...state.log].reverse().map((l) => `<div>${l.turn ? `<span class="muted">T${l.turn} · </span>` : ''}${esc(l.text)}</div>`).join('')}</div></div>`;
  html += `<p class="muted small">Partida ${esc(state.id)} · se actualiza sola cada 2 segundos.</p>`;
  $app.innerHTML = html;

  $app.querySelectorAll('.cell').forEach((g) => g.addEventListener('click', () => onCell(Number(g.dataset.id))));
  document.getElementById('privacy')?.addEventListener('click', () => { privacy = false; render(); });
  bindPanels();
}

function bannerHtml() {
  const me = state.me, p = state.phase;
  const b = (cls, title, text) => `<div class="banner ${cls}"><strong>${title}</strong>${text || ''}</div>`;
  if (p === 'terminado') {
    const hidden = state.hiddenThief ? ` El ladrón oculto era ${esc(state.hiddenThief.name)}.` : '';
    return b(state.winner === 'policias' ? 'ok' : 'danger', state.winner === 'policias' ? 'Ganan los policías' : state.winner === 'ladrones' ? 'Ganan los ladrones' : 'Partida terminada', esc(state.log[state.log.length - 1]?.text) + hidden);
  }
  if (me.role === 'host') {
    const pending = p === 'colocar_patrullas' ? state.teams.filter((t) => t.patrols.length < state.config.patrolsPerTeam).length
      : p === 'colocar_ladrones' ? state.thieves.filter((t) => !t.placed).length
      : p === 'turno_ladrones' ? state.thieves.filter((t) => !t.captured && t.step !== 'listo').length
      : p === 'turno_policias' ? state.teams.filter((t) => t.step !== 'listo').length : 0;
    return b('', PHASE_TEXT[p], p === 'sortear_botines' ? 'Todas las patrullas están colocadas. Sortea los botines.' : `Faltan ${pending} por terminar.`);
  }
  if (me.role === 'team') {
    const team = myTeam();
    if (p === 'colocar_patrullas') {
      const n = team.patrols.length, max = state.config.patrolsPerTeam;
      return n < max ? b('warn', 'Coloca tus patrullas', `Toca cualquier casilla libre. Te faltan ${max - n}.`) : b('', 'Patrullas listas', 'Esperando a los demás equipos. Puedes tocar una patrulla tuya para quitarla.');
    }
    if (p === 'sortear_botines') return b('', 'El jefe está sorteando los botines', '');
    if (p === 'colocar_ladrones') return b('', 'Los ladrones eligen dónde empiezan', 'Sus casillas iniciales son secretas. Luego ustedes abren el primer turno.');
    if (p === 'turno_ladrones') return b('', 'Juegan los ladrones', 'Prepárate para tu turno.');
    if (p === 'turno_policias') {
      if (me.step === 'mover') return b('warn', 'Paso 1 de 2: mover', 'Toca una patrulla y luego una casilla contigua marcada. Cada patrulla se mueve una vez.');
      if (me.step === 'accion') return b('warn', 'Paso 2 de 2: acción', 'Elige Espiar o Arrestar para cada una de tus patrullas.');
      return b('ok', 'Turno terminado', 'Esperando a los demás equipos.');
    }
  }
  if (me.role === 'thieves') {
    if (p === 'colocar_patrullas' || p === 'sortear_botines') return b('', 'Espera', 'Los policías se están colocando y luego se sortean los botines.');
    if (p === 'colocar_ladrones') return b('warn', 'Elige dónde empieza cada ladrón', 'Las casillas marcadas son válidas. Los policías no verán dónde empiezan. Después juegan primero los policías.');
    if (p === 'turno_ladrones') return b('warn', 'Su turno', 'Por cada ladrón: primero mover, luego tomar botín o pasar.');
    if (p === 'turno_policias') return b('', 'Turno de los policías', 'Esperen a que terminen.');
  }
  return b('', PHASE_TEXT[p], '');
}

// ---------- mapa ----------

function mapSvg() {
  const map = state.map, me = state.me;
  const W = PAD * 2 + (map.cols - 1) * STEP, H = PAD * 2 + (map.rows - 1) * STEP;
  const patrolAt = new Map();
  for (const t of state.teams) for (const p of t.patrols) patrolAt.set(p.cell, { team: t.id, id: p.id });
  const lootAt = new Map(state.loot.map((l) => [l.cell, l]));
  const targets = new Set();

  if (me.role === 'team') {
    const team = myTeam();
    if (state.phase === 'colocar_patrullas' && team.patrols.length < state.config.patrolsPerTeam) {
      for (let c = 1; c <= map.size; c++) if (!patrolAt.has(c)) targets.add(c);
    }
    if (state.phase === 'turno_policias' && me.step === 'mover' && ui.selectedPatrol) (me.moveOptions[ui.selectedPatrol] || []).forEach((c) => targets.add(c));
    if (state.phase === 'turno_policias' && me.step === 'accion' && ui.arrestPatrol) arrestCells(ui.arrestPatrol).forEach((c) => targets.add(c));
  }
  if (me.role === 'thieves') {
    if (state.phase === 'colocar_ladrones' && ui.selectedThief) me.startOptions.forEach((c) => targets.add(c));
    if (state.phase === 'turno_ladrones' && ui.selectedThief) (me.moveOptions[ui.selectedThief] || []).forEach((c) => targets.add(c));
  }

  const parts = [`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Mapa del juego">`];
  for (const [a, b] of map.edges) {
    const [x1, y1] = posOf(map, a), [x2, y2] = posOf(map, b);
    parts.push(`<line class="edge" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
  }
  const seesThieves = me.role === 'thieves' || me.role === 'host' || state.phase === 'terminado';
  if (seesThieves) state.thieves.forEach((t, i) => (t.trail || []).forEach((c) => {
    const [x, y] = posOf(map, c);
    parts.push(`<circle cx="${x}" cy="${y}" r="${21 + i * 2}" fill="none" stroke="${THIEF_COLORS[i % 6]}" stroke-width="2" stroke-dasharray="3 3" opacity=".7"/>`);
  }));
  for (let c = 1; c <= map.size; c++) {
    const [x, y] = posOf(map, c);
    parts.push(`<g class="cell ${targets.has(c) ? 'target' : ''}" data-id="${c}"><circle class="base" cx="${x}" cy="${y}" r="17"/>`);
    const loot = lootAt.get(c);
    if (loot && !loot.stolen) parts.push(`<circle cx="${x}" cy="${y}" r="17" fill="#f2b33d" stroke="#8a5a00"/>`);
    if (loot && loot.stolen) parts.push(`<circle cx="${x}" cy="${y}" r="17" fill="#e4e1d8" stroke="#8a887f" stroke-dasharray="3 2"/>`);
    parts.push(`<text x="${x}" y="${y + 4}" text-anchor="middle">${c}</text></g>`);
  }
  for (const [cell, p] of patrolAt) {
    const [x, y] = posOf(map, cell);
    const mine = me.role === 'team' && p.team === me.teamId;
    const selected = mine && ui.selectedPatrol === p.id;
    const done = mine && me.movedThisTurn?.includes(p.id) && state.phase === 'turno_policias';
    parts.push(`<g pointer-events="none"><rect x="${x - 13}" y="${y - 13}" width="26" height="26" rx="6" fill="${TEAM_COLORS[p.team - 1]}" stroke="${selected ? '#000' : '#fff'}" stroke-width="${selected ? 3 : 1.5}" opacity="${done ? 0.75 : 1}"/><text x="${x}" y="${y + 4}" text-anchor="middle" style="fill:#fff;font-size:11px;font-weight:600">${p.team}${state.config.patrolsPerTeam > 1 ? L(p.id) : ''}</text></g>`);
  }
  if (seesThieves) state.thieves.forEach((t, i) => {
    if (!t.cell) return;
    const [x, y] = posOf(map, t.cell);
    const sel = me.role === 'thieves' && ui.selectedThief === t.id;
    parts.push(`<g pointer-events="none" opacity="${t.captured ? 0.35 : 1}"><circle cx="${x}" cy="${y}" r="12" fill="${THIEF_COLORS[i % 6]}" stroke="${sel ? '#000' : '#fff'}" stroke-width="${sel ? 3 : 2}"/><text x="${x}" y="${y + 3.5}" text-anchor="middle" style="fill:#fff;font-size:9px;font-weight:600">L${t.id}</text></g>`);
  });
  parts.push('</svg>');
  return parts.join('');
}

// ---------- toque en una casilla ----------

// casillas donde una patrulla puede arrestar: la suya y las conectadas
function arrestCells(patrolId) {
  const pt = myTeam().patrols.find((p) => p.id === patrolId);
  return pt ? [pt.cell, ...adjacencyOf(state.map)[pt.cell]] : [];
}

function onCell(cell) {
  if (state.me.role === 'team' && state.me.step === 'accion' && ui.arrestPatrol && arrestCells(ui.arrestPatrol).includes(cell)) return arrestFlow(ui.arrestPatrol, cell);
  const options = [];
  if (state.me.role === 'team') teamOptions(cell, options);
  if (state.me.role === 'thieves') thievesOptions(cell, options);
  openSheet(`Casilla ${cell}`, cellInfo(cell), options);
}

function cellInfo(cell) {
  const lines = [];
  const loot = state.loot.find((l) => l.cell === cell);
  if (loot) lines.push(loot.stolen ? `Botín robado en el turno ${loot.stolenTurn}.` : 'Aquí hay un botín.');
  for (const t of state.teams) for (const p of t.patrols) if (p.cell === cell) lines.push(`Patrulla ${L(p.id)} de ${esc(t.name)}.`);
  state.thieves.forEach((t) => {
    if (t.start === cell) lines.push(`Aquí empezó ${esc(t.name)}.`);
    if (t.cell === cell) lines.push(`Aquí está ${esc(t.name)}${t.captured ? ' (capturado)' : ''}.`);
    else if ((t.trail || []).includes(cell)) lines.push(`${esc(t.name)} pasó por aquí: si una patrulla espía esta casilla, lo sabrá.`);
  });
  if (state.me.role === 'team') {
    const spies = state.me.spyLog.filter((s) => s.cell === cell);
    if (spies.length) lines.push(`Tu equipo espió aquí en el turno ${spies.map((s) => s.turn).join(', ')} (el resultado solo lo vio quien espió).`);
  }
  return lines.join('<br>') || '<span class="muted">Casilla vacía.</span>';
}

function teamOptions(cell, options) {
  const me = state.me, team = myTeam(), p = state.phase;
  const adj = adjacencyOf(state.map);
  if (p === 'colocar_patrullas') {
    if (team.patrols.some((x) => x.cell === cell)) options.push({ label: 'Quitar esta patrulla', cls: 'secondary', run: () => act({ type: 'remove_patrol', cell }) });
    else if (team.patrols.length < state.config.patrolsPerTeam && !state.teams.some((t) => t.patrols.some((x) => x.cell === cell)))
      options.push({ label: 'Colocar patrulla aquí', run: () => act({ type: 'place_patrol', cell }) });
    return;
  }
  if (p !== 'turno_policias') return;
  const own = team.patrols.find((x) => x.cell === cell);
  if (me.step === 'mover') {
    if (own && me.moveOptions[own.id]) {
      if (ui.selectedPatrol !== own.id) options.push({ label: `Seleccionar patrulla ${L(own.id)} para moverla`, run: () => { ui.selectedPatrol = own.id; closeSheet(); render(); } });
    } else if (own) options.push({ label: `La patrulla ${L(own.id)} ya se movió`, cls: 'secondary', run: closeSheet });
    const sel = ui.selectedPatrol;
    if (sel && (me.moveOptions[sel] || []).includes(cell)) {
      options.push({ label: `Mover la patrulla ${L(sel)} aquí`, run: async () => { ui.selectedPatrol = null; await act({ type: 'move_patrol', patrol: sel, cell }); } });
    }
    options.push({ label: 'Terminar de mover y pasar a la acción', cls: 'secondary', run: () => act({ type: 'end_move' }) });
    return;
  }
  if (me.step === 'accion') {
    const acted = me.actedThisTurn || [];
    if (own && !acted.includes(own.id)) options.push({ label: `Espiar aquí con la patrulla ${L(own.id)}`, run: () => spyFlow(own.id) });
    for (const pt of team.patrols.filter((x) => !acted.includes(x.id))) {
      if (pt.cell === cell || adj[pt.cell].has(cell)) options.push({ label: `Arrestar aquí con la patrulla ${L(pt.id)}`, cls: 'danger', run: () => arrestFlow(pt.id, cell) });
    }
  }
}

function spyFlow(patrol) {
  // Primero la alerta de privacidad; el resultado se pide y se muestra una sola vez.
  openSheet('Antes de espiar', `<div class="banner warn"><strong>${SPY_WARNING}</strong>Solo una persona de tu equipo puede ver si pasó un ladrón por esta casilla. El resultado no se guarda en la pantalla.</div>`, [
    { label: 'Estoy solo, espiar', run: async () => {
      $sheet.dataset.locked = '1';
      const r = await act({ type: 'spy', patrol });
      if (!r || !r.spy) { delete $sheet.dataset.locked; closeSheet(); return; }
      openSheet(`Casilla ${r.spy.cell}`, r.spy.result
        ? '<div class="banner danger"><strong>Sí, un ladrón pasó por aquí.</strong>No se sabe cuándo ni cuál.</div>'
        : '<div class="banner ok"><strong>No, ningún ladrón ha pasado por aquí.</strong></div>', [
        { label: 'Ocultar resultado', run: () => { delete $sheet.dataset.locked; closeSheet(); render(); } },
      ], { noClose: true });
    } },
  ]);
}

async function arrestFlow(patrol, cell) {
  if (!confirm(`¿Arrestar en la casilla ${cell}? Es tu acción del turno.`)) return;
  const r = await act({ type: 'arrest', patrol, cell });
  if (r && r.arrest) ui.arrestPatrol = null;
  if (r && r.arrest) toast(r.arrest.caught.length ? `¡Capturaste a ${r.arrest.caught.join(', ')}!` : 'No había nadie en esa casilla.', 4000);
}

function thievesOptions(cell, options) {
  const me = state.me, p = state.phase;
  const here = state.thieves.find((t) => t.cell === cell && !t.captured);
  if (here && here.id !== ui.selectedThief && (p === 'turno_ladrones' ? ['mover', 'accion'].includes(here.step) : false)) {
    options.push({ label: `Seleccionar a ${here.name}`, cls: 'secondary', run: () => { ui.selectedThief = here.id; closeSheet(); render(); } });
  }
  const sel = state.thieves.find((t) => t.id === ui.selectedThief);
  if (!sel) return;
  if (p === 'colocar_ladrones' && me.startOptions.includes(cell)) options.push({ label: `${sel.name} empieza aquí`, run: () => act({ type: 'place_start', thief: sel.id, cell }) });
  if (p === 'turno_ladrones' && sel.step === 'mover') {
    const opts = me.moveOptions[sel.id] || [];
    if (opts.includes(cell)) options.push({ label: `Mover a ${sel.name} aquí`, run: () => act({ type: 'move', thief: sel.id, cell }) });
    if (!opts.length && cell === sel.cell) options.push({ label: `${sel.name} se queda (está rodeado)`, run: () => act({ type: 'move', thief: sel.id, cell }) });
  }
}

// ---------- controles por rol ----------

function teamControls() {
  const me = state.me, team = myTeam();
  if (state.phase !== 'turno_policias' || me.step === 'listo') return '';
  if (me.step === 'mover') {
    return `<div class="card"><h2>Paso 1: mover</h2><div class="row">${team.patrols.map((p) => {
      const moved = me.movedThisTurn.includes(p.id);
      return `<button class="${ui.selectedPatrol === p.id ? '' : 'secondary'}" data-patrol="${p.id}" ${moved ? 'disabled' : ''}>Patrulla ${L(p.id)} · ${p.cell}${moved ? ' (movida)' : ''}</button>`;
    }).join('')}</div><p class="muted">Selecciona una patrulla y toca una casilla marcada. No es obligatorio mover todas.</p>
      <button class="secondary block" id="endMove">Terminar de mover</button></div>`;
  }
  const acted = me.actedThisTurn || [];
  const arresting = team.patrols.find((p) => p.id === ui.arrestPatrol);
  return `<div class="card"><h2>Paso 2: acción</h2><p>Cada patrulla hace <b>una</b> acción: espiar su casilla o arrestar en su casilla o en una conectada.</p>
    <ul class="list">${team.patrols.map((p) => {
      const done = acted.includes(p.id);
      const val = ui.arrestPatrol === p.id ? 'arrest' : '';
      return `<li><label for="act-${p.id}">Patrulla ${L(p.id)} · casilla ${p.cell}</label>${done
        ? '<span class="pill ok">acción hecha</span>'
        : `<select id="act-${p.id}" data-act="${p.id}">
            <option value="" ${val ? '' : 'selected'}>Elegir acción…</option>
            <option value="spy">Espiar</option>
            <option value="arrest" ${val === 'arrest' ? 'selected' : ''}>Arrestar</option>
          </select>`}</li>`;
    }).join('')}</ul>
    ${arresting ? `<p class="muted">Toca en el mapa una casilla marcada para arrestar con la patrulla ${L(arresting.id)}.</p>` : ''}</div>`;
}

function teamHistory() {
  const me = state.me;
  const items = [
    ...me.spyLog.map((s) => ({ turn: s.turn, html: `<span>T${s.turn} · espiaron la casilla ${s.cell}</span><span class="pill">resultado privado</span>` })),
    ...me.arrests.map((a) => ({ turn: a.turn, html: `<span>T${a.turn} · arresto en ${a.cell}</span><span class="pill ${a.caught.length ? 'ok' : 'bad'}">${a.caught.length ? '¡capturado!' : 'falló'}</span>` })),
  ].sort((a, b) => b.turn - a.turn);
  return `<div class="card"><h2>Acciones de tu equipo</h2>${items.length ? `<ul class="list">${items.map((i) => `<li>${i.html}</li>`).join('')}</ul>` : '<p class="muted">Aún nada.</p>'}</div>`;
}

function thievesControls() {
  const p = state.phase;
  if (!['colocar_ladrones', 'turno_ladrones'].includes(p)) {
    return `<div class="card"><h2>Tus ladrones</h2><ul class="list">${state.thieves.map((t, i) => `<li><span><span class="swatch" style="background:${THIEF_COLORS[i % 6]}"></span>${esc(t.name)}${t.cell ? ` · casilla ${t.cell}` : ''}</span><span class="pill ${t.captured ? 'bad' : ''}">${t.captured ? 'capturado' : `${t.loot || 0} botines`}</span></li>`).join('')}</ul>
      <button class="secondary block" id="hideScreen">Ocultar pantalla</button></div>`;
  }
  const rows = state.thieves.map((t, i) => {
    let status, btns = '';
    if (t.captured) status = '<span class="pill bad">capturado</span>';
    else if (p === 'colocar_ladrones') status = t.placed ? `<span class="pill ok">empieza en ${t.cell}</span>` : '<span class="pill wait">sin colocar</span>';
    else if (t.step === 'mover') status = '<span class="pill wait">1. mover</span>';
    else if (t.step === 'accion') {
      status = '<span class="pill wait">2. botín o pasar</span>';
      const onLoot = state.loot.some((l) => l.cell === t.cell && !l.stolen);
      btns = `<div class="row" style="margin-top:6px">${onLoot ? `<button data-take="${t.id}">Tomar botín</button>` : ''}<button class="secondary" data-pass="${t.id}">Pasar</button></div>`;
    } else status = '<span class="pill ok">listo</span>';
    const selectable = !t.captured && (p === 'colocar_ladrones' ? !t.placed : t.step === 'mover');
    return `<li style="display:block"><div class="row" style="justify-content:space-between">
      <span><span class="swatch" style="background:${THIEF_COLORS[i % 6]}"></span>${esc(t.name)}${t.cell ? ` · casilla ${t.cell}` : ''}</span>${status}</div>
      ${selectable ? `<button class="${ui.selectedThief === t.id ? '' : 'secondary'}" data-thief="${t.id}" style="margin-top:6px">${ui.selectedThief === t.id ? 'Seleccionado: toca una casilla marcada' : 'Seleccionar'}</button>` : ''}${btns}</li>`;
  }).join('');
  return `<div class="card"><h2>Tus ladrones</h2><ul class="list">${rows}</ul><p class="muted">Tomar un botín se anuncia a todos (sin decir quién). Puedes pasar para no delatar dónde estás.</p></div>`;
}

function hostPanel() {
  const p = state.phase;
  const teamName = (id) => state.teams.find((t) => t.id === id)?.name || `Equipo ${id}`;
  let html = '<div class="card"><h2>Controles del jefe</h2><div class="row">';
  if (p === 'sortear_botines') html += '<button id="drawLoot">Sortear botines</button>';
  if (p === 'turno_ladrones' || p === 'turno_policias') html += '<button class="secondary" id="forceTurn">Cerrar turno ahora</button>';
  if (p !== 'terminado') html += '<button class="danger" id="endGame">Terminar partida</button>';
  html += '<button class="secondary" id="hideScreen">Ocultar pantalla</button></div>';
  html += `<p class="muted">Tu pantalla muestra a todos los ladrones${state.hiddenThief ? ` y al ladrón oculto (<b>${esc(state.hiddenThief.name)}</b>, en ${esc(teamName(state.hiddenThief.team))})` : ''}. No la enseñes.</p></div>`;

  const stepPill = (s) => s === 'listo' ? '<span class="pill ok">listo</span>' : s === 'mover' ? '<span class="pill wait">moviendo</span>' : s === 'accion' ? '<span class="pill wait">acción</span>' : '<span class="pill">—</span>';
  html += `<div class="card"><h2>Quién falta</h2><ul class="list">
    ${state.teams.map((t) => `<li><span><span class="swatch" style="background:${TEAM_COLORS[t.id - 1]}"></span>${esc(t.name)}</span>${p === 'colocar_patrullas' ? `<span class="pill ${t.patrols.length >= state.config.patrolsPerTeam ? 'ok' : 'wait'}">${t.patrols.length}/${state.config.patrolsPerTeam}</span>` : stepPill(t.step)}</li>`).join('')}
    ${state.thieves.map((t) => `<li><span>${esc(t.name)} <span class="muted">· salió de ${esc(teamName(t.team))}${t.cell ? ` · casilla ${t.cell}` : ''}</span></span>${t.captured ? '<span class="pill bad">capturado</span>' : p === 'colocar_ladrones' ? `<span class="pill ${t.placed ? 'ok' : 'wait'}">${t.placed ? 'listo' : 'eligiendo'}</span>` : stepPill(t.step)}</li>`).join('')}
  </ul></div>`;

  const spies = (state.spyLogs || []).flatMap((s) => s.log.map((x) => ({ ...x, team: s.team }))).sort((a, b) => b.turn - a.turn);
  if (spies.length) html += `<div class="card"><h2>Espionajes (solo jefe)</h2><ul class="list">${spies.map((s) => `<li><span>T${s.turn} · ${esc(teamName(s.team))} · casilla ${s.cell}</span><span class="pill ${s.result ? 'ok' : ''}">${s.result ? 'sí' : 'no'}</span></li>`).join('')}</ul></div>`;

  const j = state.joins;
  html += `<div class="card joins"><h2>Enlaces para unirse</h2><p class="muted">Un teléfono por equipo de policías y uno para el equipo de ladrones (compártelo en privado).</p>
    ${j.teams.map((t) => joinBlock(`Equipo: ${t.name}`, t.token)).join('')}
    ${joinBlock('Equipo de ladrones', j.thieves)}
    ${joinBlock('Jefe (otro teléfono de jefe)', j.host)}
  </div>`;
  return html;
}

function joinBlock(label, token) {
  const url = linkFor(token);
  const wa = `https://wa.me/?text=${encodeURIComponent(`${label} – Policías y ladrones: ${url}`)}`;
  return `<div class="join"><b>${esc(label)}</b><div class="row" style="margin-top:6px">
    <button class="secondary" data-copy="${esc(url)}">Copiar enlace</button>
    <a class="btn secondary" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>
    <button class="secondary" data-qr="${esc(url)}">Ver QR</button></div><div class="qr hidden"></div></div>`;
}

function bindPanels() {
  const on = (id, fn) => document.getElementById(id)?.addEventListener('click', fn);
  on('endMove', () => act({ type: 'end_move' }));
  on('drawLoot', () => act({ type: 'draw_loot' }));
  on('forceTurn', () => { if (confirm('¿Cerrar el turno? Quien no haya terminado pierde su jugada.')) act({ type: 'force_resolve' }); });
  on('endGame', () => { if (confirm('¿Terminar la partida ahora?')) act({ type: 'end_game' }); });
  on('hideScreen', () => { privacy = true; render(); window.scrollTo(0, 0); });
  $app.querySelectorAll('[data-patrol]').forEach((b) => b.addEventListener('click', () => { ui.selectedPatrol = Number(b.dataset.patrol); render(); }));
  $app.querySelectorAll('[data-act]').forEach((sel) => sel.addEventListener('change', () => {
    const id = Number(sel.dataset.act);
    ui.arrestPatrol = sel.value === 'arrest' ? id : null;
    if (sel.value === 'spy') spyFlow(id);
    render();
  }));
  $app.querySelectorAll('[data-thief]').forEach((b) => b.addEventListener('click', () => { ui.selectedThief = Number(b.dataset.thief); render(); }));
  $app.querySelectorAll('[data-take]').forEach((b) => b.addEventListener('click', () => {
    if (confirm('Al tomar el botín se anuncia a todos qué casilla fue robada. ¿Tomarlo?')) act({ type: 'take_loot', thief: Number(b.dataset.take) });
  }));
  $app.querySelectorAll('[data-pass]').forEach((b) => b.addEventListener('click', () => act({ type: 'pass', thief: Number(b.dataset.pass) })));
  $app.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast('Enlace copiado.'); } catch { prompt('Copia este enlace:', b.dataset.copy); }
  }));
  $app.querySelectorAll('[data-qr]').forEach((b) => b.addEventListener('click', () => {
    const box = b.closest('.join').querySelector('.qr');
    if (box.classList.toggle('hidden')) return;
    if (!box.dataset.done && window.QRCode) { new window.QRCode(box, { text: b.dataset.qr, width: 200, height: 200 }); box.dataset.done = '1'; }
  }));
}

// ---------- hoja de acciones ----------

function openSheet(title, body, options, { noClose = false } = {}) {
  $sheet.innerHTML = `<h3>${esc(title)}</h3><div>${body}</div><div class="actions">
    ${options.map((o, i) => `<button class="${o.cls || ''}" data-i="${i}">${esc(o.label)}</button>`).join('')}
    ${noClose ? '' : '<button class="secondary" data-close>Cerrar</button>'}</div>`;
  $sheet.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => options[b.dataset.i].run()));
  const c = $sheet.querySelector('[data-close]');
  if (c) c.onclick = closeSheet;
  $sheet.classList.remove('hidden');
  $backdrop.classList.remove('hidden');
}
function closeSheet() { $sheet.classList.add('hidden'); $backdrop.classList.add('hidden'); }
$backdrop.addEventListener('click', () => { if (!$sheet.dataset.locked) closeSheet(); });

// ---------- arranque ----------

if (session.gameId && session.token) {
  $app.innerHTML = '<p class="muted">Cargando partida…</p>';
  load(true).then(startPolling);
} else {
  renderHome();
}
