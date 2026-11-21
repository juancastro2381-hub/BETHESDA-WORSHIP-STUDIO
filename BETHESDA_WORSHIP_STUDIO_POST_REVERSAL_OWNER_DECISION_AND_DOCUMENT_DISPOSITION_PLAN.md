# BETHESDA WORSHIP STUDIO — POST-REVERSAL OWNER DECISION AND DOCUMENT DISPOSITION PLAN

**Proyecto:** Bethesda Worship Studio  
**Repositorio:** `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO.git`  
**Rama local activa:** `feature/phase-1a-core-foundation`  
**HEAD verificado en vivo:** `953bb61272b15df8ba29a9b4c795097d66760cdb` *(diferencia clave respecto a `765a6312` previo)*  
**Modo operativo:** Auditoría de solo lectura y preparación de decisiones (`0` mutaciones Git, `0` cambios en código/BD/configuración, `0` acciones de `WS-R2.0`)

> **Etiquetas epistémicas obligatorias en este informe:**  
> - **`[VERIFIED]`**: Comprobado directamente mediante comandos Git/PowerShell/Python de solo lectura, hashes SHA-256 o lectura íntegra de archivos en esta sesión.  
> - **`[OBSERVED]`**: Estado o contenido observado directamente en artefactos, métricas o salidas de inspección del repositorio.  
> - **`[RECOMMENDED]`**: Recomendación técnica o de gobernanza no ejecutada sujeta a decisión humana.  
> - **`[NOT VERIFIED]`**: Elemento no comprobado en esta auditoría por límites de solo lectura (sin consultas API web de GitHub, sin compilación/pruebas ni SQL en PostgreSQL).  
> - **`[REQUIRES OWNER AUTHORIZATION]`**: Acción bloqueada que exige autorización explícita del Project Owner antes de ejecutarse.

---

## 1. Resumen Ejecutivo (`Executive Summary`)

