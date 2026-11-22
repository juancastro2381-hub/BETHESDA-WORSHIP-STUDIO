# BETHESDA WORSHIP STUDIO — AUDITORÍA DE GOBERNANZA DE FLUJO GIT, ESTRATEGIA DE RAMAS Y CONTROL DE NOTIFICACIONES DE PULL REQUEST

**Proyecto:** Bethesda Worship Studio  
**Repositorio:** `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO.git`  
**Rama activa verificada:** `feature/phase-1a-core-foundation` (`58a3cc7e457eea4aa1abc5f5b95d3130e521c1e7`)  
**Rama base verificada (`main`):** `97ae7c6039aa208beb5a64c6592fba0085ba0d1d`  
**Naturaleza de la tarea:** Auditoría estrictamente de solo lectura y diseño de gobernanza Git/GitHub (`0` mutaciones ejecutadas)

> **Etiquetas epistémicas obligatorias en este informe:**  
> - **`[VERIFIED]`**: Comprobado directamente mediante comandos Git locales, `git ls-remote`, API REST pública de GitHub o documentación oficial consultada en esta sesión.  
> - **`[INFERRED]`**: Conclusión técnica deducida directamente de la relación verificada entre commits, ramas y comportamiento documentado de GitHub.  
> - **`[RECOMMENDED]`**: Recomendación operativa o de arquitectura Git propuesta (aún NO implementada).  
> - **`[REQUIRES PROJECT OWNER APPROVAL]`**: Decisión o acción de escritura bloqueada que exige autorización explícita del Project Owner.

---

## 1. Resumen Ejecutivo (`Executive Summary`)

- **`[VERIFIED]` El banner `"Compare & pull request"` en GitHub NO es un error ni una falla del repositorio:** Es el comportamiento normal y estándar de la interfaz web de GitHub siempre que existen commits recientes en una rama distinta de la rama predeterminada (`main`) que todavía no han sido integrados en `main` y no cuentan con un Pull Request abierto.
- **`[VERIFIED]` Causa raíz exacta confirmada por evidencia real:** El Pull Request `#1` integró `feature/phase-1a-core-foundation` únicamente hasta el commit **`765a6312780ae155be3be7b2e19cbebbb56856c5`** hacia `main` (`97ae7c6039aa208beb5a64c6592fba0085ba0d1d`) el `2026-11-21 16:56:13 -0500` (`21:56:14Z`). Sin embargo, la rama `feature/phase-1a-core-foundation` **no fue cerrada ni retirada tras el merge**, sino que siguió utilizándose como rama continua de trabajo y recibió **2 nuevos commits empujados posteriormente** (`953bb61` a las `17:58:43` y `58a3cc7e` a las `18:36:24`), acumulando `8` archivos documentales (`+1,215 / -1` líneas) por delante de `main` sin ningún Pull Request abierto (`OPEN_PRS_COUNT = 0`).
- **`[VERIFIED]` Configuración de GitHub para ocultar el banner:** **No existe ninguna configuración legítima a nivel de repositorio en GitHub para desactivar el banner `"Compare & pull request"`** mientras una rama no predeterminada contenga commits nuevos no presentes en `main`. La única opción global existente en `Settings > General > Features` deshabilita por completo los Pull Requests, lo cual rompería la seguridad y revisión del flujo profesional.
- **`[RECOMMENDED]` Flujo permanente recomendado — Opción B (Rama dedicada por cada fase o *workstream* desde `main` actualizado):** Retirar `feature/phase-1a-core-foundation` una vez que el Project Owner decida qué documentos pendientes de `953bb61`/`58a3cc7e` se promueven a `main`, y a partir de entonces iniciar cada nuevo bloque de trabajo (p. ej. `WS-R2.0`, `WS-R2.1`, etc.) en una rama nueva nacida del `main` verificado más reciente, integrándola por Pull Request únicamente cuando el trabajo esté listo y aprobado, y cerrando dicha rama después de integrarla.

---

## 2. Estado Exacto del Repositorio (`Pre-Flight Verified`)

Todos los puntos 1–15 de auditoría previa se verificaron directamente en vivo sin modificar archivos ni configuraciones (`[VERIFIED]`):

