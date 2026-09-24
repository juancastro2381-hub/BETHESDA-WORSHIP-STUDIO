# BETHESDA WORSHIP STUDIO
## Documento 03: Vista de Interpretación, Setlists, Modo Ensayo y Sincronización en Tiempo Real

---

## 1. Modelo de Vista de Interpretación (Performance View Engine)

La **Vista de Interpretación** es el componente frontal crítico donde el músico interactúa con la obra durante el ensayo y el servicio en vivo.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        VISTA DE INTERPRETACIÓN                         │
│                                                                        │
│  [1. INSTRUMENTO]  ──► Guitarra Eléctrica                              │
│  [2. TIPO DE VISTA] ──► Partitura + Tablatura                          │
│                                                                        │
│  [3. CAPAS DINÁMICAS (Toggles Rápidos)]                                │
│       ☑ Cifrado Armónico             ☑ Letra de la Canción             │
│       ☐ Diagramas de Acordes         ☐ Indicador de Digitación         │
│                                                                        │
│  [4. PARÁMETROS ERGONÓMICOS]                                           │
│       • Desplazamiento: Auto-scroll fluido (BPM Activo)                │
│       • Tema: Alto Contraste Oscuro (Stage Black)                      │
│       • Escala: Tamaño de Texto Grande (18pt+)                         │
│       • Resaltado: Borde sutil en Compás y Sección en curso            │
└────────────────────────────────────────────────────────────────────────┘
```

### Configuración Inteligente y Perfil del Músico (Smart Defaults)
Para eliminar la necesidad de configurar la pantalla cada vez que se abre una canción:
1. El usuario guarda en su **Perfil de Músico** su instrumento por defecto y su vista preferida.
2. Al abrir cualquier canción o setlist, el sistema aplica automáticamente esos valores.
3. La barra de control superior cuenta con un menú de un solo toque: *"Cambiar Vista"*, permitiendo alternar al instante sin interrumpir la lectura.

---

## 2. Modelo de Setlist (Listas de Servicio y Culto)

El **Setlist** es la entidad de agregación que estructura un servicio completo de la congregación (ej. Culto Dominical 10:00 AM, Noche de Alabanza, Vigilia, Ensayo General).

### Estructura de Datos de un Setlist:
- `id`: UUIDv7.
- `title`: Ej. *"Culto Dominical - 24 Septiembre"*.
- `scheduled_date`: Fecha y hora prevista de inicio.
- `items`: Lista ordenada de elementos del servicio.

### Tipos de Elementos en el Setlist (*Setlist Items*):
1. **Song Item:**
   - Referencia a la canción y al arreglo específico elegido.
   - **Tonalidad Asignada:** Permite cambiar la tonalidad para ese culto específico (ej. Solista femenina requiere Re en lugar de Fa original) sin alterar la canción canónica.
   - **Tempo Asignado:** BPM objetivo.
   - **Transición:** Define cómo se pasa a la siguiente canción:
     - `SEGUE` (Continuo / Sin pausa entre canciones).
     - `CROSSFADE` / `PAD_HOLD` (Mantiene pad o acorde sonando mientras modula a la nueva tonalidad).
     - `STOP` (Pausa con aplauso congregacional o bienvenida).
     - `MEDLEY` (Enlace directo sin compás intermedio).
2. **Service Element (Momento Litúrgico / Interludio):**
   - Elementos no cantados pero vitales para la coordinación:
     - *"Bienvenida y Oración Inicial"* (Duración estimada: 5 min).
     - *"Lectura Bíblica"* (Duración estimada: 3 min).
     - *"Momento de Ministración / Clamor"* (Pista ambiental libre en La menor).
     - *"Ofrendas / Anuncios"*.
3. **Notas del Director Musical:** Indicaciones visibles para el equipo (ej. *"Comenzar solo piano y voz; batería entra con bombo a 4 en el Coro 2"*).

---

## 3. Modo Ensayo (Rehearsal Engine & Web Audio Timing)

El **Modo Ensayo** está concebido para optimizar el tiempo del equipo antes del servicio dominical:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CONTROLES DE ENSAYO                             │
│                                                                        │
│   [◄◄ Ant]  [ ▶ / ❚❚ ]  [Sig ►►]   [ 🔁 Bucle: Compases 17-24 ]        │
│                                                                        │
│   Tempo: [ - ] 124 BPM [ + ]       Metrónomo: [🔊 ON - Sonido Woodblock] │
│   Cuenta Previa: [ 4 Pulsos ]      Cursor de Seguimiento: [ ACTIVO ]   │
└────────────────────────────────────────────────────────────────────────┘
```

### Características Técnicas del Motor de Ensayo:
1. **Metrónomo de Alta Precisión con Web Audio API:**
   - La temporización no usa `setInterval` de JavaScript (que sufre desfases por el event loop del navegador).
   - Utiliza el temporizador de hardware del sistema de audio (`AudioContext.currentTime`) con un algoritmo de doble ventana (*Lookahead Scheduler*), garantizando una precisión con jitter inferior a **1 milisegundo**.
