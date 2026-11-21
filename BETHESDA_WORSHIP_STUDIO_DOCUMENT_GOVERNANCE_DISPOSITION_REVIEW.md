# BETHESDA WORSHIP STUDIO — REVISIÓN DE CLASIFICACIÓN, GOBERNANZA DOCUMENTAL Y DISPOSICIÓN SEGURA POST-INCIDENTE

**Proyecto:** Bethesda Worship Studio  
**Repositorio:** `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO.git`  
**Naturaleza de la tarea:** Auditoría estrictamente de solo lectura sobre clasificación de gobernanza documental y estrategia segura post-incidente  
**Rama local activa:** `feature/phase-1a-core-foundation`  
**HEAD verificado en tiempo real:** `953bb61272b15df8ba29a9b4c795097d66760cdb` *(diferencia crítica respecto al contexto histórico citado en la solicitud: ver Sección 2)*  
**Estado de autorización `WS-R2.0`:** **`NO AUTORIZADO`** *(pendiente de firmas y compuertas `GATE 1` / `GATE 2`)*

> **Convención epistémica obligatoria en este documento:** Cada afirmación relevante distingue explícitamente entre **`[HECHO VERIFICADO]`** (observado directamente mediante comandos Git, inspección de árbol/archivos y hashes SHA-256 en esta sesión), **`[EVIDENCIA HISTÓRICA]`** (estado o cifra registrada en reportes de momentos anteriores), **`[RECOMENDACIÓN]`** (propuesta técnica no ejecutada sujeta a decisión del Project Owner) y **`[SUPUESTO NO VERIFICADO]`** (elemento externo no comprobable en esta auditoría).

---

## 1. Resumen Ejecutivo

- **`[HECHO VERIFICADO]` Descubrimiento crítico previo a cualquier decisión de ramas:** Aunque el contexto inicial de la solicitud situaba `feature/phase-1a-core-foundation` en `765a6312780ae155be3be7b2e19cbebbb56856c5` con los 6 documentos sin confirmar en el árbol de trabajo, la verificación en vivo demuestra que el **`2026-11-21 17:58:43 -0500`** el commit **`953bb61272b15df8ba29a9b4c795097d66760cdb`** (*`PHASE R2.0 LOCAL DOCUMENT PRESERVATION AND GIT SAFETY CHECKPOINT`*, autor `juancastro2381-hub`) **confirmó y empujó los 6 documentos** (`6 files changed, 735 insertions(+), 1 deletion(-)`) hacia `feature/phase-1a-core-foundation` y `origin/feature/phase-1a-core-foundation`.
- **`[HECHO VERIFICADO]` Estado actual frente a `main`:** `main` y `origin/main` permanecen intactos en `97ae7c6039aa208beb5a64c6592fba0085ba0d1d` (*Merge pull request `#1`*). En consecuencia, `feature/phase-1a-core-foundation` está ahora **`1` commit por delante (`953bb612`) y `1` commit por detrás (`97ae7c60`)** respecto a `main`; los 6 cambios documentales existen en `origin/feature/phase-1a-core-foundation`, **pero aún NO están en `main`**.
- **`[HECHO VERIFICADO]` Árbol de trabajo e índice limpios:** Antes de generar este nuevo reporte de revisión (`BETHESDA_WORSHIP_STUDIO_DOCUMENT_GOVERNANCE_DISPOSITION_REVIEW.md`), `git status -uall --porcelain=v1`, `git diff --cached --name-status` y `git diff --stat` estaban completamente vacíos (`0` modificaciones locales sin confirmar sobre código, base de datos, migraciones o documentación).
- **`[HECHO VERIFICADO]` Respaldo externo íntegro para los 5 documentos iniciales:** En `C:\Users\Public\Documents\BETHESDA_WORSHIP_STUDIO_LOCAL_DOCS_BACKUP_20261121` existen copias byte a byte con coincidencia SHA-256 exacta (`BACKUP_MATCH=True`) para los documentos `#1`–`#5`. El documento `#6` (`LOCAL_DOCUMENT_PRESERVATION_CHECKPOINT.md`) **no está** dentro de dicha carpeta externa (`IN_BACKUP=False`), ya que fue generado después de copiarse los 5 anteriores.
- **`[RECOMENDACIÓN]` Síntesis de clasificación para promoción a `main` y retención en gobernanza:**
  - **`A. RECOMMENDED FOR GIT — PROJECT GOVERNANCE` (`2` documentos):** `#1 UPDATED_TRACEABILITY_AND_ACCEPTANCE_MATRIX.md` y `#2 WS_R2_0_PROJECT_OWNER_DECISION_REGISTER_AND_REMEDIATION_EXECUTION_PLAN.md`.
  - **`B. RECOMMENDED FOR GIT — INCIDENT HISTORY` (`3` documentos):** `#3 GIT_REVERT_INCIDENT_DIAGNOSTIC_REPORT.md`, `#4 GIT_SAFE_RECOVERY_REPORT.md` y `#5 POST_REVERSAL_RECONCILIATION_AUDIT.md` (idealmente consolidados bajo una ruta estructurada de historial de incidentes/auditorías antes de seguir acumulando archivos en la raíz del repositorio, donde ya existen `124` `.md`).
  - **`D. REQUIRES PROJECT OWNER DECISION` (`1` documento):** `#6 LOCAL_DOCUMENT_PRESERVATION_CHECKPOINT.md` (con orientación consultiva hacia **`C. EXTERNAL ARCHIVE ONLY`** para efectos de promoción a `main`, dado que ya quedó preservado en el historial de `953bb612`, contiene rutas locales específicas de la estación de trabajo como `C:\Users\juanc\.git` y `C:\Users\Public\Documents\...`, y aún no ha sido copiado al respaldo externo).
- **`[HECHO VERIFICADO]` Remediación `WS-R2.0` no autorizada:** Las decisiones `POD-01` a `POD-05` y la compuerta `GATE 2` siguen sin firma ni aprobación. No debe iniciarse ninguna remediación técnica hasta completar el registro de decisiones.

---

## 2. Estado Verificado del Repositorio

### 2.1 Comparativa entre Contexto Citado y Evidencia Verificada en Vivo