- **`[VERIFIED]` Estado real actualizado de Git (`commit 953bb61` ya ejecutado):** El commit **`953bb61272b15df8ba29a9b4c795097d66760cdb`** (*`PHASE R2.0 LOCAL DOCUMENT PRESERVATION AND GIT SAFETY CHECKPOINT`*, `2026-11-21 17:58:43 -0500`) ya confirmó y empujó los **6 documentos** (`#1`–`#6`) en `feature/phase-1a-core-foundation` y `origin/feature/phase-1a-core-foundation` (`6 files changed, 735 insertions(+), 1 deletion(-)`).
- **`[VERIFIED]` Brecha real respecto a `main`:** `main` y `origin/main` siguen intactos en **`97ae7c6039aa208beb5a64c6592fba0085ba0d1d`** (*Merge PR #1*). Por tanto, `feature/phase-1a-core-foundation` está **`1` commit adelante (`953bb61`) y `1` commit atrás (`97ae7c60`)** respecto a `main`: ninguno de los documentos `#2`–`#6` ni el delta `+2/-1` de `#1` se encuentran todavía en `main`.
- **`[VERIFIED]` Respaldo externo íntegro pero incompleto frente a `#6`:** La carpeta `C:\Users\Public\Documents\BETHESDA_WORSHIP_STUDIO_LOCAL_DOCS_BACKUP_20261121` contiene copias byte a byte verificadas por SHA-256 (`5/5`) de los **documentos `#1`–`#5`**, pero **NO contiene el documento `#6`** (`LOCAL_DOCUMENT_PRESERVATION_CHECKPOINT.md`, `IN_BACKUP=False`) ni reportes posteriores. El documento `#6` está respaldado únicamente en el commit `953bb61` (local y remoto `origin/feature/phase-1a-core-foundation`).
- **`[RECOMMENDED]` Clasificación y estrategia Git recomendada:**
  - Clasificar **`#1` y `#2`** como **`A. RECOMMENDED FOR PROJECT GOVERNANCE COMMIT`**.
  - Clasificar **`#3`, `#4` y `#5`** como **`B. RECOMMENDED FOR INCIDENT HISTORY / ARCHIVAL`**.
  - Clasificar **`#6`** como **`C. RECOMMENDED FOR EXTERNAL ARCHIVE ONLY`** para efectos de promoción hacia `main` (evitando publicar rutas locales de PC como `C:\Users\juanc\.git` y `C:\Users\Public\Documents\...` en la rama principal).
  - Adoptar la **Opción B (`Create a clean new branch from main after explicit authorization`)**: respaldar externamente `#6` y las revisiones pendientes, crear una rama documental limpia desde `main` (`97ae7c60`) para promover selectivamente `#1`–`#5` hacia `main` mediante PR limpio, ejecutar después `git fetch --prune origin` para limpiar la referencia local obsoleta `766650c`, retirar `feature/phase-1a-core-foundation` y abrir `WS-R2.0` únicamente desde `main` tras aprobar **`POD-01`–`POD-05` + `GATE 2`**.

---

## 2. Estado Verificado del Repositorio (`Verified Repository State` — Tarea 1)

| Campo inspeccionado | Valor verificado en vivo | Etiqueta |
|---|---|---|
| **Directorio de trabajo actual (`CWD`)** | `C:\Users\juanc\OneDrive\Documentos\Desarrollo proyectos\Sistema musical - partituras\BETHESDA WORSHIP STUDIO` | `[VERIFIED]` |
| **Raíz Git (`--show-toplevel`)** | `C:/Users/juanc/OneDrive/Documentos/Desarrollo proyectos/Sistema Musical - Partituras/BETHESDA WORSHIP STUDIO` | `[VERIFIED]` |
| **Rama local activa** | `feature/phase-1a-core-foundation` | `[VERIFIED]` |
| **`HEAD` actual** | `953bb61272b15df8ba29a9b4c795097d66760cdb` (`2026-11-21 17:58:43 -0500`) | `[VERIFIED]` |
| **Local `main` / `origin/main`** | Ambos exactamente en `97ae7c6039aa208beb5a64c6592fba0085ba0d1d` (`0 0`) | `[VERIFIED]` |
| **Local `feature/phase-1a-core-foundation` / `origin/feature/phase-1a-core-foundation`** | Ambos exactamente en `953bb61272b15df8ba29a9b4c795097d66760cdb` (`0 0`) | `[VERIFIED]` |
| **Relación `feature/phase-1a-core-foundation` vs `main`** | `1 1` (`1` commit adelante: `953bb61`; `1` commit atrás: `97ae7c60`). Diff `main..HEAD`: `6` archivos `.md` (`735+ / 1-`) | `[VERIFIED]` |
| **Referencias en vivo en GitHub (`git ls-remote origin`)** | `HEAD` (`97ae7c60`), `refs/heads/main` (`97ae7c60`), `refs/heads/feature/phase-1a-core-foundation` (`953bb612`), `refs/pull/1/head` (`765a6312`). **Cero referencias remotas `revert-1-...`** | `[VERIFIED]` |
| **Todas las referencias locales y caché (`git show-ref`)** | `refs/heads/feature/phase-1a-core-foundation` (`953bb612`), `refs/heads/main` (`97ae7c60`), `refs/remotes/origin/HEAD` (`-> origin/main`), `refs/remotes/origin/feature/phase-1a-core-foundation` (`953bb612`), `refs/remotes/origin/main` (`97ae7c60`), y referencia caché local obsoleta **`refs/remotes/origin/revert-1-feature/phase-1a-core-foundation` (`766650ceb3e8818ac3c32023d7d87338364850ac`)** | `[VERIFIED]` |
| **Estado del árbol de trabajo (`git status -uall --porcelain=v1`, previo a este informe)** | Únicamente `?? BETHESDA_WORSHIP_STUDIO_DOCUMENT_GOVERNANCE_DISPOSITION_REVIEW.md` (`41,883` bytes, revisión previa ya existente en disco); **`0` cambios en archivos rastreados (`git diff --stat` vacío)** | `[VERIFIED]` |
| **Estado del índice Git (`git diff --cached --name-status`)** | **Vacío** (`0` archivos en *stage*) | `[VERIFIED]` |
| **Archivos sin seguimiento (`git ls-files --others --exclude-standard`)** | Previo a este reporte: `BETHESDA_WORSHIP_STUDIO_DOCUMENT_GOVERNANCE_DISPOSITION_REVIEW.md`. Tras crear este reporte: ese archivo previo + `BETHESDA_WORSHIP_STUDIO_POST_REVERSAL_OWNER_DECISION_AND_DOCUMENT_DISPOSITION_PLAN.md` | `[VERIFIED]` |
| **Stashes (`git stash list`)** | `<NONE>` (`0` stashes guardados) | `[VERIFIED]` |
| **Entradas recientes de `reflog` relevantes al incidente** | `main@{0}: 97ae7c6 fetch origin main:main: fast-forward` \| `main@{1}: 36979be PHASE 0E-R` \| `feature@{0}: 953bb61 PRESERVATION CHECKPOINT` \| `feature@{1}: 765a631 WS-R2.0 Gate` \| `feature@{4}: 2ebb0fd R1 closure` | `[VERIFIED]` |

---

## 3. Inventario de los Seis Documentos (`Document Inventory` — Tarea 2)

> **`[VERIFIED]` Discrepancia de nombre en el Documento #2 citado por el prompt:** El nombre `BETHESDA_WORSHIP_STUDIO_PHASE_WS_R2_0_PROJECT_OWNER_DECISION_REGISTER_AND_REMEDIATION_EXECUTION_PLAN.md` **no existe (`EXISTS=False`)**. El nombre real verificado en disco, en `feature/phase-1a-core-foundation` (`953bb61`) y en el respaldo externo contiene `_PHASE_R2_WS_R2_0_`: **`BETHESDA_WORSHIP_STUDIO_PHASE_R2_WS_R2_0_PROJECT_OWNER_DECISION_REGISTER_AND_REMEDIATION_EXECUTION_PLAN.md` (`EXISTS=True`)**.

| # | Documento real verificado | ¿Existe / Rastreado / Modificado vs `HEAD`? | ¿En `main`? / ¿En `feature`? | Bytes / Líneas / SHA-256 | ¿Duplicación o consistencia? | Información sensible / rutas específicas de máquina (`[OBSERVED]`) | Respaldo externo (`5/5` excepto `#6`) |
|---|---|---|---|---|---|---|---|
| 1 | `BETHESDA_WORSHIP_STUDIO_PHASE_R2_UPDATED_TRACEABILITY_AND_ACCEPTANCE_MATRIX.md` | Existe: **Sí** \| Rastreado: **Sí** \| Modificado vs `HEAD`: **No** *(+2/-1 líneas vs `main`)* | `main`: **Sí** \| `feature`: **Sí** | `41,573` B \| `109` líneas \| `17911F87628F91A4E25CB4CA0BB5A4D63D9FAE0A72C64005732FBDFB6535EAD6` | Consistente. Complementa a `#2`; sin duplicar su texto completo | `0` secretos, `0` correos, `0` rutas raw `C:\Users\...`, **`60` URLs `file:///c:/Users/juanc/...`** (patrón ya presente en `main`) | **Sí (`BACKUP_SHA_MATCH=True`)** |
| 2 | `BETHESDA_WORSHIP_STUDIO_PHASE_R2_WS_R2_0_PROJECT_OWNER_DECISION_REGISTER_AND_REMEDIATION_EXECUTION_PLAN.md` *(real; prompt omitió `_R2_`)* | Existe: **Sí** \| Rastreado: **Sí** \| Modificado vs `HEAD`: **No** | `main`: **No** \| `feature`: **Sí** | `26,654` B \| `171` líneas \| `CF2CB4EEA314D0DA9A8F83AA5ACDDA896C429D3CED8BF5AE2CE1C067686D898D` | Consistente. Consolida decisiones `POD` y plan `REM` previos en un registro ejecutable único. Línea 21 dice `Pre-Action Working Tree: Clean` (snapshot temporal previo) | `0` secretos, `0` correos, `0` rutas raw `C:\Users\...`, **`18` URLs `file:///c:/Users/juanc/...`** | **Sí (`BACKUP_SHA_MATCH=True`)** |
| 3 | `BETHESDA_WORSHIP_STUDIO_GIT_REVERT_INCIDENT_DIAGNOSTIC_REPORT.md` | Existe: **Sí** \| Rastreado: **Sí** \| Modificado vs `HEAD`: **No** | `main`: **No** \| `feature`: **Sí** | `12,096` B \| `107` líneas \| `7BAF0067B687C67BBC76971A108DBF8F885242E5B43C330B9CD6DF08E4BDD05F` | Consistente históricamente (`17:10`: mostraba `main` local antes del fast-forward `36979be` y revert abierto). Desglose `754` archivos / `132,410-` es único | `0` secretos, `1` correo genérico (`noreply@github.com`), `0` rutas raw, **`1` URL `file:///c:/Users/juanc/...`** | **Sí (`BACKUP_SHA_MATCH=True`)** |
| 4 | `BETHESDA_WORSHIP_STUDIO_GIT_SAFE_RECOVERY_REPORT.md` | Existe: **Sí** \| Rastreado: **Sí** \| Modificado vs `HEAD`: **No** | `main`: **No** \| `feature`: **Sí** | `8,209` B \| `108` líneas \| `ED3FB2C7737626EAC279AE3AE873B1C6128FD88B08B76C952DA086745A2B11DC` | Consistente históricamente (`17:17`: previo a eliminarse rama remota en GitHub). Resume el incidente (`#3`), pero sus comandos de recuperación son únicos | `0` secretos, `0` correos, **`3` rutas raw `C:\Users\juan...` / `C:\Users\juanc\...`**, **`1` URL `file:///c:/Users/juanc/...`** | **Sí (`BACKUP_SHA_MATCH=True`)** |
| 5 | `BETHESDA_WORSHIP_STUDIO_POST_REVERSAL_RECONCILIATION_AUDIT.md` | Existe: **Sí** \| Rastreado: **Sí** \| Modificado vs `HEAD`: **No** | `main`: **No** \| `feature`: **Sí** | `23,024` B \| `208` líneas \| `14723E655536DC354869347431B9AB3D4636169889E9082B429847DE0DF03E02` | Consistente históricamente (`17:47`: previo al commit `953bb61`). Resume `#3`/`#4`, pero aporta `ls-remote` post-borrado remoto y `21/21` objetos verificados | `0` secretos, `0` correos, **`1` ruta raw `c:\Users\juanc\OneDrive\...`**, `0` `file:///` | **Sí (`BACKUP_SHA_MATCH=True`)** |
| 6 | `BETHESDA_WORSHIP_STUDIO_LOCAL_DOCUMENT_PRESERVATION_CHECKPOINT.md` | Existe: **Sí** \| Rastreado: **Sí** \| Modificado vs `HEAD`: **No** | `main`: **No** \| `feature`: **Sí** | `19,976` B \| `139` líneas \| `1FD07919B30A6AE81C8C15CF85679E4A095118F34D84872A3625AB554B57B917` | Consistente en hechos de custodia (`17:55`). Duplica el estado Git e inventario de `#5`, añadiendo SHA-256 del respaldo y hallazgo `C:\Users\juanc\.git` | `0` secretos/BD, `0` correos, pero expone **`7` rutas raw de estación** (incl. **`C:\Users\Public\Documents\BETHESDA_WORSHIP_STUDIO_LOCAL_DOCS_BACKUP_20261121`**, **`C:\Users\juanc\.git`**) y **`5` `file:///c:/Users/juanc/...`** | **NO (`IN_BACKUP=False`)** |

*(Observación complementaria `[VERIFIED]`: Además de los 6 documentos anteriores, en el árbol de trabajo existe sin seguimiento `BETHESDA_WORSHIP_STUDIO_DOCUMENT_GOVERNANCE_DISPOSITION_REVIEW.md` (`41,883` B), el cual tampoco forma parte del respaldo externo.)*

---

## 4. Tabla de Clasificación y Disposición (`Classification and Disposition Table` — Tarea 3)

Cada documento recibe **exactamente una** clasificación asignada con fundamento en su función en la gobernanza del proyecto, trazabilidad técnica, unicidad e higiene de repositorio (`[RECOMMENDED]`):

| # | Documento | Clasificación única | Justificación detallada |
|---|---|---|---|
| **1** | `BETHESDA_WORSHIP_STUDIO_PHASE_R2_UPDATED_TRACEABILITY_AND_ACCEPTANCE_MATRIX.md` | **`A. RECOMMENDED FOR PROJECT GOVERNANCE COMMIT`** | Ya forma parte de `main`, y su actualización `+2/-1` sincroniza el SHA `765a6312` y enlaza el Registro de Decisiones POD. Contiene la matriz maestra única de los `38` hallazgos (`R2-F01`–`R2-F38`) y criterios de aceptación indispensables para auditar `WS-R2.0`–`WS-R2.6`. Debe promoverse a `main` como documento rector vivo. |
| **2** | `BETHESDA_WORSHIP_STUDIO_PHASE_R2_WS_R2_0_PROJECT_OWNER_DECISION_REGISTER_AND_REMEDIATION_EXECUTION_PLAN.md` | **`A. RECOMMENDED FOR PROJECT GOVERNANCE COMMIT`** | Es el instrumento operativo central para recabar las aprobaciones **`POD-01`–`POD-05`**, regular los controles de aislamiento PostgreSQL (`REM-01`–`REM-04`) y gobernar las 8 compuertas **`GATE 1`–`GATE 8`**. Sin él en `main`, la rama principal carecería del registro consolidado de autorizaciones de `WS-R2.0`. |
| **3** | `BETHESDA_WORSHIP_STUDIO_GIT_REVERT_INCIDENT_DIAGNOSTIC_REPORT.md` | **`B. RECOMMENDED FOR INCIDENT HISTORY / ARCHIVAL`** | Preserva evidencia forense irrepetible del incidente del `2026-11-21` (`754` archivos / `132,410` líneas que habría borrado `766650c` y prueba criptográfica de árboles). No guía el diseño de software futuro, por lo que no debe mezclarse en la raíz como gobernanza activa, sino archivarse en historial de incidentes (`docs/incidents/`). |
| **4** | `BETHESDA_WORSHIP_STUDIO_GIT_SAFE_RECOVERY_REPORT.md` | **`B. RECOMMENDED FOR INCIDENT HISTORY / ARCHIVAL`** | Registra la secuencia exacta de recuperación segura (`git fetch origin main:main` sin *stash* ni *force-push*). Sirve como libro de precedentes operativos ante incidentes Git futuros; aunque expone rutas de usuario locales (`C:\Users\juanc\...`), su valor histórico justifica archivarlo bajo `docs/incidents/` (idealmente saneando rutas personales si se revisa en una rama documental). |
| **5** | `BETHESDA_WORSHIP_STUDIO_POST_REVERSAL_RECONCILIATION_AUDIT.md` | **`B. RECOMMENDED FOR INCIDENT HISTORY / ARCHIVAL`** | Cierra el ciclo probatorio tras la eliminación remota de `revert-1-feature/phase-1a-core-foundation`: acredita `ls-remote` limpio en GitHub, `21/21` objetos clave en `main` y `feature`, y explica el desfase de merge `0 1`. Corresponde al cierre del expediente de incidente bajo `docs/incidents/` o `docs/audits/`. |
| **6** | `BETHESDA_WORSHIP_STUDIO_LOCAL_DOCUMENT_PRESERVATION_CHECKPOINT.md` | **`C. RECOMMENDED FOR EXTERNAL ARCHIVE ONLY`** | Su propósito fue estrictamente transitorio: inventariar un árbol de trabajo entonces sin confirmar y certificar una copia local hacia Windows (`C:\Users\Public\Documents\...`). Tras consolidarse `#1`–`#5` en Git, no aporta valor funcional a `main` y en cambio expone detalles específicos del equipo local (`C:\Users\juanc\.git`, rutas `Public\Documents`, timestamps locales). Aunque ya quedó en `953bb61`, **no debe promoverse a `main`**: debe copiarse al respaldo externo (donde aún falta) y quedar fuera de la rama principal. |

*(Nota sobre el conjunto general: Si el Project Owner prefiriera retener `#6` dentro de una subcarpeta interna o promoverlo igual por completitud de auditoría, esa excepción requeriría su instrucción explícita; la recomendación técnica sólida es **`C`**.)*

---

## 5. Integridad del Respaldo Externo y Organización Propuesta (`Backup Integrity & Repository Organization` — Tareas 2 y 4)

### 5.1 Estado y Limitaciones del Respaldo Externo (`[VERIFIED]`)

- **Ubicación verificada:** `C:\Users\Public\Documents\BETHESDA_WORSHIP_STUDIO_LOCAL_DOCS_BACKUP_20261121` (comprobada fuera de `BETHESDA WORSHIP STUDIO` y fuera de `C:\Users\juanc\.git`).
- **Contenido exacto verificado:** Contiene **únicamente 5 archivos** (`#1`–`#5`), todos con **`BACKUP_SHA_MATCH=True`** (`41,573`, `26,654`, `12,096`, `8,209`, `23,024` bytes = `111,556` bytes).
- **Limitación principal identificada (`[VERIFIED]`):**
  1. **Documento `#6` NO respaldado externamente:** `LOCAL_DOCUMENT_PRESERVATION_CHECKPOINT.md` (`19,976` B) falta en `C:\Users\Public\Documents\BETHESDA_WORSHIP_STUDIO_LOCAL_DOCS_BACKUP_20261121` (`IN_BACKUP=False`).
  2. Los dos reportes posteriores de revisión (`...GOVERNANCE_DISPOSITION_REVIEW.md` y este `...OWNER_DECISION_AND_DOCUMENT_DISPOSITION_PLAN.md`) tampoco están en esa carpeta por la prohibición estricta de modificar el respaldo existente.

### 5.2 Estrategia Futura de Organización Documental (`[RECOMMENDED]` — Sin Mover Archivos Ahora)

- **Volumen existente verificado (`[VERIFIED]`):** En el repositorio conviven **`125` archivos `.md` en raíz** (más este informe = `126`) y **`675` archivos dentro de `docs/`** (`472` `.md` en `docs/reports/`, `docs/audio/`, `docs/test-files/`, `docs/user-guide/`, `docs/wp04/`).
- **Riesgos concretos de mover masivamente los `docs/` y `.md` actuales sin autorización expresa (`[VERIFIED]` / `[OBSERVED]`):**
  1. **Ruptura masiva de trazabilidad y enlaces cruzados:** El escaneo estático demostró **`177` archivos con referencias a `docs/reports`**, **`149` archivos con enlaces `file:///`** y **`65` archivos que nombran directamente documentos `BETHESDA_WORSHIP_STUDIO_*.md` de raíz**. Un movimiento no coordinado rompería decenas de referencias entre auditorías cerradas de Fase 0E, Fase R1 y Fase R2.
  2. **Diff gigantesco y ruido sobre historial:** Reubicar `~597` documentos generaría cientos de renombres Git innecesarios justo cuando `main` acaba de recuperarse de un incidente de `754` archivos revertidos.
- **Estructura objetivo recomendada para nuevas incorporaciones y promoción controlada (`[RECOMMENDED]`):**
  - `docs/governance/` → Documentos normativos activos (`#1` matriz R2, `#2` registro de decisiones firmado, futuros cierres `WS-R2.0`–`WS-R2.6`).
  - `docs/incidents/` → Subcarpeta fechada (`docs/incidents/2026-11-21-pr1-revert/`) para `#3`, `#4` y `#5` (manteniendo legibles los reportes históricos del incidente sin saturar la raíz).
  - `C:\Users\Public\Documents\BETHESDA_WORSHIP_STUDIO_LOCAL_DOCS_BACKUP_20261121` (archivo externo) → Respaldo de `#1`–`#5` completado con `#6` (`Class C`) y minutas transitorias locales que no deban poblar `main`.

---

## 6. Comparativa de Estrategia Git (`Git Strategy Comparison` — Tarea 5)

Evaluación basada en la realidad verificada de que **`feature/phase-1a-core-foundation` ya está en `953bb61`** (`+1` commit documental respecto a `765a6312`, y `1 1` frente a `main` `97ae7c60`):

| Criterio | Opción A: Commit selectivo solo de docs sobre `feature/phase-1a-core-foundation` actual | Opción B: Crear una rama nueva limpia desde `main` tras autorización explícita **(RECOMENDADA)** | Opción C: Merge selectivo de `feature/phase-1a-core-foundation` (`953bb61`) hacia `main` |
|---|---|---|---|
| **Cómo maneja los 6 documentos** | `#1`–`#6` ya están en `953bb61` sobre `feature`; un nuevo commit aquí solo añadiría/reorganizaría sobre la rama ya fusionada en PR #1, dejando `#6` en su historial y sin actualizar `main` todavía. | Desde `main` (`97ae7c60`), abrir rama documental limpia (p. ej. `docs/phase-r2-governance-and-incident-record`), traer **solo `#1`–`#5`** desde `953bb61` (excluyendo `#6`, archivado externamente), integrar a `main` vía PR #2 limpio, podar caché local y abrir luego rama nueva para `WS-R2.0`. | Integrar `feature` (`953bb61`) en `main`. Git `merge` estándar trae **todos los 6 archivos (`#1`–`#6`, incluido `#6`)**; simular selectividad requiere `git merge --no-commit` + revert/exclusión manual de `#6`, dejando aun así `953bb61` como padre del merge en `main`. |
| **Ventajas** | Cero cambios de rama inmediatos; mínimo esfuerzo puntual si solo se quisiera fotografiar un nuevo informe local. | **`main` permanece 100% limpio sin `#6` ni rutas de PC**; separa historia cerrada de PR #1 (Fase 1A/R1) del ciclo R2; cero reescritura sobre `953bb61`; base unificada para `WS-R2.0`. | Menor número de comandos que copiar archivo a archivo si el Owner aceptara `#6` dentro de `main`. |
| **Riesgos** | Sigue acumulando commits en una rama ya fusionada (`1 1` con `main`); `main` permanece desactualizada; riesgo de futuros conflictos de PR o confusión de alcance. | Requiere manejo explícito de los dos reportes nuevos aún sin seguimiento (`??`) antes/después del cambio de rama y copia previa de `#6` al respaldo externo. | Introduce `#6` (con `C:\Users\juanc\.git` y `Public\Documents`) en `main` de forma permanente (o crea un merge editado manualmente menos transparente) y reutiliza la rama `feature/phase-1a-core-foundation`. |
| **Prerrequisitos** | Autorización del Owner para commitear/empujar en `feature`. | 1) Autorización para copiar `#6` (y revisiones) al respaldo externo; 2) Autorización de `GOV-01`–`GOV-03` para ramificar desde `main` (`97ae7c60`), seleccionar `#1`–`#5`, crear PR a `main` y ejecutar `git fetch --prune origin`. | Autorización explícita para fusionar `feature/phase-1a-core-foundation` (`953bb61`) en `main` aceptando `#6` (o excluyéndolo manualmente antes del commit de merge). |
| **Archivos esperados modificados** | Solo los nuevos reportes `.md` en raíz sobre `feature` (`#1`–`#6` ya confirmados); `0` cambios en código. | En la nueva rama desde `main`: exclusivamente `#1` (`+2/-1`), `#2`, `#3`, `#4` y `#5` (`5` archivos, `0` `#6`, `0` código/BD/dependencias). | `6` archivos (`735+ / 1-`: `#1`–`#6`), o `5` archivos si `#6` se descarta antes de cerrar un `--no-commit` merge. |

