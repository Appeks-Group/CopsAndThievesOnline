# Policías y ladrones

App web para jugar Policías y ladrones por equipos desde varios teléfonos. Un jefe crea la partida y cada equipo y cada ladrón entra con su propio enlace. Los teléfonos se sincronizan cada 2 segundos.

## Qué hace

- **Genera el mapa:** número de columnas, filas y atajos diagonales configurables (por defecto 10 × 8 con 22 diagonales).
- **Configura la partida:** cuántos equipos, cuántas patrullas por equipo y cuántos ladrones (nombre, equipo de origen y si juega oculto).
- **Pantallas por rol:**
  - **Jefe:** ve todo, incluidos el ladrón oculto y los resultados de espionaje. Sortea los botines, comparte enlaces (copiar, WhatsApp o QR), cierra turnos y termina la partida.
  - **Equipo de policías** (un teléfono por equipo), en dos pasos:
    1. **Mover:** cada patrulla avanza 1 casilla contigua.
    2. **Acción:** cada patrulla espía o arresta una vez (es obligatorio; no se puede pasar).
    - Antes de espiar sale la alerta *"Asegúrate que nadie más de tu equipo esté cerca"*. El resultado se ve una sola vez y no queda guardado en pantalla.
  - **Equipo de ladrones** (un solo teléfono): por cada ladrón, **mover** 1 casilla contigua y luego **tomar botín** si está en uno, o **pasar** si no.
  - **Ladrón oculto:** no tiene ficha ni pantalla. Juega dentro de su equipo de policías y solo el jefe lo registra.
- **Aplica las reglas del reglamento:**
  - Patrullas primero, luego sorteo de botines y al final los ladrones.
  - Las casillas iniciales de los ladrones son secretas: solo las ven el jefe y el equipo de ladrones.
  - En cuanto los ladrones eligen su casilla inicial empieza el turno 1. En cada turno juegan primero los policías y después los ladrones.
  - Las patrullas pueden entrar a casillas con botín o donde haya un ladrón, y los ladrones pueden entrar a casillas con patrulla.
  - Espiar dice si algún ladrón pasó alguna vez por esa casilla.
  - Se espía y se arresta en la casilla de la patrulla o en una casilla vecina. Cada patrulla hace una sola acción (espiar o arrestar) por turno.
  - Ganan los ladrones con 5 botines o si sobreviven 15 turnos.
- **Fichas:**
  - Cada arresto da +3 al equipo que arresta.
  - Cada botín robado da +2 al equipo de origen del ladrón. Esas fichas se mantienen en secreto hasta el final para no delatar al ladrón oculto.
  - Si ganan los ladrones, cada ladrón libre da +3 a su equipo.

## Estructura

```
lib/game.mjs                reglas del juego (sin dependencias)
lib/api.mjs                 API HTTP independiente del hosting
netlify/functions/api.mjs   función de Netlify en /api/* con Netlify Blobs
public/                     interfaz (HTML, CSS y JS sin frameworks)
scripts/dev-server.mjs      servidor local con almacenamiento en memoria
scripts/simulate.mjs        300 partidas simuladas para validar las reglas
scripts/api-test.mjs        prueba de la API, incluidas escrituras simultáneas
```

## Probar en tu computadora

```bash
npm install
npm test        # simulación + prueba de API
npm run dev     # http://localhost:8888
```

Para probar con teléfonos en la misma red Wi-Fi, abre `http://TU-IP-LOCAL:8888`. El servidor local guarda las partidas en memoria: al reiniciarlo se pierden.

## Subir a Netlify

1. Sube esta carpeta a un repositorio de GitHub.
2. En Netlify elige **Add new site → Import an existing project** y selecciona el repositorio. No hace falta comando de build: `netlify.toml` ya indica la carpeta `public` y las funciones.
3. Despliega. Netlify Blobs se activa solo, sin configurar nada.

También puedes hacerlo desde la terminal:

```bash
npm install -g netlify-cli
netlify login
netlify init      # o: netlify link
netlify deploy --prod
```

Para probar localmente con Blobs reales usa `netlify dev`.

## Notas técnicas

- **Estado:** cada partida es un JSON en el almacén `partidas` de Netlify Blobs, con consistencia fuerte.
- **Escrituras simultáneas:** cada acción usa escritura condicional por ETag y reintenta si otro teléfono escribió al mismo tiempo, así no se pierde ninguna jugada.
- **Privacidad:** el servidor filtra lo que ve cada rol. Los equipos nunca reciben posiciones ni rastros de ladrones, ni el nombre del oculto.
- **Sincronización:** los teléfonos consultan cada 2 segundos, y si nada cambió la respuesta es mínima.
- **QR:** se generan con qrcodejs desde cdnjs.