| Parámetro inspeccionado | Contexto citado en la solicitud | Evidencia verificada en vivo (`2026-11-21`) | Clasificación epistémica |
|---|---|---|---|
| **Rama activa local** | `feature/phase-1a-core-foundation` | `feature/phase-1a-core-foundation` | `[HECHO VERIFICADO]` |
| **`HEAD` / rama de desarrollo local y remota** | `765a6312780ae155be3be7b2e19cbebbb56856c5` | **`953bb61272b15df8ba29a9b4c795097d66760cdb`** (`Tree SHA: f3a4f7652bb29ecc19c10016fe788ec996aed4c2`); su padre inmediato es `765a6312780ae155be3be7b2e19cbebbb56856c5` | `[HECHO VERIFICADO]` |
| **Referencia `refs/pull/1/head` en vivo** | *(Merge PR `#1` previo)* | `765a6312780ae155be3be7b2e19cbebbb56856c5` | `[HECHO VERIFICADO]` |
| **Local `main` / `origin/main`** | `97ae7c6039aa208beb5a64c6592fba0085ba0d1d` | `97ae7c6039aa208beb5a64c6592fba0085ba0d1d` (`Tree SHA: 29f0e6862332a0eb0fb0b27b75c6cd197e54e00e`, `0 0` local vs remoto) | `[HECHO VERIFICADO]` |
| **Divergencia `feature/phase-1a-core-foundation` vs `main`** | Implícitamente `0 1` previo | **`1 1`** (`1` commit adelante = `953bb612`; `1` commit atrás = merge `97ae7c60`); diff `main..feature` = estrictamente los `6` `.md` (`735+ / 1-`) | `[HECHO VERIFICADO]` |
| **Rama remota de reversión (`refs/heads/revert-1-...`)** | Eliminada en remoto | Confirmada **ausente** en `git ls-remote origin` | `[HECHO VERIFICADO]` |
| **Referencia caché local de reversión** | No especificada como podada | `remotes/origin/revert-1-feature/phase-1a-core-foundation` (`766650c`) **aún presente** en `git branch -avv` | `[HECHO VERIFICADO]` |
| **Estado del árbol de trabajo (antes de crear este reporte)** | Documentos sin confirmar / sin seguimiento | **Limpio (`0` cambios):** todos los 6 archivos revisados ya están rastreados y confirmados en `953bb612` | `[HECHO VERIFICADO]` |
| **Estado del índice Git (`git diff --cached`)** | Sin confirmar | **Vacío (`0` cambios en *stage*)** | `[HECHO VERIFICADO]` |
| **Respaldo externo (`...\LOCAL_DOCS_BACKUP_20261121`)** | 5 documentos verificados por SHA-256 | **`5/5` presentes y coincidentes en SHA-256** (`#1`–`#5`); **`#6` ausente (`IN_BACKUP=False`)** | `[HECHO VERIFICADO]` |
| **Huella documental actual del repo** | No cuantificada | `124` archivos `.md` en raíz; `675` archivos en `docs/` (`audio`, `reports`, `test-files`, `user-guide`, `wp04`) | `[HECHO VERIFICADO]` |

### 2.2 Distinción Epistémica de Base

- **`[HECHO VERIFICADO]`:** Cero archivos de aplicación (`backend/`, `frontend/`, `workers/`), migraciones (`0001`–`0020`), dependencias o configuraciones cambiaron entre `765a6312`, `97ae7c60` y `953bb612`. La única diferencia real de contenido entre `main` (`97ae7c60`) y `feature/phase-1a-core-foundation` (`953bb612`) son exactamente los 6 documentos objeto de esta revisión.
- **`[EVIDENCIA HISTÓRICA]`:** El árbol de trabajo tuvo entre las `17:04` y las `17:55` del `2026-11-21` ediciones y reportes locales sin confirmar; esa situación histórica terminó cuando el commit `953bb612` consolidó los 6 documentos a las `17:58:43 -0500`.
- **`[SUPUESTO NO VERIFICADO]`:** No se han consultado vía API/web de GitHub reglas de protección de rama (*branch protection rules*), aprobaciones requeridas de PR ni la existencia de un PR `#2` abierto para `953bb612` (`gh` CLI no consultado / acceso de escritura remoto prohibido). Tampoco se han ejecutado compilaciones, pruebas ni consultas SQL contra PostgreSQL.

---

## 3. Inventario de Documentos (Tarea 1)

Tabla basada íntegramente en verificación en disco, índice Git, commit `953bb612` y contenido leído de cada archivo (`[HECHO VERIFICADO]`):