**Veredicto de estrategia (`[RECOMMENDED]`):** **Opción B (`Create a clean new branch from main after explicit authorization`)**, combinada con respaldo externo previo de `#6` y poda posterior autorizada (`git fetch --prune origin`) para remover la caché local obsoleta `766650c`.

---

## 7. Decisiones Pendientes del Project Owner (`Outstanding Project Owner Decisions` — Tarea 6)

Ninguna de las siguientes decisiones ha sido aprobada todavía (`[VERIFIED]` — estado actual `REQUIRES OWNER AUTHORIZATION`):

### 7.1 Decisiones de Gobierno Git y Custodia Documental (Previas a `WS-R2.0`)

1. **`GOV-01` — Promoción selectiva hacia `main` y respaldo externo de `#6`:** ¿Autoriza respaldar `#6` (y las revisiones de gobernanza) en `C:\Users\Public\Documents\BETHESDA_WORSHIP_STUDIO_LOCAL_DOCS_BACKUP_20261121` y promover hacia `main` únicamente `#1`–`#2` (`A`) + `#3`–`#5` (`B`), excluyendo `#6` (`C`) de `main`? `[REQUIRES OWNER AUTHORIZATION]`
2. **`GOV-02` — Organización en `docs/governance/` y `docs/incidents/`:** ¿Las nuevas promociones `#1`–`#5` (o futuros documentos R2) se ubican ya bajo `docs/governance/` y `docs/incidents/2026-11-21-pr1-revert/`, dejando intactos los `124+` `.md` históricos y `docs/reports/`? `[REQUIRES OWNER AUTHORIZATION]`
3. **`GOV-03` — Higiene de ramas Git:** ¿Se autoriza ejecutar `git fetch --prune origin` (para limpiar la referencia caché local `remotes/origin/revert-1-feature/phase-1a-core-foundation` `766650c`), congelar `feature/phase-1a-core-foundation` y originar todas las ramas futuras desde `main` (`97ae7c60`)? `[REQUIRES OWNER AUTHORIZATION]`