2. **Bucle de Sección (Looping):**
   - El director o el músico puede tocar cualquier sección (ej. *"Puente"*) y pulsar `🔁 Bucle`. El reproductor cicla indefinidamente sobre esos compases.
3. **Control de Tempo Variable:**
   - Posibilidad de ralentizar una sección difícil al 70% u 80% del BPM para aprendizaje progresivo.
4. **Pista de Referencia / Audio Multipista (Multitrack Backing Track):**
   - Enlace a archivos de audio de referencia con canales separables (Click, Cues de voz, Pista instrumental, Pistas aisladas).

---

## 4. Sesión en Vivo Sincronizada (Real-Time Worship Session)

Durante el servicio en vivo, el **Director Musical (MD)** lidera el flujo espiritual y musical. La congregación requiere espontaneidad (repetir un coro, extender un puente o realizar una transición imprevista).

### Roles en la Sesión en Vivo:
- **Director (Leader / Broadcaster):** Posee el control de emisión de comandos de navegación.
- **Músico (Follower / Listener):** Recibe los eventos de navegación y su pantalla se adapta automáticamente.
- **Modo Autónomo (Local Override):** Un músico puede desacoplarse temporalmente del control del director si necesita revisar una sección adelantada sin afectar al resto de la banda.

### Flujo de Comandos en Tiempo Real:
```
[ DIRECTOR MUSICAL (Tablet MD) ]
             │
             │ Dispara acción: "Saltar a PUENTE 1"
             ▼
     [ SERVIDOR WEBSOCKET ]
    (FastAPI + Redis Pub/Sub)
             │
      Broadcast a sala: "bethesda_culto_domingo"
             │
             ├──────────────────────────┬──────────────────────────┐
             ▼                          ▼                          ▼
     [ PIANISTA (Tablet) ]      [ GUITARRISTA (Móvil) ]    [ VOCALISTA (Móvil) ]
      Resalta Compás 33          Tablatura salta a Compás 33  Letra enfoca Puente
      en Partitura Doble         con animación sutil        con texto grande
```

---

## 5. Especificación del Protocolo WebSocket

### Conexión y Seguridad:
- Endpoint: `wss://api.bethesdaworship.studio/ws/sessions/{session_id}`
- Autenticación: Token JWT validado en el handshake inicial mediante header `Sec-WebSocket-Protocol` o parámetro ticket efímero de conexión única.

### Estructura del Payload de Mensajes (Frames JSON):

#### 1. Mensaje de Navegación de Sección (`SECTION_CHANGE`)
```json
{
  "event": "SECTION_CHANGE",
  "session_id": "ses_domingo_2026_09",
  "timestamp_utc_ms": 1790401200450,
  "payload": {
    "song_id": "song_gracia_sublime",
    "section_id": "sec_bridge_1",
    "section_name": "Puente 1",
    "target_measure": 33,
    "transition_type": "IMMEDIATE"
  }
}
```

#### 2. Mensaje de Sincronización de Compás y Tempo (`TICK_SYNC`)
```json
{
  "event": "TICK_SYNC",
  "session_id": "ses_domingo_2026_09",
  "timestamp_utc_ms": 1790401200500,
  "payload": {
    "current_measure": 33,
    "beat": 1,
    "bpm": 74,
    "is_playing": true
  }
}
```

#### 3. Mensaje de Transposición en Vivo (`KEY_OVERRIDE`)
```json
{
  "event": "KEY_OVERRIDE",
  "session_id": "ses_domingo_2026_09",
  "payload": {
    "song_id": "song_gracia_sublime",
    "new_key": "D_MAJOR",
    "semitones_offset": -2
  }
}
```

---

## 6. Sincronización de Reloj y Resiliencia de Red

### Algoritmo de Sincronización de Reloj (NTP Ligero en Web):
Para compensar la latencia variable de las redes Wi-Fi congregacionales:
1. El cliente envía un ping periódico de sincronización con timestamp local $t_0$.
2. El servidor responde con su timestamp $t_1$ y el cliente registra la recepción en $t_2$.
3. Latencia de ida y vuelta: $RTT = (t_2 - t_0)$.
4. Desfase de reloj local estimado: $\theta = t_1 - (t_0 + RTT / 2)$.
5. Los eventos de compás se programan con relación al tiempo compensado, garantizando que el resaltado visual ocurra al unísono en todos los dispositivos con una discrepancia menor a **15 milisegundos**.

### Mecanismo de Reconexión Silenciosa (*Silent Backoff & Reconnect*):
- Si la conexión Wi-Fi sufre micro-cortes, el cliente no despliega alertas invasivas ni bloquea la vista de la partitura.
- Muestra un indicador ámbar discreto en la esquina inferior.
- Aplica reconexión con retroceso exponencial (*Exponential Backoff with Jitter*).
- Al reconectarse, solicita el último estado canónico (*Full State Snapshot*) y sincroniza la canción y compás actual sin parpadeo.