| # | Nombre exacto del archivo | Estado Git respecto a `HEAD` (`953bb612`) / vs `main` (`97ae7c60`) | ¿Rastreado? | ¿Modificado actualmente vs `HEAD`? | Tamaño actual (bytes) | SHA-256 verificado en disco | ¿En respaldo externo (`MATCH`)? | Naturaleza del documento | ¿Contiene información única y necesaria? |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `BETHESDA_WORSHIP_STUDIO_PHASE_R2_UPDATED_TRACEABILITY_AND_ACCEPTANCE_MATRIX.md` | Rastreado y limpio en `953bb612`; **modificado (`+2/-1` líneas) frente a `main`** | **Sí** | **No** *(limpio en `HEAD`; +2/-1 vs `main`)* | `41,573` | `17911F87628F91A4E25CB4CA0BB5A4D63D9FAE0A72C64005732FBDFB6535EAD6` | **Sí (`True`)** | Gobernanza activa / Matriz maestra de trazabilidad y aceptación | **Sí (Necesaria):** Matriz única de los `38` hallazgos (`R2-F01`–`R2-F38`), criterios y enlace al `HEAD` `765a6312` y Registro POD. |
| 2 | `BETHESDA_WORSHIP_STUDIO_PHASE_R2_WS_R2_0_PROJECT_OWNER_DECISION_REGISTER_AND_REMEDIATION_EXECUTION_PLAN.md` | Rastreado y limpio en `953bb612`; **nuevo (`+171`) frente a `main`** | **Sí** | **No** *(ausente en `main`)* | `26,654` | `CF2CB4EEA314D0DA9A8F83AA5ACDDA896C429D3CED8BF5AE2CE1C067686D898D` | **Sí (`True`)** | Documento de decisión actual y gobernanza operativa `WS-R2.0` | **Sí (Crítica/Necesaria):** Consolida casillas de aprobación `POD-01`–`POD-05`, plan `REM-01`–`REM-04` y compuertas `GATE 1`–`GATE 8`. |
| 3 | `BETHESDA_WORSHIP_STUDIO_GIT_REVERT_INCIDENT_DIAGNOSTIC_REPORT.md` | Rastreado y limpio en `953bb612`; **nuevo (`+107`) frente a `main`** | **Sí** | **No** *(ausente en `main`)* | `12,096` | `7BAF0067B687C67BBC76971A108DBF8F885242E5B43C330B9CD6DF08E4BDD05F` | **Sí (`True`)** | Histórico / Forense de incidente Git | **Sí (Única):** Único desglose exacto de `754` archivos / `132,410` eliminaciones y prueba `tree(36979be) == tree(766650c)`. |
| 4 | `BETHESDA_WORSHIP_STUDIO_GIT_SAFE_RECOVERY_REPORT.md` | Rastreado y limpio en `953bb612`; **nuevo (`+108`) frente a `main`** | **Sí** | **No** *(ausente en `main`)* | `8,209` | `ED3FB2C7737626EAC279AE3AE873B1C6128FD88B08B76C952DA086745A2B11DC` | **Sí (`True`)** | Histórico / Evidencia operativa de recuperación | **Sí (Única):** Log exacto del `git fetch origin main:main` (`36979be..97ae7c6`) sin *stash* y SHAs antes/después. |
| 5 | `BETHESDA_WORSHIP_STUDIO_POST_REVERSAL_RECONCILIATION_AUDIT.md` | Rastreado y limpio en `953bb612`; **nuevo (`+208`) frente a `main`** | **Sí** | **No** *(ausente en `main`)* | `23,024` | `14723E655536DC354869347431B9AB3D4636169889E9082B429847DE0DF03E02` | **Sí (`True`)** | Histórico / Auditoría de reconciliación y verificación | **Sí (Única):** Prueba `ls-remote` tras borrarse la rama de reversión, `21/21` archivos verificados y captura de discrepancia SHA. |
| 6 | `BETHESDA_WORSHIP_STUDIO_LOCAL_DOCUMENT_PRESERVATION_CHECKPOINT.md` | Rastreado y limpio en `953bb612`; **nuevo (`+139`) frente a `main`** | **Sí** | **No** *(ausente en `main`)* | `19,976` | `1FD07919B30A6AE81C8C15CF85679E4A095118F34D84872A3625AB554B57B917` | **No (`False`)** | Operacional puntual de estación de trabajo y cadena de custodia | **Mixta (Metadatos locales):** Aporta hashes SHA-256 del respaldo y hallazgo de `C:\Users\juanc\.git`, pero contiene rutas locales de PC. |

*(Nota: Este mismo informe generado ahora, `BETHESDA_WORSHIP_STUDIO_DOCUMENT_GOVERNANCE_DISPOSITION_REVIEW.md`, queda como único archivo `??` sin seguimiento tras finalizar el Paso 2.)*

---

## 4. Clasificación y Recomendación de Disposición (Tarea 2)

Cada documento recibe **exactamente una** clasificación recomendada de disposición, entendida en el contexto real actual donde todos ya figuran en el commit `953bb612` de `feature/phase-1a-core-foundation` y se evalúa su **promoción hacia `main` y ubicación definitiva en el repositorio** (`[RECOMENDACIÓN]` basada en `[HECHO VERIFICADO]`):

### 4.1 `BETHESDA_WORSHIP_STUDIO_PHASE_R2_UPDATED_TRACEABILITY_AND_ACCEPTANCE_MATRIX.md`
- **Clasificación asignada:** **`A. RECOMMENDED FOR GIT — PROJECT GOVERNANCE`**
- **Por qué debe permanecer y promoverse a `main`:** Actualiza el `Verified HEAD SHA` (`d935344` → `765a6312`) de la matriz maestra ya existente en `main` y la conecta directamente con el Registro de Decisiones POD.
- **¿Duplica otro documento?** No en su contenido medular; referencia al Registro POD (`#2`) sin replicar su texto completo.
- **¿Es esencial para el desarrollo futuro?** **Sí.** Es la matriz de aceptación oficial para las fases `WS-R2.0` a `WS-R2.6` (`R2-F01`–`R2-F38`).
- **¿Debe conservarse permanentemente?** **Sí**, en el repositorio como matriz viva de trazabilidad de Fase R2.
- **Riesgos de promoverlo a `main`:** Bajo. Riesgo menor: si se edita en Windows con CRLF inconsistente respecto a LF originales (`LF -> CRLF` reportado antes), conviene mantener finales de línea consistentes (`+2/-1` ya quedó normalizado en `953bb612`); además contiene enlaces `file:///c:/Users/juanc/...` absolutos de escritorio que ya existían previamente en `main`.

### 4.2 `BETHESDA_WORSHIP_STUDIO_PHASE_R2_WS_R2_0_PROJECT_OWNER_DECISION_REGISTER_AND_REMEDIATION_EXECUTION_PLAN.md`
- **Clasificación asignada:** **`A. RECOMMENDED FOR GIT — PROJECT GOVERNANCE`**
- **Por qué debe permanecer y promoverse a `main`:** Es el único documento consolidado que integra en un mismo punto las **5 decisiones pendientes `POD-01`–`POD-05`**, el blueprint técnico exacto de **`REM-01`–`REM-04`** (con controles anti-contaminación de BD) y la tabla de **8 compuertas (`GATE 1`–`GATE 8`)**.
- **¿Duplica otro documento?** Parcialmente. Condensa decisiones y planes de 3 reportes ya en `main` (`WS_R2_0_FINAL_CERTIFICATION_AND_BLOCKERS_REPORT`, `WS_R2_0_REMEDIATION_PLAN`, `OWNER_DECISION_ANALYSIS_POD_01_POD_05`), pero añade valor integrador insustituible: casillas formales de firma y la secuencia ejecutable por compuertas.
- **¿Es esencial para el desarrollo futuro?** **Sí.** Sin su aprobación firmada y registro de decisiones, no puede abrirse válidamente `WS-R2.0`.
- **¿Debe conservarse permanentemente?** **Sí**, y actualizarse/firmarse únicamente cuando el Project Owner emita sus resoluciones formales.
- **Riesgos de promoverlo a `main`:** **Moderado si se interpreta mal su línea 21 o si se olvida que está sin firmar.** En la línea 21 indica `Pre-Action Working Tree: Clean` (referido al instante previo a su creación) y en sus secciones `POD` las casillas siguen en blanco; existe riesgo de que un lector asuma erróneamente que `POD-01`–`POD-05` están aprobados si no lee las advertencias `RECOMMENDATION ONLY — Not Approved`, y expone enlaces `file:///c:/Users/juanc/...`.

