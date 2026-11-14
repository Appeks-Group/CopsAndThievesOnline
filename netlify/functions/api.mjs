// Función de Netlify: toda la API vive en /api/*. El estado de cada partida se guarda en Netlify Blobs.
import { getStore } from '@netlify/blobs';
import { handle } from '../../lib/api.mjs';

function blobsStore() {
  // "strong" para que todos los teléfonos lean siempre la última versión de la partida.
  const store = getStore({ name: 'partidas', consistency: 'strong' });
  return {
    async get(id) {
      const res = await store.getWithMetadata(id, { type: 'json' });
      return res ? { game: res.data, etag: res.etag } : null;
    },
    async put(id, game, etag) {
      const r = await store.setJSON(id, game, { onlyIfMatch: etag });
      return r?.modified !== false;
    },
    async create(id, game) {
      const r = await store.setJSON(id, game, { onlyIfNew: true });
      return r?.modified !== false;
    },
  };
}

export default async (req) => handle(req, blobsStore());

export const config = { path: '/api/*' };
