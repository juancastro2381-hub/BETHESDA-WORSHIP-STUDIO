# BETHESDA WORSHIP STUDIO
## Documento 01: Visión del Producto, Principios, Personas y Arquitectura UX

---

### Organización Patrocinadora y Contexto
- **Organización:** Iglesia Cristiana Bethesda
- **Ubicación:** Madrid, Cundinamarca, Colombia
- **Público Objetivo Inicial:** Equipo de alabanza, directores musicales, instrumentistas, vocalistas, arreglistas y directores técnicos de la congregación.
- **Visión de Escalamiento:** Plataforma modular multi-inquilino (*multi-tenant*) para ministerios de adoración a nivel nacional e internacional.

---

## 1. Visión Central del Producto

**Bethesda Worship Studio** nace para erradicar la fricción técnica y logística que experimentan los ministerios de música sacra en sus fases de preparación, ensayo y ejecución en vivo.

El producto no es un simple "lector pasivo de PDFs" ni un visualizador estático de acordes. Es una **plataforma integrada de tecnología musical para el ministerio de adoración** que unifica:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        BETHESDA WORSHIP STUDIO                         │
│                                                                        │
│   Partituras Digitales Dinámicas  +  Cifrados Armónicos Flexibles      │
│   Letras Estructuradas en Sílabas +  Tablaturas Interactivas           │
│   Composición y Arreglos          +  Gestión Inteligente de Setlists   │
│   Modo Ensayo Multitrack/Audio    +  Sincronización en Vivo (Director) │
└────────────────────────────────────────────────────────────────────────┘
```

### Propósito Fundamental
Permitir que un equipo heterogéneo (desde el voluntario que solo lee acordes básicos en su teléfono hasta el pianista de conservatorio que requiere notación completa a dos manos, pasando por el saxofonista tenor que requiere transposición automática a Si bemol) acceda a **la misma fuente canónica de la canción**, adaptada instantáneamente a su rol, instrumento y nivel técnico.

---

## 2. Principios de Producto y Experiencia de Usuario (UX)

### Principio Cardinal 1:
> **"La complejidad de la tecnología musical debe residir dentro del motor del sistema, nunca en la experiencia del usuario."**

Un músico en el altar o en un ensayo nunca debe verse obligado a entender conceptos como:
- Estructuras XML de MusicXML o esquemas MEI.
- Canales, mensajes CC y eventos delta de MIDI.
- Algoritmos de enarmonía musical o quintas disminuidas.
- Protocolos de renderizado SVG/Canvas ni buffers de Web Audio API.
- Migraciones de bases de datos o endpoints REST/WebSocket.

Las tareas comunes deben lucir triviales. La potencia avanzada debe descubrirse de manera progresiva.

### Principio Cardinal 2: Lenguaje Músico-Centrado, No Tecnológico
- ❌ **Evitar:** "Seleccione el motor de renderizado de notación vectorial".
-  **Preferir:** "¿Cómo quieres ver la canción hoy?"
- ❌ **Evitar:** "Ejecutar transposición cromática +2 semitonos con preservación diatónica".
-  **Preferir:** "Tonalidad: [ - ] Sol Mayor [ + ]"
- ❌ **Evitar:** "Subir payload MusicXML / multipart form-data".
-  **Preferir:** "Importar partitura existente".

### Principio Cardinal 3: Desacoplamiento Absoluto entre Instrumento y Vista
- Un instrumento **no es** una vista.
- La guitarra eléctrica puede verse como Cifrado, Partitura, Tablatura, Partitura + Tablatura, o solo Letra con Acordes.
- El usuario siempre es el dueño de cómo consume la música.

### Principio Cardinal 4: Confiabilidad en Escenario ("No Crash, No Panic")
- En vivo, un fallo de UI puede arruinar un momento de adoración congregacional.
- Cero ventanas emergentes (*modals*) no solicitadas en modo interpretación.
- Cero bloqueos por falta de conexión: arquitectura **Offline-First**.
- Bloqueo de reposo de pantalla (*Wake Lock API*) automático durante el culto.

---

## 3. Arquetipos de Usuario (User Personas)

La congregación cuenta con músicos de diversa formación técnica. El diseño cubre los 11 roles identificados:

| ID | Rol | Nivel Técnico Musical | Dispositivo Principal | Vista Primaria Habitual | Necesidad Crítica en Vivo |
|:---|:---|:---|:---|:---|:---|
| **P-01** | **Vocalista / Líder de Canto** | Básico a Medio | Smartphone (iOS/Android) | Letra + Cifrado grande o Solo Letra | Texto extragrande, cambio de tono instantáneo, resaltado de estrofa actual. |
| **P-02** | **Guitarrista Acústico / Eléctrico** | Medio a Avanzado | Tablet de 10" / Móvil | Partitura + Tablatura o Cifrado + Diagramas | Indicador de Capo (*Cejilla*), digitación de acordes no estándar, tablatura clara. |
| **P-03** | **Bajista** | Medio | Tablet de 10" | Partitura + Tablatura o Cifrado de paso | Notación de bajo eléctrico (clave de Fa), walking bass y líneas rítmicas. |
| **P-04** | **Pianista Principal** | Avanzado / Clásico | Tablet de 12.9" / Laptop | Partitura Gran Pentagrama (Sol y Fa) + Cifrado | Precisión armónica, inversiones, líneas melódicas obligadas, cambio de tonalidad real en pentagrama. |
| **P-05** | **Tecladista / Sintetizadores** | Medio a Avanzado | Tablet / Teclado montado | Partitura guía + Cifrado + Notas de Patch | Marcaciones de intro, riffs de sintetizador, pads y transiciones. |
| **P-06** | **Baterista** | Medio a Avanzado | Tablet en soporte de batería | Notación de Percusión + Estructura de Secciones | Cero clutter melódico: kick, snare, hi-hat, dinámicas (p/f), cambios de compás, tempo BPM visual. |
| **P-07** | **Saxofonista (Alto Eb / Tenor Bb)** | Medio a Profesional | Tablet vertical | Partitura con Transposición Instrumental | Tonalidad escrita transpuesta automáticamente sin alterar el tono de concierto de la banda. |
| **P-08** | **Otros Instrumentos (Violín, Flauta, Trompeta)** | Medio a Profesional | Tablet / Stand de atril | Partitura Melódica en Clave de Sol / Cifrado | Melodías solistas, dinámicas, articulaciones claras. |
| **P-09** | **Director Musical (MD)** | Profesional | Tablet Pro / Laptop | Vista Director Multicapa + Control Setlist | Control de tiempo real: disparar secciones (Coro, Puente), marcar cuenta regresiva (*cue*), setlist dinámico. |
| **P-10** | **Compositor / Arreglista** | Profesional | Computador de escritorio / Web | Editor Musical Nivel 2 y 3 (Notación y Partes) | Edición polifónica, compases, armonización, exportación MusicXML, arreglos específicos para Bethesda. |
| **P-11** | **Administrador del Sistema** | Técnico / Pastoral | Web de escritorio | Panel de Gestión | Permisos, gestión de miembros, auditoría, respaldos, aislamiento de datos. |

---

## 4. Recorridos del Usuario (User Journeys)

### Recorrido A: El Culto Dominical en Vivo (Guitarrista - Escenario)
1. **Acceso Rápido:** Abre la app PWA en su tablet conectada al atril.
2. **Reconocimiento:** El sistema detecta el servicio activo: *"Culto Dominical - 10:00 AM"*. Un botón prominente dice: **"Entrar al Culto"**.
3. **Carga Inteligente:** La app abre la primera canción con su configuración predeterminada: *Guitarra Eléctrica, Partitura + Tablatura, Modo Oscuro, Letra activa*.
4. **Sincronización:** El Director Musical decide en vivo saltar del Coro 2 directamente al Puente: la pantalla del guitarrista resalta visualmente el Puente de manera sutil e inequívoca sin interrumpir su lectura.
5. **Transposición de Emergencia:** La voz principal solicita bajar medio tono (de Fa a Mi). El director o el músico toca `[ - ]` y toda la tablatura, acordes y pentagrama se recalculan matemáticamente en milisegundos.

### Recorrido B: Ensayo Semanal (Vocalista y Director)
1. **Preparación en Casa:** El vocalista abre la app en su móvil; escucha la pista de referencia integrada y sigue la letra con acordes grandes.
2. **Ensayo Presencial:** El Director Musical activa el **Modo Ensayo**.
3. **Bucle de Sección:** El equipo necesita practicar el paso rítmico del Pre-Coro al Coro: el MD selecciona *"Repetir compases 17 al 24"* con metrónomo y cuenta previa de 4 pulsos (*count-in*).
4. **Resaltado y Audio:** Todos los músicos ven correr el cursor de compás de manera sincronizada.

### Recorrido C: Creación y Arreglo de Canción Nueva (Arreglista)
1. **Entrada Simple:** Pulsa `+ Nueva canción`.
2. **Ingesta:** Selecciona *"Tengo una partitura"* y sube un archivo `.musicxml` de una alabanza contemporánea.
3. **Procesamiento Silencioso:** El sistema analiza compases, tonalidad, voces e instrumentos sin abrumar con logs técnicos.
4. **Creación de Arreglo Bethesda:** Crea la versión *"Arreglo Acústico Noche de Adoración"*, silenciando instrumentos de viento y adaptando el cifrado para piano acústico y cuerdas.
5. **Publicación al Repertorio:** El arreglo queda disponible para el equipo con aprobación inmediata.

---

## 5. Arquitectura de Experiencia de Usuario y Divulgación Progresiva

Para conciliar la potencia profesional con la extrema facilidad de uso, Bethesda Worship Studio implementa **Tres Niveles de Profundidad Operativa**:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   NIVEL 1: USO RÁPIDO Y EJECUCIÓN                     │
│  - Ver canción, transponer, elegir vista, reproducir metrónomo, setlist │
│  - Audiencia: 100% de los usuarios. Cero barrera de entrada.          │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                  NIVEL 2: EDICIÓN MUSICAL Y ESTRUCTURA                 │
│  - Ajustar letra/acordes, reordenar secciones, modificar compases/BPM  │
│  - Audiencia: Músicos líderes, directores de alabanza.                 │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│               NIVEL 3: COMPOSICIÓN Y ARQUITECTURA NOTACIONAL           │
│  - Edición polifónica de notas, articulaciones, SMuFL, MusicXML, MIDI │
│  - Audiencia: Arreglistas, compositores, directores musicales.         │
└────────────────────────────────────────────────────────────────────────┘
```

