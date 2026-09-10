# n8n — Presentaciones de itinerario

Workflows que convierten un brief de itinerario en una presentación editable en Canva.
La app (`/tools/itinerary-presentation`) sube el PDF, extrae el texto y llama al webhook;
n8n planifica las diapositivas con Claude, resuelve las fotos, pide a la app que compile el
PPTX y lo importa en Canva. La app es la única que escribe el registro del job: n8n informa
cada paso con `PATCH /api/presentations/jobs/<id>`.

Archivos:

| Archivo | Qué es |
|---|---|
| `workflows/presentaciones-main.json` | Workflow principal (webhook → Claude → fotos → compilar → Canva) |
| `workflows/presentaciones-error-handler.json` | Marca el job como fallido si el principal muere fuera de su propio manejo de errores |
| `workflows/system-prompt.generated.md` | El system prompt tal como se envía a Claude (generado, sólo para leer) |
| `src/` | Fuentes: prompt, código de cada nodo Code, constantes compartidas con la app |
| `fixtures/sample-payload.json` | Un cuerpo de webhook real (con `dryRun: true`) para probar |
| `fixtures/sample-claude-response.json` | Una respuesta de Claude válida para fijar (*pin*) en el nodo *Claude — planificar* |

**Los JSON se generan**: `npm run n8n:build`. No editar el código dentro de n8n; editar
`src/code/*.js` o `src/system-prompt.md` y volver a generar. Los límites de texto, los
layouts y el JSON Schema salen de `lib/presentations/` de la app, así el prompt, el
validador y el compilador no se desalinean.

## Flujo

```
Webhook (POST /itinerary-presentation, header x-tools-secret)
  └─ Validar payload ─┬─ no → Responder 400
                      └─ sí → Responder 202 → Config → Contexto → Leer job → ¿Ejecutar?
        Estado: planning
        Índice de activos (stub hasta WorkDrive)
        Construir petición Claude → Claude — planificar → Validar manifest
              └─ inválido → Construir reintento → Claude — reintento → Validar manifest (2)
        Manifest final → Estado: resolving_assets
        Aplanar requisitos → WorkDrive y ruta → ¿Buscar en Pexels? → Pexels — buscar
        Unir → Seleccionar activos → Estado: compiling
        Compilar (POST /api/presentations/compile en la app) → Estado: importing
        ¿Importar a Canva? ─ no (dryRun / CANVA_ENABLED=false) → Estado: done (sin Canva)
                           └ sí → Descargar PPTX → Metadatos Canva → Canva — crear import
                                  → Resultado Canva → ¿listo? → Estado: done (con Canva)
                                                    → pendiente → Esperar 5 s → consultar (máx. 36)
                                                    → falló/timeout → Estado: done (Canva falló)
Cualquier salida de error ──────────────────────────► Fallo → Estado: failed
```

Una ejecución por job. Reenviar el mismo webhook no vuelve a ejecutar un job terminado o en
curso (`force: true` en el cuerpo lo fuerza).

## Instalación

### 1. Credenciales (crear antes de importar)

| Nombre exacto | Tipo en n8n | Valor |
|---|---|---|
| `Tools Suite → n8n (x-tools-secret)` | Header Auth | Name `x-tools-secret`, Value = `N8N_SHARED_SECRET` de la app |
| `n8n → Tools Suite (bearer)` | Header Auth | Name `Authorization`, Value `Bearer <PRESENTATIONS_COMPILE_SECRET>` |
| `Anthropic` | Anthropic | API key |
| `Pexels` | Header Auth | Name `Authorization`, Value = la API key de Pexels (sin "Bearer") |
| `Canva Connect` | OAuth2 API | Ver §Canva |
| `n8n API` | n8n API | Una API key de esta instancia (Settings → n8n API); sólo la usa el error handler |

Los nombres importan: el JSON referencia las credenciales por nombre y n8n las enlaza al
importar cuando coinciden. Si no coinciden, abrir cada nodo y elegirla a mano.

### 2. Importar

**Por la interfaz:** Workflows → *Import from File*, primero
`presentaciones-error-handler.json`, después `presentaciones-main.json`.

**Por la API:** con una API key de n8n,

```
N8N_BASE_URL=https://xxx.app.n8n.cloud N8N_API_KEY=... npm run n8n:deploy
```

crea o actualiza los dos workflows por nombre (`--activate` activa el principal).

### 3. Configurar

1. En el principal, nodo **Config**: `TOOLS_APP_URL` = la app en Vercel (sin barra final),
   `CANVA_ENABLED` = `true` cuando la credencial de Canva esté conectada; `CLAUDE_MODEL`
   (`claude-opus-5`) y `CLAUDE_EFFORT` (`medium`) se pueden ajustar tras el piloto.