### 7.2 Decisiones Estratégicas `WS-R2.0` / Fase R2 (`POD-01`–`POD-05` y `GATE 2`)

| ID | Área de decisión | Opciones documentadas en `#2` | Riesgo / Implicación clave | Estado |
|---|---|---|---|---|
| **`POD-01`** | **Estrategia de Hosting y Almacenamiento** | **A:** VPS persistente único (`STORAGE_ROOT_DIR` local, DSP en cola `concurrency: 1`) \| **B:** PaaS 1 nodo + PG gestionado + S3/R2 en 4 dominios \| **C:** Multi-réplica + Redis + S3 + Worker dedicado | Define `WS-R2.4` y almacenamiento binario. A implica disco fijo/SPOF; B exige adaptar 4 proveedores a S3; C eleva complejidad (`XL`) y costo recurrente | `[REQUIRES OWNER AUTHORIZATION]` |
| **`POD-02`** | **Iglesia Única vs Multi-Tenant** | **A:** BD PostgreSQL por congregación en R2 (`community_id` + RLS diferidos a `R3+`) \| **B:** Multi-tenant SaaS (`community_id` + PG RLS en 21 tablas + `idx_setlists_single_active`) en R2 | A prohíbe mezclar 2 iglesias en una BD en R2; B exige reescritura masiva (`XL+`) sobre 21 tablas y 48 suites | `[REQUIRES OWNER AUTHORIZATION]` |
| **`POD-03`** | **Aprobación de Canciones y Contenido Canónico** | **A:** Solo `ADMIN` / `SUPER_ADMIN` aprueban \| **B:** `WORSHIP_LEADER` + `ADMIN` + `SUPER_ADMIN` aprueban vía revisión humana explícita; carga/import/IA siempre en `'DRAFT'` y bloqueo a `MUSICIAN`/`VIEWER` sobre activas | Define RBAC `WS-R2.1`/`WS-R2.2`. A crea cuello de botella técnico; B exige revisión humana rigurosa de líderes | `[REQUIRES OWNER AUTHORIZATION]` |
| **`POD-04`** | **Configuración SMTP y Recuperación** | **A:** Relay SMTP transaccional (`nodemailer`, tokens hasheados de un solo uso, cero tokens en JSON HTTP) \| **B:** Sin SMTP en R2 (contraseña temporal fuera de banda, sin reset autoservicio) | Define `WS-R2.2` y `/accept-invite` + `/forgot-password` (`WS-R2.6`). A requiere DNS `SPF`/`DKIM`; B carga soporte manual al admin | `[REQUIRES OWNER AUTHORIZATION]` |
| **`POD-05`** | **Gobernanza Git, `node_modules` y FFmpeg** | **Git A1:** `git rm -r --cached backend/node_modules` + limpiar `<repo>/storage/` residual + validar `npm ci` \| **Git A2:** Mantener `7,367` archivos rastreados (`103.8 MiB`)<br>**FFmpeg B1:** `imageio-ffmpeg` GPLv3 solo en subproceso servidor (revisión legal antes de distribuir) \| **FFmpeg B2:** Migrar a `ffmpeg` LGPL de sistema | **Habilita/bloquea directamente `REM-04` en `WS-R2.0`**. Confirmado `[VERIFIED]` en `#2` que no existe ImageMagick; A1 exige `npm ci` operativo en todos los entornos | `[REQUIRES OWNER AUTHORIZATION]` |
| **`GATE 2`** | **Autorización Controlada de `WS-R2.0`** | Autorizar **exclusivamente** `REM-01` (rol runtime + `pgboss`), `REM-02` (pruebas en BD desechable `bethesda_worship_r2_cert_tmp`), `REM-03` (`tsx --test` + CWD `autoscroll` + test `#8`), y `REM-04` (si `POD-05=A1`) | **Debe permanecer cerrada** hasta completar firmas de **`GATE 1` (`POD-01`–`POD-05`)**. `WS-R2.1`–`WS-R2.6` siguen totalmente bloqueadas (`GATE 8`) | **`NO AUTORIZADA — [REQUIRES OWNER AUTHORIZATION]`** |

