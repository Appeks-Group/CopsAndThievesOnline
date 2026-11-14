// Lógica pura del juego "Policías y ladrones". Sin dependencias: la usan la API y las pruebas.
//
// Turno:
//   1. Equipo de ladrones: por cada ladrón -> mover (1 casilla contigua) -> tomar botín o pasar.
//   2. Cada equipo de policías: mover sus patrullas (1 casilla contigua) -> espiar, arrestar o pasar.
// El ladrón oculto no tiene ficha: juega dentro de su equipo de policías y solo lo registra el jefe.

export const PHASES = {
  PLACE_POLICE: 'colocar_patrullas',
  DRAW_LOOT: 'sortear_botines',
  PLACE_THIEVES: 'colocar_ladrones',
  THIEVES_TURN: 'turno_ladrones',
  POLICE_TURN: 'turno_policias',
  OVER: 'terminado',
};

export const DEFAULTS = {
  teams: 6,
  patrolsPerTeam: 2,
  cols: 10,
  rows: 8,
  diagonals: 22,
  loot: 12,
  lootToWin: 5,
  maxTurns: 15,
  points: { arrest: 3, lootStolen: 2, thiefFreeAtWin: 3 },
};

export class GameError extends Error {}
const fail = (msg) => { throw new GameError(msg); };

// ---------- utilidades ----------

export function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomId(len = 6, alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789') {
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

const shuffle = (arr, rng) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};
const clampInt = (v, min, max) => Math.max(min, Math.min(max, Math.round(Number(v) || min)));

// ---------- mapa ----------

export function generateMap({ cols, rows, diagonals, seed }) {
  const rng = makeRng(seed);
  const id = (c, r) => (r - 1) * cols + c;
  const edges = [];
  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= cols; c++) {
      if (c < cols) edges.push([id(c, r), id(c + 1, r)]);
      if (r < rows) edges.push([id(c, r), id(c, r + 1)]);
    }
  }
  const cells = [];
  for (let r = 1; r < rows; r++) for (let c = 1; c < cols; c++) cells.push([c, r]);
  shuffle(cells, rng);
  for (const [c, r] of cells.slice(0, Math.min(diagonals, cells.length))) {
    edges.push(rng() < 0.5 ? [id(c, r), id(c + 1, r + 1)] : [id(c + 1, r), id(c, r + 1)]);
  }
  return { cols, rows, size: cols * rows, edges };
}

export function adjacency(map) {
  const adj = {};
  for (let i = 1; i <= map.size; i++) adj[i] = new Set();
  for (const [a, b] of map.edges) { adj[a].add(b); adj[b].add(a); }
  return adj;
}

// ---------- creación ----------

/**
 * input: { teams, teamNames?, patrolsPerTeam, thieves:[{name, team}], hiddenThief?:{name, team},
 *          cols, rows, diagonals, loot, lootToWin, maxTurns }
 */