| Elemento auditado | Evidencia exacta verificada |
|---|---|
| **Raíz del repositorio** | `C:/Users/juanc/OneDrive/Documentos/Desarrollo proyectos/Sistema Musical - Partituras/BETHESDA WORSHIP STUDIO` |
| **Visibilidad y rama predeterminada en GitHub** | Repositorio público (`PRIVATE=False`), `DEFAULT_BRANCH = main`, URL `origin`: `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO.git` |
| **Rama local activa (`HEAD`)** | `feature/phase-1a-core-foundation` → **`58a3cc7e457eea4aa1abc5f5b95d3130e521c1e7`** |
| **Sincronización local vs remoto** | `main` vs `origin/main`: **`0 0`** \| `feature/phase-1a-core-foundation` vs `origin/feature/phase-1a-core-foundation`: **`0 0`** |
| **Relación `feature/phase-1a-core-foundation` vs `main`** | **`2 1`** (`2` commits por delante en `feature`: `953bb61`, `58a3cc7e`; `1` commit por detrás: el commit de merge `97ae7c60` en `main`) |
| **Ancestro común (`git merge-base`)** | **`765a6312780ae155be3be7b2e19cbebbb56856c5`** (`765a6312` sí es ancestro de `main`, exit `0`) |
| **Estado de árbol de trabajo, índice y stashes** | Antes de generar este informe: `git status -uall --porcelain=v1` vacío, `git diff --stat` vacío, `git diff --cached` vacío, `0` stashes |
| **Referencia caché local residual** | `remotes/origin/revert-1-feature/phase-1a-core-foundation` (`766650c`) aún existe **solo en caché local** (confirmada **ausente en GitHub** vía `git ls-remote origin`) |
| **Protección de ramas (`GitHub API`)** | `PROTECTED = False` tanto en **`main`** como en **`feature/phase-1a-core-foundation`** |
| **Pull Requests en GitHub (`API`)** | Total histórico: `1` (`#1`, cerrado y mergeado). Pull Requests abiertos actualmente: **`0`** (`OPEN_PRS_COUNT = 0`) |
| **Configuración local relevante (`.git/config`)** | `branch.main.remote=origin`, `branch.main.merge=refs/heads/main`; `branch.feature/phase-1a-core-foundation.remote=origin`, `branch.feature/phase-1a-core-foundation.merge=refs/heads/feature/phase-1a-core-foundation` (+ `vscode-merge-base=origin/main` en ambas) |

---

## 3. Ramas y SHAs de Commits Verificados (`Branches and Commit SHAs`)

### 3.1 Referencias Locales y Remotas (`[VERIFIED]`)

| Referencia | SHA exacto (40 caracteres) | Mensaje / Estado |
|---|---|---|
| `main` (local) / `origin/main` (remoto vivo) / `origin/HEAD` | `97ae7c6039aa208beb5a64c6592fba0085ba0d1d` | `Merge pull request #1 from juancastro2381-hub/feature/phase-1a-core-foundation` (Padres: `36979be6` + `765a6312`) |
| `feature/phase-1a-core-foundation` (local y remoto vivo) | `58a3cc7e457eea4aa1abc5f5b95d3130e521c1e7` | `CONTROLLED POST-REVERSAL DOCUMENT GOVERNANCE PROMOTION` (`2026-11-21 18:36:24 -0500`) |
| `feature~1` (`953bb61`) | `953bb61272b15df8ba29a9b4c795097d66760cdb` | `PHASE R2.0 LOCAL DOCUMENT PRESERVATION AND GIT SAFETY CHECKPOINT` (`2026-11-21 17:58:43 -0500`) |
| `refs/pull/1/head` (remoto vivo) / `merge-base(feature, main)` | `765a6312780ae155be3be7b2e19cbebbb56856c5` | `Reporte Ejecutivo — Certificación y Compuerta Controlada WS-R2.0 (Fase R2)` (`2026-11-21 16:53:31 -0500`) |
| `remotes/origin/revert-1-feature/phase-1a-core-foundation` *(solo caché local)* | `766650ceb3e8818ac3c32023d7d87338364850ac` | `Revert "Feature/phase 1a core foundation"` — eliminada en GitHub; persiste localmente por falta de `git fetch --prune` |

### 3.2 Historial Reciente Comparado (`[VERIFIED]`)