---

## 8. Siguiente Secuencia Recomendada de Operaciones (`Recommended Next Sequence`)

1. **Paso 1 (`[REQUIRES OWNER AUTHORIZATION]`):** El Project Owner revisa este plan y firma sus respuestas a **`GOV-01`–`GOV-03`**, **`POD-01`–`POD-05`** (`GATE 1`) y decide si autoriza **`GATE 2`** (`WS-R2.0` únicamente).
2. **Paso 2 (Custodia externa completa):** Si `GOV-01` aprueba la Opción B, copiar `#6` (`LOCAL_DOCUMENT_PRESERVATION_CHECKPOINT.md`) y los reportes de disposición documental hacia `C:\Users\Public\Documents\BETHESDA_WORSHIP_STUDIO_LOCAL_DOCS_BACKUP_20261121` con verificación SHA-256.
3. **Paso 3 (Limpieza de caché local y rama documental desde `main`):**
   - Ejecutar `git fetch --prune origin` (elimina el rastro local `766650c`).
   - Crear una nueva rama limpia desde `main` (`97ae7c60`), incorporar selectivamente únicamente `#1`–`#5` (según la estructura aprobada en `GOV-02`) con el registro POD firmado, integrar en `main` mediante PR limpio y retirar `feature/phase-1a-core-foundation`.