### Regla de Oro de Interfaz:
Ningún control de Nivel 2 o Nivel 3 debe invadir la pantalla principal de interpretación en vivo. El modo en vivo está blindado contra elementos distractores o clics accidentales.

---

## 6. Arquitectura de Información (IA) y Mapa de Navegación

El mapa de navegación del sistema se organiza en 4 áreas fundamentales:

```
[BETHESDA WORSHIP STUDIO]
├── 1. VIVO & REPERTORIO
│   ├── Culto Activo (Sesión en vivo de hoy)
│   ├── Setlists (Listas de alabanzas para servicios)
│   │   ├── Detalle de Setlist
│   │   ├── Modo Performance / Atril
│   │   └── Modo Ensayo
│   └── Cancionero / Biblioteca
│       ├── Vista de Canción (Interpretación)
│       └── Búsqueda rápida (por Tonalidad, BPM, Etiqueta, Letra)
│
├── 2. CREACIÓN & ARREGLOS (+ Nueva Canción)
│   ├── Tengo una partitura (MusicXML / PDF / Imagen)
│   ├── Tengo letra y acordes (Texto / ChordPro)
│   ├── Tengo un archivo MIDI
│   ├── Tengo un audio (Transcripción asistida)
│   └── Crear desde cero (Lienzo en blanco)
│
├── 3. MI PERFIL MUSICAL (Smart Defaults)
│   ├── Mi Instrumento Principal y Secundario
│   ├── Mi Vista Favorita por Instrumento
│   ├── Preferencias de Notación (Tamaño, Cifrado Latino vs Americano)
│   └── Configuración de Escenario (Modo Oscuro forzado, Keep Awake)
│
└── 4. ADMINISTRACIÓN & EQUIPO (Solo Roles Autorizados)
    ├── Directorio de Músicos y Roles
    ├── Auditoría y Versiones
    └── Configuración de la Congregación
```