```text
* 58a3cc7 (HEAD -> feature/phase-1a-core-foundation, origin/feature/phase-1a-core-foundation) [2026-11-21 18:36:24]
|   Añade 2 docs: DOCUMENT_GOVERNANCE_DISPOSITION_REVIEW.md y POST_REVERSAL_OWNER_DECISION_AND_DOCUMENT_DISPOSITION_PLAN.md
* 953bb61 [2026-11-21 17:58:43]
|   Añade 5 docs nuevos + actualiza MATRIX (+2/-1 líneas)
|
|   * 97ae7c6 (main, origin/main, origin/HEAD) [2026-11-21 16:56:13] Merge PR #1
|  /|
|/  |
* 765a631 [2026-11-21 16:53:31] (refs/pull/1/head — Base común exacta / merge-base)
* d935344 [2026-11-21 16:40:18]
* 83fbe26 [2026-11-21 15:28:32]
* 2ebb0fd [2026-11-21 14:44:37] Cierre formal Fase R1
```

---

## 4. Estado del Pull Request `#1` (`[VERIFIED]`)

Consulta directa mediante API REST de GitHub (`/repos/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO/pulls?state=all`):

- **Número:** `#1` (`TOTAL_PRS = 1`, `OPEN_PRS_COUNT = 0`)
- **Título:** `Feature/phase 1a core foundation`
- **Estado:** `closed` con **`merged = true`**
- **Fecha exacta de integración (`merged_at`):** `2026-11-21T21:56:14Z` (`16:56:13 -0500`)
- **Origen (`head`):** `feature/phase-1a-core-foundation` capturado en **`765a6312780ae155be3be7b2e19cbebbb56856c5`** (`refs/pull/1/head`)
- **Destino (`base`):** `main` (`36979be69cfc24677a54cf65bf34785afad6f494`) → produjo el commit de merge **`97ae7c6039aa208beb5a64c6592fba0085ba0d1d`**
- **Conclusión clave:** PR `#1` quedó **definitivamente cerrado e integrado**. Ninguno de los commits posteriores (`953bb61` ni `58a3cc7e`) pertenece a PR `#1`, y GitHub no reabre un PR ya mergeado ni bloquea nuevos *pushes* sobre la rama origen si no se eliminó la rama tras el merge.

---

## 5. Explicación Técnica del Banner `"Compare & pull request"` y Configuraciones Opcionales en GitHub

### 5.1 Por qué aparece y si es normal (`[VERIFIED]` / `[INFERRED]`)

1. **Comportamiento nativo normal de GitHub (`[VERIFIED]`):** Cuando cualquier usuario con permisos de escritura ejecuta `git push` hacia una rama distinta de la rama predeterminada (`main`), GitHub evalúa si esa rama tiene commits recientes que no existen aún en `main` y si carece de un Pull Request abierto (`OPEN_PRS_COUNT = 0`). Al cumplirse ambas condiciones, GitHub renderiza automáticamente el recuadro superior `"<rama> had recent pushes X minutes ago"` junto al botón verde **"Compare & pull request"**.
2. **Qué está ocurriendo en `BETHESDA WORSHIP STUDIO` (`[VERIFIED]`):**
   - `feature/phase-1a-core-foundation` (`58a3cc7e`) dejó de ser idéntica a `main` (`97ae7c60`) apenas `62` minutos después del merge de PR `#1` (`16:56:13` → `17:58:43`), al empujarse `953bb61`, y volvió a adelantarse `38` minutos después con `58a3cc7e` (`18:36:24`).
   - El diff actual `main..feature/phase-1a-core-foundation` muestra **`8 files changed, 1215 insertions(+), 1 deletion(-)`** no presentes en `main`.
   - En consecuencia, cada vez que se empuja un nuevo commit a `feature/phase-1a-core-foundation`, GitHub detecta actividad reciente con cambios sin integrar y **vuelve a mostrar el banner `"Compare & pull request"`**, invitando a abrir un eventual PR `#2`.
3. **¿Es causado por divergencia o un error? (`[INFERRED]`):** Técnicamente `feature` y `main` tienen relación **`2 1`** (divergencia menor de historia porque `main` tiene el merge commit `97ae7c60` y `feature` tiene `953bb61` + `58a3cc7e`), pero el disparador real del banner **no es un error de Git**, sino que **`feature/phase-1a-core-foundation` está adelantada con commits no presentes en `main` y sin PR abierto** porque se reutilizó la misma rama después de mergear PR `#1`.