export function createGame(input = {}, now = Date.now()) {
  const cfg = { ...DEFAULTS, ...input, points: { ...DEFAULTS.points, ...(input.points || {}) } };
  const teams = clampInt(cfg.teams, 1, 12);
  const patrolsPerTeam = clampInt(cfg.patrolsPerTeam, 1, 4);
  const cols = clampInt(cfg.cols, 4, 16);
  const rows = clampInt(cfg.rows, 4, 16);
  const size = cols * rows;
  const thievesIn = Array.isArray(cfg.thieves) && cfg.thieves.length
    ? cfg.thieves.filter((t) => !t.hidden)
    : [{ name: 'Ladrón 1', team: 1 }, { name: 'Ladrón 2', team: 2 }];
  if (!thievesIn.length) fail('Agrega al menos un ladrón en el tablero.');
  if (thievesIn.length > 6) fail('Máximo 6 ladrones en el tablero.');
  if (teams * patrolsPerTeam + thievesIn.length * 3 >= size) fail('El mapa es demasiado chico para tantas patrullas y ladrones.');
  const loot = clampInt(cfg.loot, 1, Math.floor(size / 3));
  const lootToWin = clampInt(cfg.lootToWin, 1, loot);
  const hiddenIn = cfg.hiddenThief || (Array.isArray(cfg.thieves) && cfg.thieves.find((t) => t.hidden)) || null;

  const map = generateMap({ cols, rows, diagonals: clampInt(cfg.diagonals, 0, (cols - 1) * (rows - 1)), seed: Math.floor(Math.random() * 2 ** 31) });

  const game = {
    id: randomId(6),
    createdAt: now,
    version: 0,
    config: { teams, patrolsPerTeam, cols, rows, loot, lootToWin, maxTurns: clampInt(cfg.maxTurns, 1, 99), points: cfg.points },
    map,
    phase: PHASES.PLACE_POLICE,
    turn: 0,
    hostToken: randomId(16),
    thievesToken: randomId(16),
    teams: [],
    thieves: [],
    hiddenThief: hiddenIn && hiddenIn.name ? { name: String(hiddenIn.name).slice(0, 40), team: clampInt(hiddenIn.team, 1, teams) } : null,
    loot: [], // [{cell, stolen, stolenTurn, by}]
    log: [],
    winner: null,
  };
  for (let t = 1; t <= teams; t++) {
    game.teams.push({
      id: t,
      name: (cfg.teamNames && cfg.teamNames[t - 1]) || `Equipo ${t}`,
      token: randomId(16),
      patrols: [], // [{id, cell}]
      points: 0, // fichas públicas (arrestos)
      lootPoints: 0, // fichas por botines: secretas hasta el final
      step: null, // 'mover' | 'accion' | 'listo'
      movedThisTurn: [], // ids de patrullas que ya se movieron
      spyLog: [], // [{turn, cell, result}] el resultado solo se entrega una vez
      arrests: [],
    });
  }
  thievesIn.forEach((th, i) => {
    game.thieves.push({
      id: i + 1,
      name: String(th.name || `Ladrón ${i + 1}`).slice(0, 40),
      team: clampInt(th.team, 1, teams),
      cell: null,
      trail: [],
      captured: false,
      capturedBy: null,
      step: null, // 'mover' | 'accion' | 'listo'
      loot: 0,
    });
  });
  addLog(game, 'inicio', `Partida creada. Ladrones en el tablero: ${game.thieves.map((t) => t.name).join(', ')}.`);
  return game;
}

function addLog(game, kind, text, extra = {}) {
  game.log.push({ turn: game.turn, kind, text, at: Date.now(), ...extra });
}

// ---------- consultas ----------

export function whoIs(game, token) {
  if (!token) return null;
  if (token === game.hostToken) return { role: 'host' };
  if (token === game.thievesToken) return { role: 'thieves' };
  const team = game.teams.find((t) => t.token === token);
  if (team) return { role: 'team', team };
  return null;
}

const patrolCells = (game) => new Set(game.teams.flatMap((t) => t.patrols.map((p) => p.cell)));
const lootAt = (game, cell) => game.loot.find((l) => l.cell === cell && !l.stolen);
const freeThieves = (game) => game.thieves.filter((t) => !t.captured);

export function thiefMoveOptions(game, thief) {
  const adj = adjacency(game.map);
  const blocked = patrolCells(game);
  return [...adj[thief.cell]].filter((c) => !blocked.has(c)).sort((a, b) => a - b);
}

// Un ladrón puede empezar en cualquier casilla (incluso con patrulla), salvo un botín o una casilla contigua a un botín.
export function validThiefStarts(game) {
  const adj = adjacency(game.map);
  const lootCells = new Set(game.loot.filter((l) => !l.stolen).map((l) => l.cell));
  const nearLoot = new Set();
  for (const c of lootCells) for (const n of adj[c]) nearLoot.add(n);
  const out = [];
  for (let c = 1; c <= game.map.size; c++) {
    if (lootCells.has(c) || nearLoot.has(c)) continue;
    out.push(c);
  }
  return out;
}

export function patrolMoveOptions(game, team, patrol) {
  const adj = adjacency(game.map);
  const occupied = patrolCells(game);
  return [...adj[patrol.cell]].filter((c) => !occupied.has(c) && !lootAt(game, c)).sort((a, b) => a - b);
}

// ---------- acciones ----------

/** Aplica una acción. Devuelve un resultado privado opcional (por ejemplo, el del espionaje). */
export function applyAction(game, token, action) {
  const who = whoIs(game, token);
  if (!who) fail('Código no válido para esta partida.');
  if (game.phase === PHASES.OVER) fail('La partida ya terminó.');
  const handlers = {
    host: { draw_loot: hostDrawLoot, force_resolve: hostForceResolve, end_game: hostEnd },
    team: { place_patrol: teamPlacePatrol, remove_patrol: teamRemovePatrol, move_patrol: teamMovePatrol, end_move: teamEndMove, spy: teamSpy, arrest: teamArrest, pass: teamPass },
    thieves: { place_start: thiefPlaceStart, move: thiefMove, take_loot: thiefTakeLoot, pass: thiefPass },
  };
  const fn = handlers[who.role][action.type];
  if (!fn) fail('Acción no permitida para tu rol.');
  const result = fn(game, who, action);
  game.version++;
  return result;
}

