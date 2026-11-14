// Prueba la API de punta a punta con el almacén en memoria, incluyendo escrituras simultáneas.
import assert from 'node:assert/strict';
import { handle, memoryStore } from '../lib/api.mjs';

const store = memoryStore();
const call = async (method, path, body) => {
  const res = await handle(new Request(`http://x/api/${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), store);
  return { status: res.status, data: await res.json() };
};

const created = await call('POST', 'games', { teams: 6, thieves: [{ name: 'Ana', team: 1 }, { name: 'Beto', team: 2 }], hiddenThief: { name: 'Caro', team: 3 } });
assert.equal(created.status, 201);
const { gameId, hostToken } = created.data;
const st = (token) => call('GET', `games/${gameId}/state?token=${token}`).then((r) => r.data);
const act = (token, body) => call('POST', `games/${gameId}/action`, { token, ...body });

const host = await st(hostToken);
assert.equal(host.me.role, 'host');
assert.equal(host.hiddenThief.name, 'Caro');
const teams = host.joins.teams, T = host.joins.thieves;
assert.equal((await call('GET', `games/${gameId}/state?token=nope`)).status, 400);

// 12 patrullas en paralelo
const cells = [1, 3, 5, 7, 9, 21, 23, 25, 27, 29, 61, 70];
await Promise.all(teams.flatMap((t, i) => [cells[i * 2], cells[i * 2 + 1]].map((cell) => act(t.token, { type: 'place_patrol', cell }))));
let h = await st(hostToken);
assert.equal(h.teams.reduce((s, t) => s + t.patrols.length, 0), 12, 'se perdió una patrulla por escritura simultánea');
assert.equal((await act(teams[0].token, { type: 'draw_loot' })).status, 400);
await act(hostToken, { type: 'draw_loot' });

const tv0 = await st(T);
assert.equal(tv0.me.role, 'thieves');
for (const th of tv0.thieves) {
  const v = await st(T);
  const r = await act(T, { type: 'place_start', thief: th.id, cell: v.me.startOptions[0] });
  assert.equal(r.status, 200, r.data.error);
}
h = await st(hostToken);
assert.equal(h.turn, 1);
assert.equal(h.phase, 'turno_policias', 'los policías abren el primer turno');

// policía: no puede espiar antes de terminar de mover
assert.equal((await act(teams[0].token, { type: 'spy', patrol: 1 })).status, 400);
// los ladrones no juegan durante el turno de los policías
assert.equal((await act(T, { type: 'move', thief: 1, cell: 1 })).status, 400);
await act(teams[0].token, { type: 'end_move' });
const teamView0 = await st(teams[0].token);
// los policías no pueden pasar: deben espiar o arrestar
assert.equal((await act(teams[0].token, { type: 'pass' })).status, 400);
// se espía la casilla de la patrulla o una contigua, no una lejana
const p1 = teamView0.teams[0].patrols.find((p) => p.id === 1);
const far = Array.from({ length: h.map.size }, (_, i) => i + 1).find((c) => c !== p1.cell && !h.map.edges.some(([a, b]) => (a === c && b === p1.cell) || (b === c && a === p1.cell)));
assert.equal((await act(teams[0].token, { type: 'spy', patrol: 1, cell: far })).status, 400, 'espió una casilla lejana');
const near = h.map.edges.find(([a, b]) => a === p1.cell || b === p1.cell);
const spy = await act(teams[0].token, { type: 'spy', patrol: 1, cell: near[0] === p1.cell ? near[1] : near[0] });
assert.equal(typeof spy.data.result.spy.result, 'boolean', 'el que espía recibe el resultado');
// cada patrulla actúa una vez: la patrulla a ya no puede, la b todavía sí
assert.equal((await act(teams[0].token, { type: 'arrest', patrol: 1, cell: 1 })).status, 400, 'la patrulla a actuó dos veces');
let tv1 = await st(teams[0].token);
assert.equal(tv1.me.step, 'accion');
assert.deepEqual(tv1.me.actedThisTurn, [1]);
const teamView = await st(teams[0].token);
assert.equal(teamView.me.spyLog[0].result, undefined, 'el resultado no se guarda en la vista del equipo');

// sondeo sin cambios
const same = (await call('GET', `games/${gameId}/state?token=${hostToken}&since=${teamView.version}`)).data;
assert.equal(same.unchanged, true);

await act(hostToken, { type: 'force_resolve' });
h = await st(hostToken);
assert.equal(h.turn, 1);
assert.equal(h.phase, 'turno_ladrones');

// fases del ladrón: no puede tomar botín antes de mover
assert.equal((await act(T, { type: 'pass', thief: 1 })).status, 400);
for (const th of h.thieves.filter((t) => !t.captured)) {
  const v = await st(T);
  const opts = v.me.moveOptions[th.id];
  const cell = opts.length ? opts[0] : v.thieves.find((x) => x.id === th.id).cell;
  await act(T, { type: 'move', thief: th.id, cell });
  assert.equal((await act(T, { type: 'move', thief: th.id, cell })).status, 400, 'no debe moverse dos veces');
  await act(T, { type: 'pass', thief: th.id });
}
h = await st(hostToken);
assert.equal(h.turn, 2);
assert.equal(h.phase, 'turno_policias');

// registro de actividad de un equipo: acciones de los policías y el fin de turno de los ladrones, nada más de ellos
const actLog = (await st(teams[1].token)).log;
assert.ok(actLog.some((l) => l.kind === 'espionaje' && l.team === 1), 'falta el espionaje del equipo 1');
assert.ok(actLog.some((l) => l.kind === 'ladrones_listo'), 'falta "Los ladrones terminaron su turno"');
assert.ok(!actLog.some((l) => l.side === 'thieves'), 'un equipo ve eventos privados de los ladrones');
assert.ok((await st(T)).log.some((l) => l.side === 'thieves'), 'los ladrones deben ver sus propios eventos');
console.log('API OK: permisos, escrituras simultáneas, fases de ladrones y policías, espionaje privado.');