### 4.3 `BETHESDA_WORSHIP_STUDIO_GIT_REVERT_INCIDENT_DIAGNOSTIC_REPORT.md`
- **Clasificación asignada:** **`B. RECOMMENDED FOR GIT — INCIDENT HISTORY`**
- **Por qué debe permanecer y promoverse como historia de incidente:** Documenta la evidencia forense exacta del incidente del `2026-11-21` (PR `#1`, reversión `766650c` a los `67` segundos, `754` archivos / `132,410` líneas que se habrían borrado, equivalencia matemática de árboles).
- **¿Duplica otro documento?** Poco. Aunque `#4` y `#5` resumen el incidente en un párrafo, ninguno reproduce el desglose detallado de `754` archivos por subsistema.
- **¿Es esencial para el desarrollo futuro?** No para codificar funcionalidades, pero **sí muy valioso para gobernanza, auditoría y prevención** de errores futuros en GitHub PRs.
- **¿Debe conservarse permanentemente?** **Sí**, pero archivado dentro de una carpeta ordenada de incidentes (`docs/incidents/...`), **no** permanentemente suelto en la raíz.
- **Riesgos de promoverlo a `main`:** Bajo. Principal precaución: su estado de `main` (`36979be`) quedó históricamente superado por la recuperación posterior; sin un encabezado o ubicación en carpeta de incidentes, alguien podría leerlo fuera de contexto temporal. También incluye un enlace `file:///c:/Users/juanc/...`.

### 4.4 `BETHESDA_WORSHIP_STUDIO_GIT_SAFE_RECOVERY_REPORT.md`
- **Clasificación asignada:** **`B. RECOMMENDED FOR GIT — INCIDENT HISTORY`**
- **Por qué debe permanecer y promoverse como historia de incidente:** Es el registro auditable exacto de cómo se ejecutó `git fetch origin main:main` (`36979be..97ae7c6`) preservando archivos sin *stash* ni *force-push*.
- **¿Duplica otro documento?** Moderado. El resumen del incidente repite a `#3` y la tabla final coincide parcialmente con `#5`, pero los comandos exactos y justificación del método *fast-forward* sin *checkout* son únicos.
- **¿Es esencial para el desarrollo futuro?** No para programar características, pero **sí como antecedente operativo** ante futuras incidencias Git en el equipo.
- **¿Debe conservarse permanentemente?** **Sí**, dentro del historial de incidentes (`docs/incidents/...`).
- **Riesgos de promoverlo a `main`:** Bajo. En su sección `9 #3` dice `Remote Revert PR Still Present on GitHub (Action Pending)`, estado ya superado posteriormente cuando GitHub eliminó la rama. Asimismo expone rutas locales (`C:\Users\juanc\...` vs `C:\Users\juan\...`).

### 4.5 `BETHESDA_WORSHIP_STUDIO_POST_REVERSAL_RECONCILIATION_AUDIT.md`
- **Clasificación asignada:** **`B. RECOMMENDED FOR GIT — INCIDENT HISTORY`**
- **Por qué debe permanecer y promoverse como historia de incidente:** Cierra formalmente la verificación post-incidente tras eliminarse `revert-1-feature/phase-1a-core-foundation` en GitHub (`git ls-remote origin`), certifica `21/21` archivos clave en `main` y `feature`, explica el estado `0 1` en lenguaje claro y deja constancia de la discrepancia de SHA citado en el prompt previo.
- **¿Duplica otro documento?** Moderado-Alto en contexto general (resume a `#3` y `#4` e inventaría `#1`–`#4`), pero sus pruebas post-eliminación remota son únicas.
- **¿Es esencial para el desarrollo futuro?** Sirve como compuerta histórica que certificó la integridad de `main` (`97ae7c60`) tras el incidente, habilitando el reinicio ordenado de decisiones.
- **¿Debe conservarse permanentemente?** **Sí**, dentro de una carpeta dedicada de auditorías/incidentes (`docs/incidents/...` o `docs/audits/...`).
- **Riesgos de promoverlo a `main`:** Bajo-Moderado. Emite el veredicto de momento `SAFE WITH REQUIRED PRECAUTIONS` y lista archivos entonces sin seguimiento (`#1`–`#4`) que minutos después quedaron confirmados en `953bb612`; además incluye ruta de usuario `C:\Users\juanc\...`.

### 4.6 `BETHESDA_WORSHIP_STUDIO_LOCAL_DOCUMENT_PRESERVATION_CHECKPOINT.md`
- **Clasificación asignada:** **`D. REQUIRES PROJECT OWNER DECISION`** *(con recomendación consultiva de mantenerlo como **`C. EXTERNAL ARCHIVE ONLY`** para promoción a `main`, dado que ya quedó registrado en `953bb612`)*
- **Por qué requiere decisión explícita del Project Owner antes de promoverlo a `main`:**
  1. Ya fue confirmado y empujado en `953bb612` sobre `feature/phase-1a-core-foundation`; eliminarlo de esa rama requeriría reescritura (`prohibida/desaconsejada`), pero **promoverlo o no a `main`** sigue bajo control total del Project Owner.
  2. Cumple una función eminentemente **local de estación de trabajo**: registra la cadena de custodia de una copia en `C:\Users\Public\Documents\...` y documenta el repositorio ajeno `C:\Users\juanc\.git`.
  3. **Inconsistencia operativa detectada:** El propio `#6` certifica respaldos externos `5/5`, pero **`#6` mismo no está respaldado externamente** (`IN_BACKUP=False`).
