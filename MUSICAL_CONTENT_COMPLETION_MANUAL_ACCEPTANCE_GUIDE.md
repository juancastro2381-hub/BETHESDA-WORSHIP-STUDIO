# MUSICAL CONTENT COMPLETION MANUAL ACCEPTANCE GUIDE
## Bethesda Worship Studio — Escenarios de Aceptación Manual en Navegador

**Alcance:** Validación manual end-to-end en navegador del Atril Digital y el Asistente de Completitud Musical (`FormatCompletionWizardModal`), sin pruebas automatizadas de navegador y preservando la integridad del activo real Scope 1C (*El Señor Esta en Este Lugar*).

---

## Precondiciones del Entorno

1. Backend corriendo en desarrollo/local con migraciones aplicadas y worker Python saludable.
2. Frontend Vite activo (`http://localhost:5173`).
3. Dos cuentas de prueba disponibles:
   - **Cuenta Músico (`MUSICIAN`)**: puede proponer borradores y validar vistas previas, pero no debe ver botones para aprobar/publicar al catálogo oficial.
   - **Cuenta Director / Admin (`WORSHIP_LEADER` o `ADMIN`)**: puede crear propuestas y aprobar/rechazar publicaciones a versión `v(N+1)`.
4. **Precaución sobre datos de producción/prueba del Owner:** si desea probar escrituras o aprobaciones sin alterar el estado histórico actual de *El Señor Esta en Este Lugar*, utilice una canción clonada o una nueva canción Lead Sheet de prueba en el catálogo (o verifique el historial de versiones `v1`, `v2`, `v3`... que confirma que las versiones anteriores nunca se sobrescriben).

---

## Escenario Manual 1 — Canción Derivada de Audio (Solo Acordes, sin Melodía ni Letra)

1. Iniciar sesión e ir al **Atril Digital** con una canción que posea únicamente acordes armónicos (`ChordEvent`) derivados de audio.
2. Observar el bloque **«Formato de Lectura de Atril (Selección del Músico)»**:
   - **Resultado esperado:** Los 4 botones (`Partitura`, `Cifrado con Letra`, `Letra Sola`, `Tablatura`) muestran su estado real (`MISSING_CONTENT`) con la explicación concreta de qué falta en cada uno (ej. falta de notas melódicas reales para `Partitura`/`Tablatura`, falta de letra verificada para `Cifrado con Letra` y `Letra Sola`).
   - El selector nunca fabrica notas ni habilita tablatura desde símbolos de acordes aislados.
   - Debajo aparece la sección **«🧩 Completar información musical faltante para habilitar más formatos (sin fabricación artificial)»** con botones de acción directa por cada formato incompleto.

---

## Escenario Manual 2 — Conservación de Preferencia Guardada no Disponible

1. Guardar `Partitura` (`STANDARD_NOTATION`) como formato preferido en una canción que sí tenga melodía (usando **«Guardar como preferencia»**).
2. Cambiar a una canción que solo tenga acordes y letra (sin notas melódicas).
3. **Resultado esperado:**
   - Aparece el banner de separación preferencia vs disponibilidad informando que la preferencia guardada (`STANDARD_NOTATION`) se conserva intacta, aunque esta canción muestra temporalmente la representación disponible compatible.
   - El botón `Partitura` aparece deshabilitado con su explicación de contenido faltante.
4. Volver luego a la canción con partitura: la preferencia `Partitura` sigue recordada y se aplica automáticamente.

---

## Escenario Manual 3 — Flujo de Letra (Sin Alinear vs Alineada vs Verificación de Voz)

1. Abrir el asistente en **«📝 Letra Sola»** o **«🎸 Cifrado con Letra»** mediante la botonera contextual.
2. Seleccionar origen **Texto de letra** y marcar **Sin alinear (`UNALIGNED`)** si desea almacenar letra borrador sin ubicar en compases.
   - **Resultado esperado:** Al pulsar **«🔍 Validar y Previsualizar»**, el servidor reporta `CHORD_CHART` en estado `INCOMPLETE` (`LYRICS_AVAILABLE_NOT_ALIGNED`), manteniendo bloqueado `Cifrado con Letra` hasta alinear.
3. Cambiar origen a **Transcripción automática no verificada (`UNVERIFIED_AUDIO_SPEECH`)** manteniendo desmarcada la confirmación humana.
   - **Resultado esperado:** El formato queda en `REVIEW_REQUIRED` y no se habilita `LYRICS_ONLY` ni `CHORD_CHART` sin confirmación humana explícita.