### 5.2 Investigación de Configuración Opcional en GitHub (`[VERIFIED]`)

- **¿Existe una opción legítima de repositorio para apagar solo el banner `"Compare & pull request"`?** **NO.** Según la documentación oficial de GitHub y las opciones verificadas del repositorio, **GitHub no ofrece ningún ajuste de repositorio ni de rama que suprima ese banner** mientras se empujen commits a una rama distinta de `main` con cambios pendientes respecto a `main`.
- **Qué sí existe (y por qué NO conviene):**
  - En `Settings > General > Features` de un repositorio se puede desactivar completamente la función de Pull Requests (o restringir quién los abre), pero esto oculta la pestaña entera de Pull Requests y elimina el flujo de revisión antes de integrar en `main`.
  - Silenciar notificaciones por correo o alertas en perfil tampoco quita el banner web contextual de *"recently pushed branches"* para usuarios con acceso de escritura; dicho aviso desaparece únicamente tras transcurrir un tiempo sin *pushes*, al abrir el PR correspondiente, o cuando la rama ya no tiene commits por delante / es retirada tras su merge.

---

## 6. Causa Raíz Confirmada por Evidencia del Repositorio (`[VERIFIED]`)

La causa raíz verificada se resume en **tres hechos combinados**:

1. **Reutilización indefinida de una rama ya fusionada (`feature/phase-1a-core-foundation` actuando como rama de desarrollo permanente):** PR `#1` integró la Fase 1A + Fase R1 + certificación inicial R2 (`765a6312`), pero la rama siguió abierta y activa como entorno único donde se agregaron `953bb61` y `58a3cc7e` (que juntos suman `8` documentos aún ausentes en `main`).
2. **Desacople tras PR `#1` (`2 1`):** `main` solo recibió el commit de merge `97ae7c60`, mientras `feature/phase-1a-core-foundation` siguió acumulando commits propios (`2` adelante). Por definición de flujo PR de GitHub, cualquier rama distinta de `main` con commits no integrados vuelve a activar la sugerencia de Pull Request en cada nuevo `git push`.
3. **Ausencia de reglas formales de ciclo de vida de ramas y protección (`PROTECTED=False`):** Al no existir cierre formal de rama tras PR `#1`, ni protección en `main`, cualquier *push* posterior sobre la rama histórica reabre la tentación visual de hacer PR o revert accidentales desde la interfaz web.

---

## 7. Análisis Comparativo de las Opciones A, B y C

| Dimensión evaluada | Opción A: Rama continua (`feature/phase-1a-core-foundation` permanente) | Opción B: Rama nueva por cada fase / *workstream* desde `main` **(RECOMENDADA)** | Opción C: Desarrollo directo sobre `main` (sin ramas ni PRs) |
|---|---|---|---|
| **¿Es técnicamente posible?** | Sí (`feature` sigue desprotegida y empujable). | Sí (`main` es estable y permite crear ramas nuevas limpias en cada fase). | Sí actualmente (`PROTECTED = False` en `main`, `[VERIFIED]`). |
| **Impacto en banner `"Compare & pull request"`** | El banner reaparecerá **cada vez** que se empuje un commit a `feature/phase-1a-core-foundation`, mostrando diffs acumulados (`8+` archivos). | El banner aparece **solo cuando tiene sentido** (cuando una rama de trabajo nueva recibe commits listos o en progreso hacia `main`), y desaparece al cerrar/retirar la rama tras el merge. | No mostraría el banner porque no habría ramas secundarias, pero a costa de eliminar toda compuerta previa a `main`. |
| **Seguridad para desarrollo asistido por IA (Antigravity)** | **Media-Baja:** Mezcla commits de Fase 1A, R1, incidentes Git y futuros cambios R2 en una sola rama de `100+` commits con nombre obsoleto (`phase-1a`). | **Muy Alta:** Aísla cada fase (`WS-R2.0`, `WS-R2.1`, etc.) en un área controlada. Si algo falla o debe descartarse, `main` queda `100%` intacto y el alcance del PR se limita solo a esa fase. | **Peligrosa / Inapropiada:** Cualquier regresión accidental de IA, refactor incompleto, prueba rota o error en migración entra directo en `main` sin vista previa ni punto de retorno aislado; eleva el riesgo de pérdida de estabilidad del producto. |
| **Claridad de historial y recuperación** | Difícil auditar dónde termina Fase R1 y dónde empieza cada remediación R2; favorece merges gigantes (como PR `#1` con `106` commits / `754` archivos, causa indirecta del pánico/revert posterior). | Historial cristalino: cada PR integra una sola unidad lógica verificada; facilita revertir una sola fase sin tocar las demás. | Sin PRs de fase ni checkpoints revisables; el historial de `main` se vuelve ruidoso y difícil de revertir por bloques. |
| **Complejidad para un Project Owner no desarrollador** | Genera ansiedad visual por el botón constante `"Compare & pull request"` y diffs gigantes acumulados. | **Simple si Antigravity sigue un protocolo estricto** (`main` siempre limpio; trabajar solo en la rama del *workstream* autorizado; abrir PR solo al finalizar el *workstream*). | Aparentemente más corta en clics, pero altamente riesgosa ante cualquier error que requiera revertir cambios mezclados en `main`. |