- **¿Duplica otro documento?** Alto en estado Git y resumen de `#1`–`#5`; único únicamente en los hashes SHA-256 de la copia en `C:\Users\Public\Documents\...` y la detección de `C:\Users\juanc\.git`.
- **¿Es esencial para el desarrollo futuro?** **No.** Es un comprobante temporal de custodia local de archivos durante una transición de 1 hora; una vez promovidos `#1`–`#5` a Git, un registro de carpeta temporal de Windows pierde utilidad para el desarrollo del software.
- **¿Debe conservarse permanentemente?** En respaldo/archivo externo sí si se desea conservar evidencia forense de custodia; en la rama principal **`main`** no es necesario (aunque ya permanecerá trazable en el historial Git si se promueve `953bb612`).
- **Riesgos de promoverlo a `main` vs excluirlo:**
  - *Si se promueve a `main`:* Publica en la rama principal permanente metadatos internos de la PC del desarrollador (`C:\Users\juanc\.git`, `C:\Users\Public\Documents\BETHESDA_WORSHIP_STUDIO_LOCAL_DOCS_BACKUP_20261121`) y aumenta el ruido documental en la raíz (`124` `.md`).
  - *Si se excluye de `main` mediante PR/rama limpia desde `main`:* Queda únicamente en el respaldo local externo (si el Owner autoriza copiarlo allá también) y en el commit histórico `953bb612` de la rama ya archivada `feature/phase-1a-core-foundation`.

---

## 5. Análisis de Duplicación y Progresión Cronológica

### 5.1 Solapamientos Verificados (`[HECHO VERIFICADO]`)

| Tema solapado | Documentos donde aparece | Análisis de redundancia real vs necesaria |
|---|---|---|
| **Tabla/resumen de SHAs y estado de `main`/`feature`** | `#2`, `#3`, `#4`, `#5`, `#6` | **Solapamiento alto.** Cada paso posterior volvió a capturar los SHAs de Git como preflight obligatorio del instante (`17:04` → `17:55`). No existe contradicción: muestra evolución cronológica limpia. |
| **Resumen del incidente del revert PR `#1` (`766650c`)** | `#3` (base), `#4`, `#5`, `#6` | **Solapamiento moderado.** `#4`, `#5` y `#6` resumen en 1–2 párrafos el hallazgo detallado en `#3`. |
| **Inventario del árbol de trabajo pendiente (`#1`–`#4`)** | `#4`, `#5`, `#6` | **Solapamiento alto.** `#5` agrega el tamaño exacto en bytes y `#6` añade los hashes SHA-256; además, tras el commit `953bb612`, todos dejaron de ser "sin seguimiento". |
| **Resumen de los `38` hallazgos y `POD-01`–`POD-05`** | `#1` (matriz), `#2` (registro POD + `REM`) | **Complementariedad baja en redundancia.** `#1` es la matriz técnica fila por fila (`R2-F01`–`R2-F38`); `#2` es la interfaz ejecutiva de toma de decisiones y compuertas para el Project Owner. |

### 5.2 Cronología de Veracidad Temporal (Sin Contradicciones Técnicas)

```text
16:36–16:53  PR #1 & commits previos hasta 765a6312 (main aún en 36979be en disco local)
16:56:13     GitHub mergea PR #1 -> origin/main = 97ae7c60
16:57:20     GitHub crea revert-1-feature/phase-1a-core-foundation (766650c)
17:04:03     Se crea Doc #2 (Registro POD & Plan WS-R2.0; asume árbol limpio previo)
17:07:13     Se modifica Doc #1 (Matriz: actualiza HEAD a 765a6312 y enlaza Doc #2)
17:10:59     Se crea Doc #3 (Diagnóstico forense: main local aún en 36979be; revert en GitHub)
17:17:42     Se crea Doc #4 (Recuperación segura: main avanza a 97ae7c60; revert aún en GitHub)
17:47:50     Se crea Doc #5 (Reconciliación: revert confirmado borrado en GitHub; caché local queda)
17:54:55     Respaldo externo SHA-256 5/5 creado en C:\Users\Public\Documents\...
17:55:43     Se crea Doc #6 (Checkpoint local de preservación de #1-#5)
17:58:43     Commit + Push 953bb612 en feature/phase-1a-core-foundation con #1-#6 (main sigue en 97ae7c60)
```

---

## 6. Estructura Documental Recomendada para el Repositorio (Tarea 3)

### 6.1 Situación Actual Verificada (`[HECHO VERIFICADO]`)

- En la **raíz del repositorio** se acumulan **`124` archivos `.md`** (entre ellos documentos rectores R0/R1/R2 y ahora los nuevos reportes de incidente).
- Dentro de **`docs/`** existen **`675` archivos** distribuidos en `docs/audio`, `docs/reports` (con `31+` subcarpetas por fase desde `phase-0e` hasta `phase-2a-r2.2.1-r3.3.3` y decenas de reportes `WS_*.md`), `docs/test-files`, `docs/user-guide` y `docs/wp04`.

### 6.2 Estructura Objetivo Propuesta (`[RECOMENDACIÓN]` — Sin Crear ni Mover Archivos Ahora)

Para detener la proliferación en la raíz sin romper de golpe los enlaces internos `file:///...` ni reestructurar retroactivamente las `675` piezas históricas de `docs/reports/`, se recomienda adoptar gradualmente esta jerarquía limpia a partir de las nuevas fases:

```text
docs/
  governance/
    phase-r2/
      ws-r2-0/
        DECISION_REGISTER_POD_01_POD_05.md          <-- Registro firmado (#2)
        REMEDIATION_EXECUTION_PLAN.md               <-- O mantener junto al registro
    traceability/
      PHASE_R2_TRACEABILITY_AND_ACCEPTANCE_MATRIX.md <-- Matriz viva (#1)
  incidents/
    2026-11-21-pr1-revert/
      README.md                                     <-- Índice breve cronológico
      01-GIT_REVERT_INCIDENT_DIAGNOSTIC_REPORT.md   <-- (#3)
      02-GIT_SAFE_RECOVERY_REPORT.md                <-- (#4)
      03-POST_REVERSAL_RECONCILIATION_AUDIT.md      <-- (#5)
  audits/
    phase-r2/
      DOCUMENT_GOVERNANCE_DISPOSITION_REVIEW.md     <-- Este informe (opcional tras cierre)
  reports/                                          <-- Preservar intacto legado Phase 0E..2A y WS_*
```

- **`[RECOMENDACIÓN]` Regla contra ruptura de enlaces:** Si el Project Owner autoriza mover documentos desde la raíz hacia `docs/governance/` y `docs/incidents/` en una futura rama documental, debe hacerse en **un solo commit dedicado exclusivamente a organización documental** actualizando enlaces relativos (y eliminando rutas locales de PC como `file:///c:/Users/juanc/...`). Mientras tanto, el histórico raíz no debe tocarse manualmente sin permiso.

---