---

## 7. Arquitectura UX para Móvil y Escenario (Mobile-First Performance UX)

La experiencia sobre el atril en el altar exige estándares ergonómicos extremos:

### Ergonomía Visual en Iluminación de Altar
- **Contraste Dinámico:** Fondo negro puro (`#0a0a0c`) con texto blanco marfil (`#f4f4f6`) y acordes en ámbar cálido (`#f59e0b`) o cian suave (`#38bdf8`) para evitar fatiga ocular bajo luces robóticas y oscuridad.
- **Tamaño de Toque Mínimo:** Todos los botones en vivo tienen un área táctil mínima de **48x48 px** (estándar WCAG 2.2 AAA para movilidad reducida o dedos en atril distante).
- **Tipografía Musical Optimizada:** Familias tipográficas con números monoespaciados y glifos armónicos sin ambigüedad tipográfica (evitar confusión entre `B`, `Bb` y `8`, o entre `m` y `M`).

### Funcionalidades de Asistencia Escénica
1. **Auto-Scroll Inteligente:** Desplazamiento vertical fluido vinculado al tempo (BPM) y al compás real de la canción, con aceleración suave durante transiciones y pausa manual inmediata ante cualquier toque del músico.
2. **Resaltado de Sección y Compás Actual:** Borde sutil iluminado en la sección en curso (ej. *[Puente 1]*), permitiendo que un músico que levanta la vista hacia la congregación regrese a la pantalla y ubique su posición en menos de 200 milisegundos.
3. **Control de Pedales Bluetooth / USB:** Soporte nativo para pedales de pie estándar (AirTurn, PageFlip, Donner) enviando códigos de tecla estándar (`PageDown`, `ArrowRight`) para cambio de página sin manos.
4. **Fila de Acciones de Emergencia en Vivo:**
   - Botón de Transposición Rápida `[-] [Tono] [+]`.
   - Botón de Vista Rápida (conmutar entre Partitura y Cifrado con 1 solo toque).
   - Indicador de Conexión en Vivo con semáforo silencioso (Verde = Sincronizado con MD, Amarillo = Autónomo/Offline).