4. **Paso 4 (Solo tras aprobar `GATE 1` + `GATE 2`):** Crear desde `main` actualizado la rama dedicada `chore/ws-r2-0-prerequisites` para ejecutar la pre-validación de BD aislada (`GATE 3`) y las remediaciones `REM-01`–`REM-04` de `WS-R2.0`.

---

## 9. Registro de Riesgos (`Risk Register`)

| ID Riesgo | Descripción | Severidad / Estado | Evidencia / Mitigación recomendada |
|---|---|---|---|
| **RSK-01** | **Falta de `#6` (y reportes posteriores) en respaldo externo:** Solo `#1`–`#5` están en `C:\Users\Public\Documents\...` (`IN_BACKUP=False` para `#6`) | Media (`[VERIFIED]`) | Copiar `#6` y revisiones recientes al respaldo externo antes de manipular ramas. |
| **RSK-02** | **Divergencia `1 1` entre `main` (`97ae7c60`) y `feature` (`953bb61`):** Nuevas ramas desde `main` no tendrían el delta de `#1` ni `#2` hasta promoverlos | Alta (`[VERIFIED]`) | Ejecutar promoción documental limpia (Opción B) hacia `main` antes de abrir rama `WS-R2.0`. |
| **RSK-03** | **Exposición de rutas locales de máquina (`C:\Users\juanc\.git`, `Public\Documents`) si `#6` se fusionara a `main`** | Media (`[OBSERVED]`) | Clasificar `#6` como `C. EXTERNAL ARCHIVE ONLY` y no promoverlo a `main`. |
| **RSK-04** | **Riesgo de enlaces rotos al mover `125` `.md` raíz / `675` archivos `docs/` (`177` refs `docs/reports`, `149` `file:///`, `65` refs raíz)** | Alta (`[VERIFIED]`) | No mover archivos existentes en masa sin autorización expresa y script verificador de enlaces. |
| **RSK-05** | **Referencia local obsoleta `remotes/origin/revert-1-...` (`766650c`) aún visible en `git branch -avv`** | Baja (`[VERIFIED]`) | Programar `git fetch --prune origin` bajo autorización `GOV-03`. |
| **RSK-06** | **Repositorio Git en directorio padre `C:\Users\juanc\.git`:** Cualquier comando Git ejecutado fuera de `BETHESDA WORSHIP STUDIO` afecta al repositorio del perfil Windows | Media (`[VERIFIED]`) | Ejecutar siempre `git` dentro de la carpeta exacta del proyecto (`--show-toplevel`). |
| **RSK-07** | **Lectura equivocada de `#2` (`WS_R2_0_PROJECT_OWNER_DECISION_REGISTER...`) asumiendo `POD` ya aprobados** | Alta (`[OBSERVED]`) | Mantener registro explícito de estado `NO APROBADA — PENDIENTE FIRMA` hasta recabar firmas escritas. |