---

## 8. Flujo de Trabajo Recomendado (`Recommended Workflow` — `[RECOMMENDED]`)

Diseñado específicamente para ser **seguro, auditable, simple para el Project Owner y compatible con desarrollo asistido por IA (Antigravity)**:

```text
[main (Base estable verificada, siempre lista para uso/referencia)]
   │
   ├──> Paso 1: Crear 1 rama para el workstream autorizado
   │      Ej.: docs/post-reversal-sync (o feature/ws-r2-0-prerequisites)
   │
   ├──> Paso 2: Antigravity trabaja y guarda checkpoints SOLO en esa rama
   │      (Solo hace push cuando el Owner pide respaldo remoto o revisión;
   │       no es necesario hacer push tras cada micro-edición)
   │
   ├──> Paso 3: Evidencia + Validación del Owner antes de integrar
   │
   ├──> Paso 4: Abrir 1 Pull Request limpio cuando el workstream esté listo
   │      (Aquí el botón "Compare & pull request" ES útil y deseado)
   │
   └──> Paso 5: Merge a main + Actualizar main local + Retirar/No reutilizar la rama cerrada
          └──> Siguiente workstream nace desde el nuevo main actualizado
```

### Principios operativos sencillos para el Project Owner:
1. **`main` es sagrado (`baseline` estable):** Nunca se codifica directamente sobre `main`. Si mañana la aplicación o una IA comete un error en una rama de trabajo, `main` sigue funcionando intacto.
2. **Una rama = Un objetivo claro (con fecha de cierre):** En lugar de usar `feature/phase-1a-core-foundation` para todo el proyecto para siempre, cada *workstream* aprobado usa su propia rama nombrada según lo que resuelve (por ejemplo: `feature/ws-r2-0-prerequisites`, `feature/ws-r2-1-music-integrity`, `docs/ws-r2-governance-sync`).
3. **Menos *pushes* fragmentados = menos ruido en GitHub:** Si se trabaja en varios pasos locales dentro de una rama autorizada, hacer `git push` solo en hitos revisables (por ejemplo al completar un bloque o al pedir respaldo) reduce avisos innecesarios y mantiene un único Pull Request limpio al final del *workstream*.
4. **No usar el botón `"Revert"` de GitHub tras un PR grande sin asesoría previa:** Si algo sale mal después de un merge, abrir una consulta de diagnóstico antes de pulsar *Revert* en GitHub UI (evita incidentes como el de `766650c`).

---

## 9. Protocolo Obligatorio de Pre-Flight de Antigravity (`Antigravity Pre-Flight Protocol` — `[RECOMMENDED]`)

Antes de iniciar **cualquier** implementación, edición de código, migración o commit futuro en Bethesda Worship Studio, Antigravity **debe** ejecutar y reportar obligatoriamente este checklist de solo lectura:

