// Manejador HTTP independiente del hosting: lo usan la función de Netlify y el servidor local.
import { createGame, applyAction, viewFor, GameError } from './game.mjs';

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

/**
 * store: { get(id) -> {game, etag}|null, put(id, game, etag) -> boolean (false = conflicto), create(id, game) -> boolean }
 */
export async function handle(req, store) {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  try {
    // POST /api/games  -> crear partida
    if (req.method === 'POST' && parts.length === 1 && parts[0] === 'games') {
      const config = await req.json().catch(() => ({}));
      for (let i = 0; i < 5; i++) {
        const game = createGame(config);
        if (await store.create(game.id, game)) {
          return json(201, { gameId: game.id, hostToken: game.hostToken });
        }
      }
      return json(500, { error: 'No se pudo crear la partida, intenta de nuevo.' });
    }

    if (parts[0] !== 'games' || !parts[1]) return json(404, { error: 'Ruta no encontrada.' });
    const id = parts[1].toUpperCase();

    // GET /api/games/:id/state?token=...&since=version
    if (req.method === 'GET' && parts[2] === 'state') {
      const rec = await store.get(id);
      if (!rec) return json(404, { error: 'No existe esa partida.' });
      const sinceRaw = url.searchParams.get('since');
      const since = sinceRaw === null || sinceRaw === '' ? NaN : Number(sinceRaw);
      if (Number.isFinite(since) && since === rec.game.version) return json(200, { unchanged: true, version: since });
      return json(200, viewFor(rec.game, url.searchParams.get('token')));
    }

    // POST /api/games/:id/action  {token, type, ...}
    if (req.method === 'POST' && parts[2] === 'action') {
      const body = await req.json().catch(() => ({}));
      const { token, ...action } = body;
      for (let attempt = 0; attempt < 8; attempt++) {
        const rec = await store.get(id);
        if (!rec) return json(404, { error: 'No existe esa partida.' });
        const result = applyAction(rec.game, token, action) || null;
        // "result" es privado: solo lo recibe el teléfono que hizo la acción (p. ej. el resultado del espionaje)
        if (await store.put(id, rec.game, rec.etag)) return json(200, { ...viewFor(rec.game, token), result });
        await new Promise((r) => setTimeout(r, 40 + Math.random() * 120)); // otro equipo escribió al mismo tiempo
      }
      return json(409, { error: 'Mucho tráfico, intenta de nuevo.' });
    }

    return json(404, { error: 'Ruta no encontrada.' });
  } catch (e) {
    if (e instanceof GameError) return json(400, { error: e.message });
    console.error(e);
    return json(500, { error: 'Error del servidor.' });
  }
}

// Almacén en memoria para desarrollo local y pruebas.
export function memoryStore() {
  const m = new Map();
  return {
    async get(id) {
      const v = m.get(id);
      return v ? { game: JSON.parse(v.data), etag: v.etag } : null;
    },
    async put(id, game, etag) {
      const cur = m.get(id);
      if (!cur || cur.etag !== etag) return false;
      m.set(id, { data: JSON.stringify(game), etag: String(Number(etag) + 1) });
      return true;
    },
    async create(id, game) {
      if (m.has(id)) return false;
      m.set(id, { data: JSON.stringify(game), etag: '1' });
      return true;
    },
  };
}