// --- colocación ---

function teamPlacePatrol(game, { team }, { cell }) {
  if (game.phase !== PHASES.PLACE_POLICE) fail('Ya no es momento de colocar patrullas.');
  cell = Number(cell);
  if (!(cell >= 1 && cell <= game.map.size)) fail('Casilla inválida.');
  if (team.patrols.length >= game.config.patrolsPerTeam) fail('Ya colocaste todas tus patrullas.');
  if (patrolCells(game).has(cell)) fail('Esa casilla ya tiene una patrulla.');
  team.patrols.push({ id: 0, cell });
  team.patrols.forEach((p, i) => (p.id = i + 1));
  if (game.teams.every((t) => t.patrols.length === game.config.patrolsPerTeam)) {
    game.phase = PHASES.DRAW_LOOT;
    addLog(game, 'fase', 'Todas las patrullas están colocadas. El jefe sortea los botines.');
  }
}

function teamRemovePatrol(game, { team }, { cell }) {
  if (game.phase !== PHASES.PLACE_POLICE) fail('Ya no puedes mover tus patrullas iniciales.');
  const i = team.patrols.findIndex((p) => p.cell === Number(cell));
  if (i < 0) fail('No tienes patrulla en esa casilla.');
  team.patrols.splice(i, 1);
  team.patrols.forEach((p, k) => (p.id = k + 1));
}

export function hostDrawLoot(game, _who = null, _a = {}, rng = Math.random) {
  if (game.phase !== PHASES.DRAW_LOOT) fail('Primero deben estar todas las patrullas colocadas.');
  const adj = adjacency(game.map);
  const blocked = patrolCells(game);
  const bag = shuffle([...Array(game.map.size).keys()].map((i) => i + 1), rng);
  const chosen = [];
  const pick = (strict) => {
    for (const c of bag) {
      if (chosen.length >= game.config.loot) break;
      if (blocked.has(c) || chosen.includes(c)) continue;
      if (strict && chosen.some((o) => adj[o].has(c))) continue;
      chosen.push(c);
    }
  };
  pick(true);
  pick(false); // si el mapa está muy lleno, relaja la regla de no ser vecinos
  game.loot = chosen.map((cell) => ({ cell, stolen: false, stolenTurn: null, by: null }));
  game.phase = PHASES.PLACE_THIEVES;
  addLog(game, 'fase', `Se sortearon ${chosen.length} botines. El equipo de ladrones elige dónde empieza cada ladrón.`);
}

function thiefPlaceStart(game, _who, { thief: thiefId, cell }) {
  if (game.phase !== PHASES.PLACE_THIEVES) fail('No es momento de colocar ladrones.');
  const thief = game.thieves.find((t) => t.id === Number(thiefId));
  if (!thief) fail('Ladrón no encontrado.');
  cell = Number(cell);
  if (thief.cell) fail(`${thief.name} ya tiene casilla inicial.`);
  if (!validThiefStarts(game).includes(cell)) fail('No puede empezar ahí: no puede ser un botín ni estar junto a un botín.');
  thief.cell = cell;
  thief.trail = [cell];
  addLog(game, 'inicio', `${thief.name} empieza en la casilla ${cell}.`, { cell });
  if (game.thieves.every((t) => t.cell)) startTurn(game);
}

// --- turno de ladrones ---

function startTurn(game) {
  game.turn++;
  game.phase = PHASES.THIEVES_TURN;
  for (const t of freeThieves(game)) t.step = 'mover';
  for (const t of game.teams) { t.step = null; t.movedThisTurn = []; }
  addLog(game, 'turno', `Comienza el turno ${game.turn}. Juegan los ladrones.`);
}

const getThief = (game, id, step) => {
  if (game.phase !== PHASES.THIEVES_TURN) fail('Ahora no es turno de los ladrones.');
  const t = game.thieves.find((x) => x.id === Number(id));
  if (!t) fail('Ladrón no encontrado.');
  if (t.captured) fail(`${t.name} fue capturado.`);
  if (step && t.step !== step) fail(t.step === 'listo' ? `${t.name} ya terminó su turno.` : `${t.name} primero debe ${t.step}.`);
  return t;
};

function thiefMove(game, _who, { thief: id, cell }) {
  const t = getThief(game, id, 'mover');
  cell = Number(cell);
  const opts = thiefMoveOptions(game, t);
  if (opts.length === 0) {
    if (cell !== t.cell) fail('Está rodeado: solo puede quedarse.');
  } else if (!opts.includes(cell)) fail('Solo puede moverse a una casilla contigua sin patrulla.');
  t.cell = cell;
  if (!t.trail.includes(cell)) t.trail.push(cell);
  t.step = 'accion';
}