1. **Confirmar raíz del repositorio:** Ejecutar `git rev-parse --show-toplevel` y verificar que apunta exactamente a `.../BETHESDA WORSHIP STUDIO` (nunca al repositorio ajeno `C:\Users\juanc\.git`).
2. **Confirmar rama activa y upstream:** Ejecutar `git rev-parse --abbrev-ref HEAD` y `git branch -vv` para comprobar qué rama local está activa y a qué rama remota rastrea.
3. **Confirmar `HEAD` exacto:** Ejecutar `git rev-parse HEAD` y contrastar el SHA de 40 caracteres con el último checkpoint aprobado.
4. **Confirmar sincronización con `main`:** Comparar `main...origin/main` y `<rama_actual>...main` (`git rev-list --left-right --count`) para verificar si la rama nació de `main` actualizado o si está rezagada/divergida.
5. **Confirmar estado del árbol de trabajo e índice:** Ejecutar `git status -uall --porcelain=v1` y `git diff --cached --name-status`, identificando explícitamente si existen archivos modificados o sin seguimiento antes de empezar.
6. **Confirmar autorización explícita de rama y *workstream*:** Verificar que la rama actual coincide exactamente con la autorizada por el Project Owner para el *workstream* en curso y que fue creada desde el `main` vigente (salvo excepción explícita aprobada por escrito).
7. **Regla estricta de parada (`HARD STOP`):** Si la rama activa **NO** está autorizada para el *workstream* actual (por ejemplo, si sigue apuntando a la rama histórica ya cerrada `feature/phase-1a-core-foundation` o a `main` directamente cuando corresponde una nueva rama):
   - **DETENERSE INMEDIATAMENTE.**
   - **NO** ejecutar automáticamente cambios de rama, creaciones de ramas, merges, rebases, resets, cherry-picks, commits, pushes, eliminaciones de ramas ni ediciones de configuración Git.
   - Reportar el desajuste al Project Owner y solicitar autorización explícita antes de cualquier mutación Git.

---

## 10. Política de Autorización de Mutaciones Git (`Git Mutation Authorization Policy` — `[RECOMMENDED]`)

| Categoría de comando Git | ¿Requiere autorización explícita previa del Project Owner? | Regla operativa para sesiones AI |
|---|---|---|
| Lectura (`status`, `diff`, `log`, `show`, `branch -avv`, `rev-parse`, `ls-remote`, `ls-files`, `merge-base`, `reflog`) | **No** (siempre permitido para verificación) | Usar libremente para auditoría y pre-flight. |
| Creación / cambio de rama (`branch`, `switch`, `checkout -b`) | **Sí — Obligatoria** | Indicar rama base exacta (`main` SHA), nombre propuesto de la nueva rama y estado del árbol antes de ejecutar. |
| Registro de cambios (`add`, `commit`) y subida (`push`) | **Sí — Obligatoria** | Mostrar resumen de archivos y diff (`git diff --stat`) y rama destino antes de commitear o empujar. |
| Mantenimiento remoto/local (`fetch --prune`, borrado de rama local/remota, cierre/merge de PR) | **Sí — Obligatoria** | Confirmar respaldo/integración verificada de cualquier commit único antes de podar o retirar una rama. |
| Reescritura o comandos destructivos (`reset --hard`, `clean -fd`, `rebase` público, `push --force`, `stash drop`) | **Prohibido por defecto (requiere mandato forense excepcional explícito)** | Nunca utilizar en flujo normal; priorizar *fast-forward*, PRs limpios y respaldos externos verificados. |

---

## 11. Protocolo de Ciclo de Vida de Ramas (`Branch Lifecycle Protocol` — `[RECOMMENDED]`)

1. **Creación:** Toda rama funcional o de remediación nace desde `main` sincronizado con `origin/main`, usando prefijo claro:
   - `feature/<fase-o-modulo>` (funcionalidades y remediaciones técnicas: p. ej. `feature/ws-r2-1-music-integrity`)
   - `chore/<tarea-infra-o-prerrequisito>` (prerrequisitos/higiene: p. ej. `chore/ws-r2-0-prerequisites`)
   - `docs/<alcance-documental>` (promoción o cierre puramente documental)
   - `hotfix/<incidente>` (corrección urgente aislada desde `main`)
2. **Uso activo:** Todo el trabajo de ese *workstream* ocurre exclusivamente dentro de esa rama hasta cumplir su criterio de aceptación.
3. **Cierre tras integración:** Una vez que su Pull Request se integra en `main`, la rama **se considera cerrada y no vuelve a recibir nuevos commits**. Tras validar que `main` contiene el resultado esperado, se puede retirar la rama cerrada (con autorización del Owner) y cambiar localmente a `main` actualizado (`git pull --ff-only origin main`).