2. En el error handler, nodo **Config**: `TOOLS_APP_URL` y `N8N_BASE_URL` (esta instancia).
3. Principal → Settings → *Error Workflow* → *TravelXM — Presentaciones · Error handler*.
   Si el plan lo permite, *Timeout Workflow* por encima de 15 minutos: Claude tarda de 1 a 4.
4. Activar el principal. Copiar la **Production URL** del Webhook a
   `N8N_PRESENTATION_WEBHOOK_URL` en Vercel, junto con `N8N_SHARED_SECRET` y
   `PRESENTATIONS_COMPILE_SECRET` (los mismos valores que las credenciales).

## Canva

1. [Canva Developers](https://www.canva.com/developers/) → *Your integrations* → crear una
   integración **privada** (sólo el equipo de TravelXM puede autorizarla).
2. *Scopes*: `design:content:write` (Design Import) y `design:meta:read`. Comprobar los nombres
   exactos en el portal.
3. *Authentication* → Redirect URL: `https://<instancia>.app.n8n.cloud/rest/oauth2-credential/callback`.
4. Generar el *client secret* (se muestra una sola vez).
5. En n8n, credencial **OAuth2 API** llamada `Canva Connect`: Grant Type **PKCE**,
   Authorization URL `https://www.canva.com/api/oauth/authorize`, Access Token URL
   `https://api.canva.com/rest/v1/oauth/token`, Client ID y Secret, Scope
   `design:content:write design:meta:read`, Authentication **Header**. *Connect my account*
   con el usuario de Canva que será dueño de los diseños.
6. `CANVA_ENABLED=true` en Config.

Canva rota el refresh token en cada renovación; que sólo esta credencial lo use. Si el PKCE
con secreto no funciona en la credencial genérica de n8n, la alternativa es mover el OAuth de
Canva a la app (ruta `/api/canva/...`) y que el nodo *Canva — crear import* llame a la app.

Si la importación falla o tarda más de tres minutos, el job termina como `done` **sin**
enlace de Canva y la app ofrece descargar el PowerPoint. Nunca se pierde el trabajo hecho.

## Contrato

Cuerpo del webhook (lo envía la app; `dryRun` y `force` son opcionales, para pruebas):

```json
{ "jobId": "20260910-120000-abc123", "title": "…", "style": "immersive|minimal",
  "audience": "client|agent|internal|mixed", "language": "en|es", "destination": "…",
  "clientName": "", "travelDates": "", "travelers": "", "notes": "",
  "pdfKey": "…", "pdfUrl": "…", "pageCount": 3, "textChars": 1536, "textLow": false,
  "textKey": "…", "text": "…texto del PDF…", "dryRun": true, "force": false }
```

Respuestas: `202 {"accepted":true,"jobId"}` de inmediato; `400 {"accepted":false,"errors"}`
si faltan campos o el texto tiene menos de 200 caracteres; `403` si el header no coincide.

Lo que n8n envía a la app está definido en `lib/presentations/types.ts` (`JobPatch`) y
`lib/presentations/manifest.ts` (`CompileRequest`); ver el README de la app.

## Probar

Sin n8n, la lógica de todos los nodos Code:

```
npm run n8n:test
```

Con n8n, sin gastar en Canva:

```
curl -i -X POST "https://<instancia>.app.n8n.cloud/webhook/itinerary-presentation" \
  -H "Content-Type: application/json" -H "x-tools-secret: <secreto>" \
  -d @n8n/fixtures/sample-payload.json
```

El `jobId` del fixture no existe en la app, así que *Leer job* responderá 404 y la ejecución
terminará en *Fallo* sin nada que marcar. Para una prueba completa: crear un job desde la app
(o con curl contra `/api/presentations/jobs`, ver README de la app), poner su `jobId` en el
cuerpo y enviar; el registro recorre `planning → resolving_assets → compiling → importing →
done` y termina con `pptxUrl`.

Para probar el validador sin llamar a Claude: en *Claude — planificar*, fijar (*pin*) el
contenido de `fixtures/sample-claude-response.json` y ejecutar manualmente.

Caminos de fallo que conviene ver una vez: header incorrecto (403); texto corto (400);
`TOOLS_APP_URL` apuntando a un 500 (job `failed` en `compiling`); credencial de Canva
desconectada (job `done` con aviso).

## Costes y límites

- Claude Opus 5 con `effort: medium`: aproximadamente 0,25–0,55 USD por presentación
  (entrada 6–17k tokens, salida 8–18k). El reintento cuesta menos porque prompt y brief
  vienen de la caché (5 minutos). `usage` se guarda en `job.meta`.
- Pexels gratuito: 200 peticiones/hora; un job hace 10–30. Pedir el aumento de cuota
  (gratuito, con atribución) antes del piloto.
- n8n Cloud: una ejecución por job; el workflow tarda de 2 a 6 minutos.