## 7. Estrategia Git Recomendada (Tarea 4 — No Ejecutable)

Con base en el estado real verificado (`main = 97ae7c60`, `feature/phase-1a-core-foundation = 953bb612`, relación `1 1`, trabajo futuro `WS-R2.0` pendiente):

1. **`[RECOMENDACIÓN]` No reescribir `feature/phase-1a-core-foundation`:**
   - Dado que `953bb612` ya fue empujado a `origin/feature/phase-1a-core-foundation`, ejecutar `git reset`, `git rebase` o `git push --force` reescribiría historia compartida y aumentaría el riesgo de un segundo incidente Git. Es más seguro **congelar/retirar `feature/phase-1a-core-foundation` una vez resuelta la disposición de `953bb612`**.
2. **`[RECOMENDACIÓN]` Originar todo trabajo futuro desde `main` (`97ae7c60`):**
   - `main` es actualmente la línea base limpia y canónica posterior al PR `#1` (`Tree SHA 29f0e686...`, cero cambios desde `765a6312`).
   - Todo trabajo futuro —tanto promoción documental controlada como la futura implementación autorizada de `WS-R2.0`— debe nacer en ramas nuevas creadas **desde `main` actualizado**.
3. **`[RECOMENDACIÓN]` Manejo seguro de los documentos pendientes antes de crear una nueva rama de desarrollo:**
   - **Paso A (Decisión del Owner sobre `#1`–`#6` + este reporte):**
     - **Opción recomendada (Promoción selectiva hacia `main` — sin llevar archivos innecesarios ni rutas de PC):** Crear desde `main` (`97ae7c60`) una rama documental limpia (por ejemplo `docs/phase-r2-governance-and-incident-record`), incorporar selectivamente desde `953bb612` únicamente los documentos aprobados (`A`: `#1`, `#2` y `B`: `#3`, `#4`, `#5`, dejando `#6` como archivo externo salvo orden en contrario e incluyendo opcionalmente esta revisión si se desea trazabilidad), añadir la firma oficial del Project Owner en `#2` una vez decididos `POD-01`–`POD-05`, e integrar mediante PR `#2` limpio hacia `main`.
     - **Opción alternativa (Merge directo de `953bb612`):** Fusionar `feature/phase-1a-core-foundation` (`953bb612`) en `main` tal cual está; es más simple operativamente, pero **introduce `#6` (con rutas locales `C:\Users\juanc\.git` y el respaldo en `Public\Documents`) en `main`**.
   - **Paso B (Cómo tratar este reporte recién creado `...DISPOSITION_REVIEW.md` antes de cambiar de rama):**
     - Como es un archivo nuevo sin seguimiento (`??`), cambiar de `feature/phase-1a-core-foundation` a `main` generalmente lo conserva en el directorio de trabajo sin conflicto; sin embargo, por seguridad ante `C:\Users\juanc\.git` y controles de trabajo, conviene copiarlo también a `C:\Users\Public\Documents\BETHESDA_WORSHIP_STUDIO_LOCAL_DOCS_BACKUP_20261121` (si el Owner lo autoriza) o decidir su destino antes de cualquier `git switch`.
4. **`[RECOMENDACIÓN]` Limpieza eventual de la referencia caché local obsoleta:**
   - Cuando el Project Owner autorice operaciones de mantenimiento Git, ejecutar únicamente **`git fetch --prune origin`** desde dentro de `BETHESDA WORSHIP STUDIO`. Esto eliminará de forma segura exclusivamente el puntero local fantasma `remotes/origin/revert-1-feature/phase-1a-core-foundation` (`766650c`), ya borrado en GitHub, sin tocar commits ni archivos.
5. **`[RECOMENDACIÓN]` Siguiente rama funcional de `WS-R2.0`:**
   - Únicamente **después** de sincronizar `main` y contar con aprobación escrita de `GATE 1` y `GATE 2`, crear una nueva rama específica desde `main` (por ejemplo `chore/ws-r2-0-prerequisites`) para ejecutar exclusivamente `REM-01`–`REM-04`.

---

## 8. Decisiones Requeridas del Project Owner (Tarea 5)

Ninguna de las decisiones siguientes cuenta con aprobación actualmente (`[HECHO VERIFICADO]`). Se separan las decisiones inmediatas de gobernanza documental/Git de las decisiones estratégicas **`POD-01`–`POD-05`** ya registradas en `#2`:

### 8.1 Decisiones Inmediatas de Gobernanza Documental y Git (Previas a Tocar Ramas)

| ID Decisión | Pregunta concreta al Project Owner | Opciones | Implicaciones | Riesgos de aprobar cada opción | Estado actual |
|---|---|---|---|---|---|
| **`GOV-01`** | **¿Qué documentos del lote (`#1`–`#6` + esta revisión) deben promoverse a `main` y cómo tratar `#6`?** | **Opción 1 (Recomendada):** Promoción selectiva desde `main` (`#1`, `#2` como Gobernanza; `#3`, `#4`, `#5` como Historia de Incidentes) excluyendo `#6` de `main` y respaldando `#6` + esta revisión en carpeta externa.<br>**Opción 2:** Merge completo de `953bb612` a `main`. | Opción 1 mantiene `main` libre de rutas locales temporales (`C:\Users\Public\Documents`, `C:\Users\juanc\.git`) mediante PR limpio.<br>Opción 2 incorpora los 6 archivos en `main` con cero selección manual. | **Opción 1:** Requiere abrir una rama documental limpia y elegir manualmente commits/archivos.<br>**Opción 2:** Promueve metadatos de estación local (`#6`) a `main` permanentemente. | **`PENDIENTE DE DECISIÓN`** |
| **`GOV-02`** | **¿Se adopta la estructura `docs/governance/` + `docs/incidents/` para futuros documentos o se reorganizan los `124` `.md` raíz?** | **Opción 1 (Recomendada):** Aplicar `docs/governance/` y `docs/incidents/` para este lote y futuros documentos sin mover retroactivamente los `124` antiguos.<br>**Opción 2:** Mover masivamente los `124` `.md` raíz ahora.<br>**Opción 3:** Mantener convención en raíz. | Opción 1 frena el crecimiento desordenado de raíz sin romper enlaces existentes.<br>Opción 2 limpia raíz pero obliga a auditar cientos de enlaces cruzados.<br>Opción 3 evita cambios estructurales. | **Opción 1:** Convivencia temporal entre archivos raíz previos y nuevas carpetas.<br>**Opción 2:** Alto riesgo de enlaces rotos en reportes R1/R2.<br>**Opción 3:** Raíz supera los `125+` archivos `.md`. | **`PENDIENTE DE DECISIÓN`** |
| **`GOV-03`** | **¿Se autoriza `git fetch --prune origin` y abrir futuras ramas exclusivamente desde `main` (retirando `feature/phase-1a-core-foundation`)?** | **Opción A:** Autorizar `git fetch --prune origin` + congelar `feature/phase-1a-core-foundation` tras resolver `GOV-01` + originar todo desde `main`.<br>**Opción B:** Seguir trabajando en `feature/phase-1a-core-foundation`. | Opción A elimina la referencia caché `766650c` y alinea flujo Git estándar post-merge.<br>Opción B continúa reutilizando una rama ya fusionada en PR `#1`. | **Opción A:** Requiere confirmar primero `GOV-01` para no olvidar revisar `953bb612`.<br>**Opción B:** Mezcla historial ya cerrado de Fase 1A/R1 con trabajo R2 y mantiene divergencias frente a `main`. | **`PENDIENTE DE DECISIÓN`** |

