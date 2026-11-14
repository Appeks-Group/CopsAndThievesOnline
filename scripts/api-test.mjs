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
const spy = await act(teams[0].token, { type: 'spy', patrol: 1 });
assert.equal(typeof spy.data.result.spy.result, 'boolean', 'el que espía recibe el resultado');
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
console.log('API OK: permisos, escrituras simultáneas, fases de ladrones y policías, espionaje privado.');