function thiefTakeLoot(game, _who, { thief: id }) {
  const t = getThief(game, id, 'accion');
  const l = lootAt(game, t.cell);
  if (!l) fail('En esta casilla no hay botín.');
  l.stolen = true;
  l.stolenTurn = game.turn;
  l.by = t.id;
  t.loot++;
  game.teams.find((x) => x.id === t.team).lootPoints += game.config.points.lootStolen;
  addLog(game, 'robo', `¡Robaron el botín de la casilla ${t.cell}!`, { cell: t.cell });
  t.step = 'listo';
  afterThiefAction(game);
}

function thiefPass(game, _who, { thief: id }) {
  const t = getThief(game, id, 'accion');
  t.step = 'listo';
  afterThiefAction(game);
}

function afterThiefAction(game) {
  const stolen = game.loot.filter((l) => l.stolen).length;
  if (stolen >= game.config.lootToWin) return finish(game, 'ladrones', `Los ladrones robaron ${stolen} botines.`);
  if (freeThieves(game).every((t) => t.step === 'listo')) {
    game.phase = PHASES.POLICE_TURN;
    for (const t of game.teams) { t.step = 'mover'; t.movedThisTurn = []; }
    addLog(game, 'fase', 'Turno de los policías: primero muevan sus patrullas y luego espíen o arresten.');
  }
}

// --- turno de policías ---

const teamStep = (game, team, step) => {
  if (game.phase !== PHASES.POLICE_TURN) fail('Ahora no es turno de los policías.');
  if (team.step !== step) fail(team.step === 'listo' ? 'Tu equipo ya terminó este turno.' : step === 'mover' ? 'Ya terminaste de mover; ahora elige tu acción.' : 'Primero termina de mover tus patrullas.');
};

function teamMovePatrol(game, { team }, { patrol, cell }) {
  teamStep(game, team, 'mover');
  const p = team.patrols.find((x) => x.id === Number(patrol));
  if (!p) fail('Patrulla no encontrada.');
  if (team.movedThisTurn.includes(p.id)) fail('Esa patrulla ya se movió este turno.');
  cell = Number(cell);
  if (!adjacency(game.map)[p.cell].has(cell)) fail('Solo puede moverse a una casilla contigua.');
  if (lootAt(game, cell)) fail('Las patrullas no pueden entrar a una casilla con botín.');
  if (patrolCells(game).has(cell)) fail('Esa casilla ya tiene una patrulla.');
  p.cell = cell;
  team.movedThisTurn.push(p.id);
  if (team.movedThisTurn.length >= team.patrols.length) team.step = 'accion';
}

function teamEndMove(game, { team }) {
  teamStep(game, team, 'mover');
  team.step = 'accion';
}

function teamSpy(game, { team }, { patrol }) {
  teamStep(game, team, 'accion');
  const p = team.patrols.find((x) => x.id === Number(patrol));
  if (!p) fail('Elige qué patrulla espía.');
  const result = game.thieves.some((t) => t.trail.includes(p.cell));
  team.spyLog.push({ turn: game.turn, cell: p.cell, result });
  addLog(game, 'espionaje', `${team.name} espió la casilla ${p.cell}.`, { team: team.id });
  teamDone(game, team);
  return { spy: { cell: p.cell, result } };
}

function teamArrest(game, { team }, { patrol, cell }) {
  teamStep(game, team, 'accion');
  const p = team.patrols.find((x) => x.id === Number(patrol));
  if (!p) fail('Elige qué patrulla arresta.');
  cell = Number(cell);
  if (cell !== p.cell && !adjacency(game.map)[p.cell].has(cell)) fail('Solo puedes arrestar en la casilla de la patrulla o en una contigua.');
  const caught = freeThieves(game).filter((t) => t.cell === cell);
  team.arrests.push({ turn: game.turn, cell, caught: caught.map((t) => t.id) });
  for (const t of caught) {
    t.captured = true;
    t.capturedBy = team.id;
    t.step = null;
    team.points += game.config.points.arrest;
    addLog(game, 'arresto', `${team.name} arrestó a ${t.name} en la casilla ${cell}.`, { cell });
  }
  if (!caught.length) addLog(game, 'arresto_fallido', `${team.name} intentó arrestar en la casilla ${cell}, pero no había nadie.`, { cell });
  teamDone(game, team);
  return { arrest: { cell, caught: caught.map((t) => t.name) } };
}