### 8.2 Decisiones Estratégicas `WS-R2.0` / Fase R2 (`POD-01`–`POD-05` + `GATE 2`)

*(Extraído fielmente de `#2 BETHESDA_WORSHIP_STUDIO_PHASE_R2_WS_R2_0_PROJECT_OWNER_DECISION_REGISTER_AND_REMEDIATION_EXECUTION_PLAN.md`; **CERO opciones asumidas como aprobadas**.)*

| ID | Decisión requerida | Opciones documentadas | Implicaciones principales | Riesgos específicos de aprobar | Estado actual |
|---|---|---|---|---|---|
| **`POD-01`** | **Arquitectura de Hosting y Almacenamiento** | **A:** VPS persistente único (SSD local + `STORAGE_ROOT_DIR`, worker Python `concurrency: 1`).<br>**B:** PaaS 1 nodo + PG gestionado + S3/R2 unificado (4 dominios).<br>**C:** Multi-réplica + Redis + Worker dedicado + S3. | Define el driver de almacenamiento de `WS-R2.4`, estrategia de backups/range proxy de audio y si Redis entra en R2 o en `R3+`. | **Aprobar A:** Punto único de fallo y disco VPS limitado.<br>**Aprobar B:** Mayor refactor en `WS-R2.4` para adaptar los 4 proveedores a S3.<br>**Aprobar C:** Sobrecarga operativa y costo recurrente alto (`~\$25–60+/mes` estimado en `#2`). | **`NO APROBADA — PENDIENTE FIRMA`** |
| **`POD-02`** | **Arquitectura Multi-Tenant** | **A:** Instancia PostgreSQL por congregación única en R2 (diferir `community_id` + RLS a `R3+`).<br>**B:** Aislamiento SaaS multi-iglesia (`community_id` + RLS en 21 tablas) ya en R2. | Determina el alcance del esquema SQL en `WS-R2.3` (`idx_setlists_single_active`, claves foráneas y consultas de repositorios). | **Aprobar A:** Prohibición estricta de mezclar dos iglesias en una misma BD durante R2.<br>**Aprobar B:** Costo de ingeniería/regresión `XL+` sobre 21 tablas y 48 suites en medio de estabilización crítica. | **`NO APROBADA — PENDIENTE FIRMA`** |
| **`POD-03`** | **Gobernanza de Canciones `APPROVED`** | **A:** Solo `ADMIN` y `SUPER_ADMIN` aprueban canciones.<br>**B:** `WORSHIP_LEADER` + `ADMIN` + `SUPER_ADMIN` aprueban explícitamente, pero toda carga/importación/IA entra forzosamente en `'DRAFT'` y se bloquea edición directa de `MUSICIAN`/`VIEWER` en activas. | Define contratos RBAC de `WS-R2.1` y `WS-R2.2` y el flujo `DRAFT -> PENDING_REVIEW -> APPROVED`. | **Aprobar A:** Cuello de botella operativo si los `ADMIN` técnicos no validan partituras musicales.<br>**Aprobar B:** Exige disciplina y validación humana explícita de líderes de alabanza para evitar aprobaciones descuidadas. | **`NO APROBADA — PENDIENTE FIRMA`** |
| **`POD-04`** | **Onboarding SMTP y Recuperación de Cuentas** | **A:** Integrar SMTP transaccional (`nodemailer` + tokens hasheados de un solo uso, cero tokens en respuestas JSON).<br>**B:** Sin SMTP en R2 (contraseña temporal fuera de banda y recuperación autoservicio deshabilitada). | Define `WS-R2.2` (entrega segura de invitaciones/resets) y flujos UI `/accept-invite` y `/forgot-password` de `WS-R2.6`. | **Aprobar A:** Requiere configurar credenciales SMTP y registros DNS `SPF`/`DKIM`.<br>**Aprobar B:** Mayor carga de soporte manual para administradores y menor autonomía/privacidad del usuario. | **`NO APROBADA — PENDIENTE FIRMA`** |
| **`POD-05`** | **Higiene Git (`backend/node_modules`) y Licencia FFmpeg** | **Git A1:** `git rm -r --cached backend/node_modules` + borrar residuales `<repo>/storage/` de prueba.<br>**Git A2:** Mantener `node_modules` rastreado.<br>**FFmpeg B1:** Mantener `imageio-ffmpeg` GPLv3 únicamente en subproceso servidor.<br>**FFmpeg B2:** Cambiar a `ffmpeg` LGPL de sistema. | Bloquea o habilita directamente **`REM-04`** dentro de **`WS-R2.0`** y el empaquetado de `WS-R2.5`. | **Aprobar Git A1:** Todo entorno/CI deberá ejecutar `npm ci` correctamente sobre `package-lock.json`.<br>**Aprobar Git A2:** Mantiene `7,367` archivos (`103.8 MiB`, 4 binarios Windows) dentro de Git.<br>**Aprobar B1:** Prohibida redistribución binaria externa sin revisión legal GPLv3.<br>**Aprobar B2:** Exige validación operativa nueva de `ffmpeg` del sistema en despliegue. | **`NO APROBADA — PENDIENTE FIRMA`** |
| **`GATE 2`** | **Autorización Controlada de `WS-R2.0`** | Autorizar **únicamente** `REM-01`–`REM-03` (+ `REM-04` según `POD-05`) en base de datos desechable, **o mantener congelado**. | Desbloquea la remediación prerequisito antes de pensar en `WS-R2.1`–`WS-R2.6`. | **Aprobar sin BD aislada (`bethesda_worship_r2_cert_tmp`):** Riesgo de tocar BD dev/test si no se aplican los controles de `GATE 3` (`REM-01`/`REM-02`). | **`NO AUTORIZADA — BLOQUEADA POR GATE 1`** |