---

## 12. Protocolo de Ciclo de Vida de Pull Requests (`Pull Request Lifecycle Protocol` — `[RECOMMENDED]`)

1. **Cuándo NO abrir un PR:** No abrir Pull Requests para cada commit intermedio ni mantener un PR abierto prematuramente si un *workstream* sigue incompleto y sin validación.
2. **Cuándo SÍ abrir un PR:** Únicamente cuando el *workstream* completo ha pasado sus pruebas/validaciones requeridas, tiene su informe/evidencia lista y el **Project Owner autoriza la integración en `main`**.
3. **Alcance acotado:** Cada PR debe corresponder a un único objetivo verificable (idealmente decenas de archivos o un bloque bien delimitado, evitando acumular múltiples fases dispares en un único PR masivo).
4. **Cierre post-merge:** Al aprobarse e integrarse el PR en `main`, cerrar/retirar la rama origen según el Protocolo de Ciclo de Vida de Ramas para que GitHub no siga asociando actividad futura a una rama históricamente fusionada.

---

## 13. Consideraciones de Rollback y Recuperación (`Rollback and Recovery Considerations` — `[VERIFIED]` / `[RECOMMENDED]`)

- **Lección directa del incidente `#1` (`766650c`, `[VERIFIED]`):** Un Pull Request grande que mezcla múltiples fases produce en GitHub un único botón *"Revert"* que, si se presiona por error, genera un commit que intenta borrar de golpe todo el bloque histórico (`754` archivos / `132,410` líneas en PR `#1`). Trabajar con PRs más pequeños por *workstream* acota enormemente el radio de cualquier reversión legítima si alguna vez hiciera falta.
- **Recuperación segura demostrada (`[VERIFIED]`):** Para actualizar `main` local sin tocar archivos pendientes en otra rama, `git fetch origin main:main` (sin `+`) demostró ser atómico, reversible y seguro (`36979be..97ae7c6`), aunque **no** debe usarse como sustituto permanente de cerrar ramas viejas.
- **Resguardo ante el repositorio padre `C:\Users\juanc\.git` (`[VERIFIED]`):** Hallazgo previo confirmado en disco: existe un `.git` en `C:\Users\juanc\.git` por encima de OneDrive. Toda sesión debe validar `--show-toplevel` para asegurar que ningún rollback o respaldo accidental opere sobre el directorio de usuario.

---

## 14. Riesgos Identificados (`Risks`)

1. **`[VERIFIED]` Rama `main` y `feature` sin protección en GitHub (`PROTECTED = False`):** Actualmente cualquiera con permisos de escritura podría empujar directamente o borrar `main` en GitHub sin bloqueo preventivo ni revisión obligatoria de Pull Request.
2. **`[VERIFIED]` Divergencia actual sin resolver entre `feature/phase-1a-core-foundation` (`58a3cc7e`) y `main` (`97ae7c60`):** `8` archivos documentales post-PR#1 (`+1,215 / -1` líneas) solo existen en `feature/phase-1a-core-foundation` y aún no han sido promovidos selectivamente a `main`. Si se creara una rama nueva de `WS-R2.0` desde `main` hoy sin resolver esa promoción, el Registro de Decisiones POD (`#2`) y la matriz actualizada (`#1`) no estarían todavía en la rama nueva.
3. **`[VERIFIED]` Repetición del banner `"Compare & pull request"` y fatiga de decisión:** Seguir empujando commits (como informes nuevos) a `feature/phase-1a-core-foundation` seguirá activando el banner en GitHub mientras la rama siga por delante de `main` y abierta.
4. **`[VERIFIED]` Documentos sin respaldo externo completo frente a los últimos commits:** Según lo verificado previamente, el respaldo externo `C:\Users\Public\Documents\BETHESDA_WORSHIP_STUDIO_LOCAL_DOCS_BACKUP_20261121` contiene solo `#1`–`#5` (faltan `#6`, `DOCUMENT_GOVERNANCE_DISPOSITION_REVIEW.md`, `POST_REVERSAL_OWNER_DECISION_AND_DOCUMENT_DISPOSITION_PLAN.md` y este nuevo informe en copia externa, aunque `#6` y los dos anteriores ya están respaldados en `origin/feature/phase-1a-core-foundation`).
5. **`[VERIFIED]` Referencia local obsoleta `remotes/origin/revert-1-feature/phase-1a-core-foundation` (`766650c`):** No afecta a GitHub ni al código, pero sigue visible en `git branch -avv` localmente hasta ejecutar `git fetch --prune origin`.