---

## 10. Requisitos Explícitos de Autorización (`Explicit Authorization Requirements`)

Ninguna de las acciones siguientes está permitida actualmente; todas exigen **autorización explícita y por escrito del Project Owner** antes de ejecutarse (`[REQUIRES OWNER AUTHORIZATION]`):

1. Copiar/añadir archivos nuevos dentro de `C:\Users\Public\Documents\BETHESDA_WORSHIP_STUDIO_LOCAL_DOCS_BACKUP_20261121`.
2. Cualquier operación de escritura Git (`checkout`/`switch`, creación de ramas, `add`, `commit`, `merge`, `cherry-pick`, `push`, `fetch --prune`, borrado/archivo de `feature/phase-1a-core-foundation`).
3. Cualquier movimiento o reorganización de documentos existentes en raíz o `docs/`.
4. Ejecución de **`WS-R2.0` (`REM-01`–`REM-04`)** contra entorno local o base de datos desechable `bethesda_worship_r2_cert_tmp` (`GATE 1` + `GATE 2`).
5. Cualquier trabajo en **`WS-R2.1`–`WS-R2.6`** (bloqueado adicionalmente por `GATE 8`).

---

## 11. Limitaciones de Verificación (`Verification Limitations`)

1. **Prohibición estricta de mutaciones Git y edición de archivos (`[VERIFIED]`):** Durante esta revisión no se ejecutaron `commit`, `push`, `merge`, `reset`, `rebase`, `stash`, `fetch --prune`, movimientos de archivos ni modificaciones al respaldo externo o código/BD.
2. **Estado en GitHub más allá de `git ls-remote origin` (`[NOT VERIFIED]`):** No se inspeccionaron por API web de GitHub reglas de protección de ramas, historial de *reviews* ni eventuales Pull Requests posteriores al `#1`.
3. **Ejecución en tiempo de ejecución (`[NOT VERIFIED]`):** No se ejecutaron compilaciones, pruebas de `backend`/`frontend`/`workers`, SQL contra PostgreSQL ni pruebas automatizadas de navegador; todas las referencias técnicas sobre `WS-R2.0` provienen de la lectura verificada de `#1`, `#2` y documentos acompañantes en el repositorio.
4. **Dos archivos locales sin seguimiento en árbol de trabajo (`[VERIFIED]`):** Al cierre de esta auditoría quedan sin confirmar en el árbol de trabajo únicamente `BETHESDA_WORSHIP_STUDIO_DOCUMENT_GOVERNANCE_DISPOSITION_REVIEW.md` (preexistente antes de esta tarea) y este nuevo entregable `BETHESDA_WORSHIP_STUDIO_POST_REVERSAL_OWNER_DECISION_AND_DOCUMENT_DISPOSITION_PLAN.md` (`0` cambios en archivos rastreados e índice Git completamente vacío).
