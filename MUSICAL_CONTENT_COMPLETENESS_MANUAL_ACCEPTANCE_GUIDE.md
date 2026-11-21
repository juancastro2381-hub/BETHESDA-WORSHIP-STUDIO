# MUSICAL CONTENT COMPLETENESS — MANUAL ACCEPTANCE GUIDE
## Bethesda Worship Studio

**Alcance:** Guía de validación manual en navegador para los 16 escenarios requeridos (sin pruebas automatizadas de navegador).

---

## Precondiciones
1. Backend y frontend activos (`http://localhost:5173`).
2. Usuario autenticado con rol `WORSHIP_LEADER` o `ADMIN` (y usuario `MUSICIAN` para validar RBAC).
3. Archivo MusicXML completo de prueba con melodía, letras (`<syllabic>`), acordes (`<harmony>`), tempo y compases.

---

## Escenarios de Validación Manual

1. **Importación de MusicXML completo:** Cargar un `.musicxml` válido con melodía, letra, acordes y compases desde el Centro de Ingesta / Completitud; verificar en `SongHeader` que título, tonalidad, tempo (BPM), métrica y total de compases coinciden con el archivo.
2. **Reconstrucción de letras:** Confirmar que sílabas `begin`/`middle`/`end`/`single` se muestran como palabras continuas legibles con espacios y saltos de verso intactos, sin líneas de metadatos (`Canción original de prueba`, `Tempo: 96 BPM`, etc.) mezcladas en los compases.
3. **Alineación de acordes y letra:** Verificar en **Cifrado con Letra** que cada acorde aparece sobre su compás/posición silábica real y sección correcta (`[Verso 1]`, `[Coro]`).
4. **Notación estándar (`PARTITURE`):** Seleccionar **Partitura** y confirmar pentagrama, clave, armadura, métrica, notas, silencios y letras alineadas sin errores de renderizado.
5. **Vista `CHORDS WITH LYRICS`:** Seleccionar **Cifrado con Letra** y verificar legibilidad y transposición/capo en tiempo real.
6. **Vista `LYRICS ONLY`:** Seleccionar **Letra Sola** y confirmar que **no** aparecen acordes sobre el texto y que se muestran todas las secciones verificadas disponibles.
7. **Tablatura de guitarra (`TABLATURE`):** Seleccionar Guitarra Acústica/Eléctrica y confirmar digitaciones ergonómicas sin saltos absurdos a traste `0` ni trastes fuera de rango (`0..20/22`).
8. **Cambio de instrumento:** Cambiar entre Guitarra, Bajo (4 cuerdas) y Piano; verificar que Piano deshabilita `TABLATURE` con explicación clara y Bajo calcula digitación en 4 cuerdas (`E1-A1-D2-G2`).
9. **Persistencia de formato preferido:** Guardar un formato preferido; navegar a otra canción sin notas y confirmar que la preferencia se conserva con aviso explicativo sin sobrescribirse.
10. **Archivo solo de acordes:** Abrir una obra con solo cifrado (ChordPro) y confirmar que **Partitura** y **Tablatura** permanecen deshabilitados (`MISSING_CONTENT`) sin fabricar melodía.
11. **Archivo sin letras:** Abrir una canción instrumental/MIDI sin letras y confirmar que **Cifrado con Letra** y **Letra Sola** muestran `MISSING_CONTENT` con acción para agregar letra.
12. **Tablatura incompleta / fuera de rango:** Probar notas fuera del diapasón de Bajo o sin instrumento de cuerda; confirmar que el sistema advierte el rango sin inventar posiciones `0.1`.
13. **Consistencia de metadatos:** Verificar en `SongHeader`, selector de versiones y modales de catálogo que una misma versión muestra exactamente el mismo BPM, tonalidad, métrica y conteos (con etiqueta `(Audio)` si proviene de Audio Scope 1C).
14. **Ausencia total de reproductor de audio:** Confirmar en el **Atril Digital**, **Centro de Conversión** e **Inventario Offline** que no existe ningún reproductor `<audio>`, botón play/pause, barra de tiempo ni estado de streaming.
15. **Preservación de ingesta privada y Audio Scope 1C:** En Centro de Conversión, verificar que subir un audio privado, analizar con worker Python v2 y revisar/aprobar el borrador sigue operativo mostrando nombre de archivo y SHA-256 para auditoría.
16. **Preservación de versiones aprobadas:** Confirmar en el selector de versiones de *El Señor Esta en Este Lugar* (y cualquier canción con múltiples versiones) que las versiones `v1`, `v2`, `v(N)` anteriores permanecen intactas.