4. Elegir **«Alineado por compás / sección (`BY_MEASURE`)»** con fuente `MANUAL_ENTRY` o `TXT_IMPORT`, ingresar versos reales y activar confirmación humana.
5. Pulsar **«🔍 Validar y Previsualizar»**, revisar el conteo de compases/sílabas y pulsar **«💾 Guardar Borrador / Enviar a Revisión»**.
   - **Resultado esperado:** Se registra una propuesta `PENDING_REVIEW` vinculada al `sourceHash` SHA-256 sin modificar la versión actual publicada en el atril.

---

## Escenario Manual 4 — Flujo de Partitura (`MusicXML` / `MIDI` / `Notas Manuales`) + Rechazo de Fuentes Inválidas

1. En el asistente **«🎼 Partitura»**, intentar enviar un archivo MIDI falso (p. ej. texto renombrado `.mid`) o XML malformado, o pulsar previsualizar sobre una partitura sin notas.
   - **Resultado esperado:** El servidor rechaza con alerta clara (`ValidationError` / cabecera `MThd` inválida o ausencia de notas reales) sin crear propuesta ni contaminar el atril.
2. Cargar un archivo válido `.musicxml` o `.mid`, o transcribir notas en **«Transcribir Notas Manuales»** (ej. compás 1, `C4`, `quarter`, `G4`, `quarter`).
3. Pulsar **«🔍 Validar y Previsualizar»** y luego **«💾 Guardar Borrador / Enviar a Revisión»**.
   - **Resultado esperado:** El audio original preservado de la canción sigue disponible en la cabecera y el borrador espera revisión.

---

## Escenario Manual 5 — Flujo de Tablatura (Fijar Cuerda/Traste con Capo e Instrumento)

1. Abrir la pestaña **«🪕 Tablatura»** sobre una canción con notas melódicas reales.
2. Cambiar el instrumento de tablatura a **Piano** (o un perfil sin diapasón) desde el selector del atril:
   - **Resultado esperado:** `TABLATURE` queda bloqueado/faltante explicando que requiere instrumento de cuerda con afinación definida.
3. Volver a **Guitarra Acústica (6 cuerdas)** o **Bajo Eléctrico (4 cuerdas)** en el asistente de Tablatura (`EXISTING_NOTES_FRET_OVERRIDE`).
4. Para una nota con múltiples digitaciones posibles (`⚠️ (múltiples digitaciones)`), seleccionar una posición válida alternativa (p. ej. `E4` en `Cuerda 2 • Traste 5` en Guitarra estándar con Capo 0), marcar **«He revisado y validado las posiciones...»**, validar y guardar borrador.
5. Tras aprobación, activar vista **Tablatura** en el Atril Digital:
   - **Resultado esperado:** El renderizado muestra la cuerda y el traste exactos elegidos por el humano (`2` / `5`), no una heurística que contradiga la digitación verificada.

---

## Escenario Manual 6 — Persistencia de Borrador sin Guardar al Volver al Atril

1. Abrir el **Asistente de Completitud Musical**, escribir notas de revisión o texto en el editor de letra sin pulsar aún **Guardar Borrador**.
2. Pulsar **«↩️ Volver al Atril Digital»**.
3. Consultar visualmente el atril y volver a abrir el asistente sobre la misma canción.
   - **Resultado esperado:** Todos los campos introducidos permanecen intactos en el modal hasta que el usuario guarde la propuesta o cambie de canción.

---

## Escenario Manual 7 — Separación RBAC y Versionado No Destructivo

1. Como usuario **`MUSICIAN`**: abrir una canción con propuesta `PENDING_REVIEW` en el asistente.
   - **Resultado esperado:** Se muestra el aviso `🔒 Aguardando revisión: solo un Director de Alabanza o Administrador puede aprobar y publicar al catálogo oficial.` y no aparecen botones de aprobación/publicación.
2. Cerrar sesión e iniciar sesión como **`WORSHIP_LEADER` o `ADMIN`**.
3. Abrir la misma canción y entrar al asistente:
   - **Resultado esperado:** Aparecen los botones **«✅ Aprobar y Publicar Nueva Versión (vN+1)»** y **«✕ Rechazar Propuesta»**.
4. Probar rechazar una propuesta errónea: confirmar que el estado pasa a `REJECTED` y la versión publicada vigente del atril **no cambia**.
5. Aprobar una propuesta válida: confirmar que se crea `v(N+1)`, se preserva intacta la versión anterior (`vN`) en el historial de versiones de la canción, se preserva el audio original (si existe) y el formato recién completado pasa inmediatamente a `APPROVED` / habilitado en el selector del Atril Digital.