---

## 15. Decisiones Pendientes de Autorización del Project Owner (`[REQUIRES PROJECT OWNER APPROVAL]`)

Ninguna de las siguientes decisiones ha sido ejecutada o asumida:

1. **Adopción formal de la Estrategia Opción B (Rama dedicada por *workstream* desde `main`) y del Protocolo de Seguridad de Antigravity:** ¿Aprueba establecer este flujo permanente para todo trabajo futuro en Bethesda Worship Studio?
2. **Disposición final de los commits posteriores a PR `#1` (`953bb61` y `58a3cc7e` en `feature/phase-1a-core-foundation`):** Decidir qué documentos de esos `8` archivos (junto con el tratamiento de `#1` en raíz vs `docs/governance/`, y los documentos de revisión posteriores) se promueven a `main` mediante una única rama documental limpia antes de retirar `feature/phase-1a-core-foundation`.
3. **Retiro y limpieza de referencias históricas tras promover a `main`:**
   - ¿Autoriza retirar/dejar de usar `feature/phase-1a-core-foundation` (local y/o remota en GitHub) **únicamente después** de confirmar que todo lo necesario de `953bb61`/`58a3cc7e` esté en `main` o respaldado externamente?
   - ¿Autoriza ejecutar `git fetch --prune origin` para limpiar la referencia caché local `remotes/origin/revert-1-feature/phase-1a-core-foundation`?
4. **Protección de la rama `main` en GitHub (`PROTECTED = False` actualmente):** ¿Desea activar reglas básicas de protección sobre `main` en GitHub (por ejemplo: requerir Pull Request antes de fusionar, impedir *force-push* y evitar eliminación accidental de `main`) una vez resuelta la promoción documental pendiente?
5. **Confirmación de este informe en Git (`git add` / `commit` / `push`):** Al finalizar esta auditoría, `BETHESDA_WORSHIP_STUDIO_GIT_WORKFLOW_GOVERNANCE_AUDIT.md` queda sin seguimiento en el árbol local; el Owner debe indicar dónde y en qué rama autoriza confirmarlo (idealmente en la futura rama documental limpia desde `main` para evitar seguir agregando commits en `feature/phase-1a-core-foundation` y reactivar allí el banner de Pull Request).
6. **Gobernanza técnica `WS-R2.0` (`POD-01`–`POD-05` + `GATE 2`):** Sigue intacta y **`NO AUTORIZADA`** hasta firma explícita del Project Owner.

---

## 16. Recomendaciones Finales (`[RECOMMENDED]`)

1. **Aceptar que el banner `"Compare & pull request"` fue un síntoma útil y normal:** Confirmó exactamente que `feature/phase-1a-core-foundation` tiene commits posteriores a PR `#1` (`953bb61`, `58a3cc7e`) que `main` aún no tiene. No requiere buscar trucos ni desactivar Pull Requests en GitHub.
2. **Aprobar la transición ordenada hacia la Opción B:**
   - Consolidar en una **última rama limpia desde `main`** (sin arrastrar archivos locales excluidos como `#6`) la promoción documental deseada hacia `main` —incluyendo si el Owner lo decide esta auditoría— e integrarla mediante un PR limpio.
   - Ejecutar `git fetch --prune origin` con permiso del Owner y retirar/cerrar definitivamente `feature/phase-1a-core-foundation` como rama de desarrollo continua.
3. **Activar reglas básicas de protección en `main` (`Settings > Branches`)** para que ninguna sesión humana o de IA pueda alterar `main` directamente por accidente.
4. **Hacer cumplir en todas las futuras sesiones el Protocolo Pre-Flight de la Sección 9**, garantizando que toda nueva fase (`WS-R2.0` en adelante) arranque limpia desde `main` actualizado y únicamente bajo autorización explícita del Project Owner.