function teamPass(game, { team }) {
  teamStep(game, team, 'accion');
  teamDone(game, team);
}

function teamDone(game, team) {
  team.step = 'listo';
  if (freeThieves(game).length === 0) return finish(game, 'policias', 'Todos los ladrones fueron capturados.');
  if (game.teams.every((t) => t.step === 'listo')) endPoliceTurn(game);
}

function endPoliceTurn(game) {
  if (game.turn >= game.config.maxTurns) {
    for (const t of freeThieves(game)) game.teams.find((x) => x.id === t.team).points += game.config.points.thiefFreeAtWin;
    return finish(game, 'ladrones', `Sobrevivieron ${game.config.maxTurns} turnos.`);
  }
  startTurn(game);
}

// --- jefe ---

function hostForceResolve(game) {
  if (game.phase === PHASES.THIEVES_TURN) {
    for (const t of freeThieves(game)) t.step = 'listo';
    addLog(game, 'jefe', 'El jefe cerró el turno de los ladrones.');
    afterThiefAction(game);
  } else if (game.phase === PHASES.POLICE_TURN) {
    for (const t of game.teams) t.step = 'listo';
    addLog(game, 'jefe', 'El jefe cerró el turno de los policías.');
    endPoliceTurn(game);
  } else fail('No hay turno que cerrar en esta fase.');
}

function hostEnd(game) {
  finish(game, null, 'El jefe terminó la partida.');
}

function finish(game, winner, reason) {
  game.phase = PHASES.OVER;
  game.winner = winner;
  addLog(game, 'fin', `${winner === 'ladrones' ? 'Ganan los ladrones' : winner === 'policias' ? 'Ganan los policías' : 'Fin del juego'}. ${reason}`);
}

// ---------- vista filtrada por rol ----------

export function viewFor(game, token) {
  const who = whoIs(game, token);
  if (!who) fail('Código no válido para esta partida.');
  const over = game.phase === PHASES.OVER;
  const seesAll = who.role === 'host' || over;
  const base = {
    id: game.id,
    version: game.version,
    config: game.config,
    map: game.map,
    phase: game.phase,
    turn: game.turn,
    winner: game.winner,
    log: game.log.slice(-60),
    teams: game.teams.map((t) => ({ id: t.id, name: t.name, points: seesAll ? t.points + t.lootPoints : t.points, patrols: t.patrols, step: t.step })),
    scoresSecret: !seesAll,
    loot: game.loot.map((l) => ({ cell: l.cell, stolen: l.stolen, stolenTurn: l.stolenTurn })),
    thieves: game.thieves.map((t) => ({
      id: t.id,
      name: t.name,
      captured: t.captured,
      capturedBy: t.capturedBy,
      step: t.step,
      placed: !!t.cell,
      start: t.trail[0] ?? null, // la casilla inicial es pública
      ...(seesAll || who.role === 'thieves' ? { cell: t.cell, trail: t.trail, loot: t.loot, team: t.team } : {}),
    })),
    stolenCount: game.loot.filter((l) => l.stolen).length,
  };
  if (who.role === 'host') {
    base.me = { role: 'host' };
    base.hiddenThief = game.hiddenThief;
    base.joins = {
      host: game.hostToken,
      thieves: game.thievesToken,
      teams: game.teams.map((t) => ({ id: t.id, name: t.name, token: t.token })),
    };
    base.spyLogs = game.teams.map((t) => ({ team: t.id, log: t.spyLog }));
  } else if (who.role === 'team') {
    const t = who.team;
    base.me = {
      role: 'team',
      teamId: t.id,
      name: t.name,
      step: t.step,
      movedThisTurn: t.movedThisTurn,
      spyLog: t.spyLog.map((s) => ({ turn: s.turn, cell: s.cell })), // sin resultado: solo lo ve quien espía
      arrests: t.arrests,
      moveOptions: game.phase === PHASES.POLICE_TURN && t.step === 'mover'
        ? Object.fromEntries(t.patrols.filter((p) => !t.movedThisTurn.includes(p.id)).map((p) => [p.id, patrolMoveOptions(game, t, p)]))
        : {},
    };
  } else {
    base.me = {
      role: 'thieves',
      startOptions: game.phase === PHASES.PLACE_THIEVES ? validThiefStarts(game) : [],
      moveOptions: game.phase === PHASES.THIEVES_TURN
        ? Object.fromEntries(freeThieves(game).filter((t) => t.step === 'mover').map((t) => [t.id, thiefMoveOptions(game, t)]))
        : {},
    };
  }
  if (over) base.hiddenThief = game.hiddenThief;
  return base;
}