---

## 9. Riesgos

1. **`[HECHO VERIFICADO]` Divergencia activa entre `feature/phase-1a-core-foundation` (`953bb612`) y `main` (`97ae7c60`):** Los 6 documentos revisados ya existen en GitHub sobre `feature/phase-1a-core-foundation`, mientras `main` sigue un commit atrás sin ellos. Empezar nuevas ramas desde `main` sin resolver `GOV-01` dejaría fuera la actualización de la matriz (`#1`) y el registro de decisiones (`#2`); empezarlas desde `feature` sin limpiar arrastraría el documento local `#6` hacia futuro código.
2. **`[HECHO VERIFICADO]` Documento `#6` ausente del respaldo externo:** `BETHESDA_WORSHIP_STUDIO_LOCAL_DOCUMENT_PRESERVATION_CHECKPOINT.md` tiene `IN_BACKUP=False` en `C:\Users\Public\Documents\BETHESDA_WORSHIP_STUDIO_LOCAL_DOCS_BACKUP_20261121` (y este nuevo reporte tampoco está en esa carpeta por ser posterior y regir la prohibición de modificar el respaldo existente).
3. **`[HECHO VERIFICADO]` Exposición de rutas locales de estación de trabajo en documentos ya empujados (`953bb612` y `main`):** Múltiples documentos contienen URLs `file:///c:/Users/juanc/...` y el documento `#6` expone explícitamente la existencia de `C:\Users\juanc\.git` y la ruta de respaldo `C:\Users\Public\Documents\...`. Esto no rompe la aplicación ni expone secretos de base de datos, pero sí filtra estructura local del equipo en un repositorio de GitHub si el repositorio llegara a ser público o compartido ampliamente.
4. **`[HECHO VERIFICADO]` Acumulación documental en la raíz (`124` `.md`):** Mantener todos los reportes nuevos en la raíz dificulta distinguir cuáles son documentos normativos vigentes (`WS-R2.0`) frente a diagnósticos de incidentes puntuales ya cerrados.
5. **`[HECHO VERIFICADO]` Referencia caché local obsoleta `remotes/origin/revert-1-feature/phase-1a-core-foundation` (`766650c`):** Aunque ya no existe en GitHub, sigue apareciendo localmente en `git branch -avv` y puede confundir herramientas visuales o futuras auditorías hasta ejecutar `git fetch --prune origin`.
6. **`[HECHO VERIFICADO]` Repositorio padre `C:\Users\juanc\.git`:** Cualquier comando Git ejecutado accidentalmente fuera de `BETHESDA WORSHIP STUDIO` opera sobre el directorio de usuario `C:\Users\juanc`, no sobre este proyecto.
7. **`[SUPUESTO NO VERIFICADO]` Controles remotos en GitHub no inspeccionados:** No se ha comprobado en esta auditoría la configuración de *Branch Protection* sobre `main` en GitHub ni si existe un PR abierto posterior al `#1`.

---

## 10. Acciones Explícitamente Prohibidas NO Ejecutadas

En cumplimiento estricto de todas las restricciones de seguridad ordenadas para esta revisión:

- **NO** se ejecutó `git reset`.
- **NO** se ejecutó `git clean`.
- **NO** se ejecutó `git rebase`.
- **NO** se ejecutó `git merge`.
- **NO** se ejecutó `git commit`.
- **NO** se ejecutó `git push`.
- **NO** se ejecutó `git fetch --prune`.
- **NO** se ejecutó ninguna eliminación o creación de ramas.
- **NO** se ejecutó `git stash`.
- **NO** se modificó el índice de Git (*staging*).
- **NO** se modificó, renombró, movió ni eliminó ninguno de los archivos existentes (incluidos los 6 documentos revisados).
- **NO** se modificó código de aplicación, archivos/migraciones de base de datos, configuración ni dependencias.
- **NO** se inició la remediación `WS-R2.0`.
- **NO** se ejecutó SQL contra PostgreSQL ni pruebas automatizadas de navegador.
- **NO** se alteró el historial de Git.
- **NO** se modificó el respaldo externo existente (`C:\Users\Public\Documents\BETHESDA_WORSHIP_STUDIO_LOCAL_DOCS_BACKUP_20261121`).

---

## 11. Recomendación Final

`[RECOMENDACIÓN]` La secuencia más segura, limpia y trazable antes de cualquier operación de código o remediación en **Bethesda Worship Studio** es:

1. **Confirmar explícitamente las decisiones `GOV-01`, `GOV-02` y `GOV-03`:**
   - Respaldar externamente (si se desea) `#6` y este reporte de revisión para tener cobertura externa completa.
   - Decidir entre promover selectivamente solo **`#1`, `#2` (Gobernanza) y `#3`–`#5` (Historia del Incidente)** hacia `main` mediante una nueva rama limpia nacida desde `main` (`97ae7c60`) —idealmente organizándolos bajo `docs/governance/` y `docs/incidents/2026-11-21-pr1-revert/`— frente a fusionar `953bb612` completo.
   - Autorizar la ejecución puntual de **`git fetch --prune origin`** para limpiar la referencia fantasma `remotes/origin/revert-1-feature/phase-1a-core-foundation` (`766650c`) y congelar/retirar la rama ya fusionada `feature/phase-1a-core-foundation`.
2. **Completar formalmente `GATE 1` (`POD-01`–`POD-05`) y `GATE 2` en `#2`:**
   - No iniciar ninguna tarea de `WS-R2.0` (`REM-01`–`REM-04`) hasta que el Project Owner haya decidido y firmado sus selecciones para `POD-01`–`POD-05` y autorizado explícitamente el inicio de la remediación en una nueva rama originada desde `main`.

**Operación detenida en espera de autorización explícita del Project Owner.**
