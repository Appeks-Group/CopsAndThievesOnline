// Simula partidas completas con jugadores al azar para verificar que las reglas no se traben.
import assert from 'node:assert/strict';
import { createGame, applyAction, viewFor, adjacency, PHASES, GameError } from '../lib/game.mjs';

const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];

function playOne() {
  const g = createGame({
    teams: 6,
    thieves: [{ name: 'Ana', team: 1 }, { name: 'Beto', team: 2 }],
    hiddenThief: { name: 'Caro', team: 3 },
  });
  const adj = adjacency(g.map);
  const T = g.thievesToken;

  for (const t of g.teams) {
    while (t.patrols.length < g.config.patrolsPerTeam) {
      try { applyAction(g, t.token, { type: 'place_patrol', cell: 1 + Math.floor(Math.random() * g.map.size) }); } catch (e) { if (!(e instanceof GameError)) throw e; }
    }
  }
  assert.equal(g.phase, PHASES.DRAW_LOOT);
  applyAction(g, g.hostToken, { type: 'draw_loot' });
  assert.equal(g.loot.length, g.config.loot);

  // regla de inicio: nunca en un botín ni contiguo a uno; las casillas con patrulla sí se permiten
  {
    const lootCells = new Set(g.loot.map((l) => l.cell));
    const forbidden = new Set(lootCells);
    for (const c of lootCells) for (const n of adj[c]) forbidden.add(n);
    const opts = viewFor(g, T).me.startOptions;
    assert.ok(opts.every((c) => !forbidden.has(c)));
    const patrolled = g.teams.flatMap((t) => t.patrols.map((p) => p.cell)).filter((c) => !forbidden.has(c));
    assert.ok(patrolled.every((c) => opts.includes(c)));
  }

  for (const th of g.thieves) {
    const v = viewFor(g, T);
    applyAction(g, T, { type: 'place_start', thief: th.id, cell: rnd(v.me.startOptions) });
  }
  assert.equal(g.phase, PHASES.POLICE_TURN, 'los policías abren el primer turno');

  // privacidad: un equipo no ve posiciones actuales, ni el ladrón oculto, ni resultados de espionaje
  const tv = viewFor(g, g.teams[0].token);
  assert.ok(tv.thieves.every((t) => t.cell === undefined && t.trail === undefined && t.start === undefined), 'un equipo ve dónde están o empezaron los ladrones');
  assert.ok(tv.log.filter((l) => l.kind === 'inicio').every((l) => l.cell === undefined && !/casilla \d/.test(l.text)), 'la bitácora delata la casilla inicial');
  assert.ok(!JSON.stringify(tv).includes('Caro'));

  let guard = 0;
  while (g.phase !== PHASES.OVER && guard++ < 500) {
    if (g.phase === PHASES.THIEVES_TURN) {
      for (const th of g.thieves.filter((t) => !t.captured)) {
        if (g.phase !== PHASES.THIEVES_TURN) break;
        const opts = viewFor(g, T).me.moveOptions[th.id];
        applyAction(g, T, { type: 'move', thief: th.id, cell: opts.length ? rnd(opts) : th.cell });
        const onLoot = g.loot.some((l) => l.cell === th.cell && !l.stolen);
        applyAction(g, T, { type: onLoot && Math.random() < 0.8 ? 'take_loot' : 'pass', thief: th.id });
      }
    } else if (g.phase === PHASES.POLICE_TURN) {
      for (const t of g.teams) {
        if (g.phase !== PHASES.POLICE_TURN) break;
        for (const p of t.patrols) {
          const v = viewFor(g, t.token);
          const opts = v.me.moveOptions[p.id] || [];
          if (opts.length && Math.random() < 0.8 && t.step === 'mover') applyAction(g, t.token, { type: 'move_patrol', patrol: p.id, cell: rnd(opts) });
        }
        if (t.step === 'mover') applyAction(g, t.token, { type: 'end_move' });
        const p = rnd(t.patrols);
        const r = Math.random();
        if (r < 0.45) {
          const res = applyAction(g, t.token, { type: 'spy', patrol: p.id });
          assert.equal(typeof res.spy.result, 'boolean');
        } else if (r < 0.9) applyAction(g, t.token, { type: 'arrest', patrol: p.id, cell: rnd([p.cell, ...adj[p.cell]]) });
        else applyAction(g, t.token, { type: 'pass' });
      }
    }
  }
  assert.equal(g.phase, PHASES.OVER, 'la partida no terminó');
  const cells = g.teams.flatMap((t) => t.patrols.map((p) => p.cell));
  assert.equal(new Set(cells).size, cells.length, 'dos patrullas en la misma casilla');
  const lootCells = new Set(g.loot.filter((l) => !l.stolen).map((l) => l.cell));
  assert.ok(cells.every((c) => !lootCells.has(c)), 'patrulla sobre botín');
  return { winner: g.winner, turns: g.turn, stolen: g.loot.filter((l) => l.stolen).length, caught: g.thieves.filter((t) => t.captured).length };
}

const results = Array.from({ length: 300 }, playOne);
const by = (k) => results.reduce((m, r) => ((m[r[k]] = (m[r[k]] || 0) + 1), m), {});
console.log('300 partidas al azar OK');
console.log('Ganadores:', by('winner'));
console.log('Turnos promedio:', (results.reduce((s, r) => s + r.turns, 0) / results.length).toFixed(1));
console.log('Botines robados promedio:', (results.reduce((s, r) => s + r.stolen, 0) / results.length).toFixed(1));
console.log('Ladrones capturados promedio:', (results.reduce((s, r) => s + r.caught, 0) / results.length).toFixed(2));
