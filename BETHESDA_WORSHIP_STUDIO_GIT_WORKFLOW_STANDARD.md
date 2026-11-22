# BETHESDA WORSHIP STUDIO — ESTÁNDAR PERMANENTE DE FLUJO DE TRABAJO GIT Y PROTOCOLO DE SEGURIDAD

**Proyecto:** Bethesda Worship Studio  
**Repositorio:** `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO.git`  
**Audiencia:** Project Owner (gestión asistida por IA) y sesiones operativas de Antigravity  
**Rama estable predeterminada:** `main`  
**Propósito:** Establecer un flujo Git simple, auditable, recuperable y seguro para desarrollo asistido por IA, eliminando acumulación indefinida de ramas, divergencias innecesarias y confusión con avisos de Pull Request en GitHub.

---

## 1. Estrategia General de Ramas (`Branch Strategy`)

Bethesda Worship Studio adopta un modelo simple basado en **`main` + Ramas Acotadas por Workstream**:

1. **`main` es siempre la línea base estable y verificada** del proyecto.
2. **Cada fase técnica, remediación, corrección o lote documental autorizado** se ejecuta en su propia rama acotada creada desde el último `main` verificado.
3. **Nunca se reutiliza indefinidamente una rama ya integrada en `main`** (como ocurrió históricamente con `feature/phase-1a-core-foundation` tras el PR `#1`).
4. **Cada rama cerrada mediante Pull Request se retira** tras verificar su integración en `main`, manteniendo limpio tanto el historial como GitHub.

---

## 2. Política de la Rama `main` (`Main Branch Policy`)

- `main` es exclusivamente la **rama de integración estable**.
- **Prohibido** usar `main` como espacio directo de programación, pruebas experimentales o ediciones directas de Antigravity.
- Toda rama nueva de trabajo debe nacer desde `main` previamente sincronizado con `origin/main` (`0 0`).
- `main` solo recibe cambios revisados e integrados a través de Pull Requests aprobados por el Project Owner (salvo recuperaciones *fast-forward* documentadas).
- **Prohibido** hacer `push --force` o reescribir el historial de `main` (`reset`, `rebase` público).
- **Recomendación de seguridad en GitHub:** Mantener protección básica sobre `main` (requerir Pull Request para fusionar, bloquear *force-push* y bloquear eliminación de rama), activable únicamente bajo autorización explícita del Project Owner.

---

## 3. Convención de Nombres por Workstream (`Workstream Naming Convention`)

Toda rama nueva debe nombrar claramente su tipo de alcance y objetivo único usando minúsculas y guiones:

| Prefijo | Cuándo utilizarlo | Ejemplos válidos |
|---|---|---|
| `feature/` | Nueva capacidad, fase funcional o paquete amplio de remediación | `feature/phase-2b-storage-governance`, `feature/phase-3-song-ingestion` |
| `fix/` | Corrección acotada de defecto técnico o validación puntual | `fix/audio-ingestion-validation` |
| `docs/` | Actualizaciones exclusivamente documentales, gobernanza o promoción de reportes | `docs/git-governance`, `docs/post-reversal-sync` |
| `chore/` | Higiene del repositorio, prerrequisitos, dependencias o mantenimiento controlado | `chore/repository-maintenance`, `chore/ws-r2-0-prerequisites` |
| `hotfix/` | Corrección urgente crítica aislada directamente desde `main` | `hotfix/auth-token-validation` |

**Regla de alcance:** Una rama debe corresponder a **un solo workstream autorizado**. Si termina ese bloque y surge otro distinto, se integra primero (o se cierra) y el siguiente nace desde `main` actualizado en una rama nueva.

---

## 4. Pre-Flight Obligatorio para Antigravity (`Mandatory Antigravity Pre-Flight Protocol`)

Antes de editar código, documentación técnica, configuraciones o ejecutar operaciones Git en **cualquier sesión futura**, Antigravity **debe ejecutar y reportar** este pre-flight de solo lectura para detectar:

1. **Repositorio equivocado:** Confirmar `git rev-parse --show-toplevel` apuntando exactamente a `.../BETHESDA WORSHIP STUDIO` (descartar influencia del repositorio ajeno detectado en `C:\Users\juanc\.git`).
2. **Rama equivocada:** Verificar `git rev-parse --abbrev-ref HEAD` (no estar directamente en `main` salvo lectura/fast-forward autorizado, ni en una rama histórica cerrada).
3. **Workstream equivocado:** Confirmar con el alcance del usuario que la rama actual corresponde exactamente al workstream solicitado.
4. **Árbol de trabajo sucio (`dirty working tree`):** Ejecutar `git status -uall --porcelain=v1` y `git diff --stat`.
5. **Archivos sin seguimiento (`untracked files`):** Inspeccionar `git ls-files --others --exclude-standard` (proteger reportes locales o documentos del Owner no confirmados).
6. **Cambios inesperados o en staging:** Verificar `git diff --cached --name-status` y `git stash list`.
7. **Rama obsoleta (`stale branch`):** Confirmar si la rama activa ya fue mergeada anteriormente en `main` (`git branch --merged main` / historial de PR).
8. **Divergencia de ramas:** Ejecutar `git rev-list --left-right --count <rama>...main` y `<rama>...origin/<rama>`.
9. **Falta de sincronización con `main`:** Verificar `main...origin/main` (`0 0`) antes de abrir ramas nuevas o iniciar trabajo.
10. **Cambios fuera del alcance autorizado:** Validar que ningún archivo tocado exceda la lista autorizada del workstream.
11. **Archivos sensibles o credenciales:** Vigilar que nunca aparezcan `.env`, llaves privadas, tokens o cadenas reales de conexión en cambios a confirmar.
12. **Migraciones de base de datos inesperadas:** Detectar cualquier creación/edición en `backend/src/db/migrations/` o `schema.ts` no autorizada explícitamente.
13. **Cambios en dependencias:** Detectar cualquier cambio en `package.json`, `package-lock.json` o `requirements.txt` no autorizado.
14. **Modificaciones de infraestructura:** Detectar cambios en `docker-compose`, scripts de arranque, CI o servidores no autorizados.
15. **Comandos destructivos:** Verificar que el plan de ejecución excluye `reset --hard`, `clean -fd`, `rebase` público, `push --force`, borrado de ramas y sobrescrituras no autorizadas.

### Regla Estricta de Parada (`HARD STOP`)
Si se detecta cualquiera de las condiciones críticas anteriores (rama equivocada/obsoleta, cambios sin confirmar inesperados, divergencia no autorizada, migraciones o dependencias inesperadas), **Antigravity DEBE DETENERSE inmediatamente y solicitar autorización del Project Owner**.  
Antigravity **nunca debe** resolver conflictos Git en silencio, borrar ramas, resetear historial, hacer *force-push*, limpiar archivos con `git clean`, reescribir commits, fusionar ramas ni descartar archivos del usuario por iniciativa propia.

---

## 5. Política de Commits (`Commit Policy`)

1. **Solo bajo autorización explícita del Project Owner** (o confirmación explícita de alcance autorizado).
2. Revisar siempre `git status -uall --porcelain=v1` y `git diff --stat` antes de añadir al índice (`git add`).
3. **Prohibido** hacer commits masivos sin revisión de `git diff --cached --stat`.
4. Usar mensajes claros en formato convencional:
   - `feat(<alcance>): ...`, `fix(<alcance>): ...`, `docs(<alcance>): ...`, `chore(<alcance>): ...`
5. **Control de fin de línea (Windows `core.autocrlf=true`):** Evitar commits que mezclen cambios masivos de `LF`/`CRLF` con contenido funcional; inspeccionar el diff para confirmar que solo cambian las líneas deseadas.
6. Nunca incluir secretos, archivos temporales, artefactos binarios residuales de prueba (`storage/` de tests) ni respaldos externos dentro del repositorio.

---

## 6. Política de Push (`Push Policy`)

1. Empujar únicamente ramas de trabajo explícitamente autorizadas (`git push origin <rama-autorizada>`), nunca `main` directamente y nunca con `--force`.
2. **Agrupar pushes en hitos reales de revisión o respaldo**, evitando hacer *push* tras cada micro-edición intermedia cuando el workstream sigue abierto localmente, ya que cada *push* reactiva avisos visuales en GitHub.
3. Verificar inmediatamente después `git rev-list --left-right --count HEAD...@{u}` (`0 0`).

---

## 7. Política de Pull Requests (`Pull Request Policy`)

Un Pull Request hacia `main` **solo debe abrirse cuando**:
1. El workstream autorizado está suficientemente completo según sus objetivos.
2. Su alcance y validación están documentados con evidencia verificable.
3. El diff completo frente a `main` fue revisado y no contiene archivos ajenos al workstream.
4. No persisten bloqueadores críticos abiertos dentro de ese alcance (salvo excepciones documentadas explícitamente aprobadas).

**Reglas específicas sobre GitHub UI:**
- **No abrir un Pull Request simplemente porque GitHub muestre el banner `"Compare & pull request"`.**
- **No desactivar globalmente los Pull Requests** en `Settings > General > Features`: rompería las compuertas de calidad del proyecto.
- Evaluar la activación de **protección básica de `main`** en GitHub (requerir PR, bloquear *force-push*, impedir borrado), ejecutándola únicamente tras aprobación explícita del Project Owner.

---

## 8. Política de Retiro de Ramas (`Branch Retirement Policy`)

Tras integrarse un Pull Request en `main`, la rama de trabajo **no debe seguir usándose para futuras fases**. Antes de retirarla (eliminación remota/local), **todos** estos pasos deben verificarse:

1. Confirmar que el commit o merge del workstream ya existe dentro de `main` (`git merge-base --is-ancestor <commit> main`).
2. Confirmar en GitHub que el Pull Request correspondiente figura como **cerrado e integrado (`merged`)**.
3. Confirmar que **no queda trabajo adicional pendiente** ni commits exclusivos sin integrar en dicha rama.
4. Confirmar que la rama ya no es necesaria para recuperación activa ni custodia de archivos sin respaldo.
5. **Solo con autorización explícita del Project Owner**, eliminar la rama remota ya integrada, ejecutar `git fetch --prune origin` para limpiar cachés locales y eliminar la rama local cerrada.
6. Si una rama histórica contiene commits posteriores a su PR original, promover selectivamente o respaldar primero su contenido antes de retirarla.

---

## 9. Explicación del Banner `"Compare & pull request"` de GitHub

El Project Owner debe tener absoluta tranquilidad sobre este aviso de GitHub:

1. **Qué es:** Es un botón automático de conveniencia de la interfaz web de GitHub que aparece a cualquier usuario con permiso de escritura cuando una rama distinta de `main` recibió commits recientes por `git push`, dichos commits **aún no existen en `main`** y **no hay ningún Pull Request abierto** para esa rama.
2. **Qué NO es:** **No es un error, no significa que el repositorio esté dañado y no obliga a hacer clic ni a crear un Pull Request.**
3. **Por qué reaparece tras cada `push` en una misma rama:** Si se fusiona un PR pero la rama origen **no se cierra/retira**, cualquier commit nuevo empujado a esa misma rama la vuelve a dejar "adelantada" frente a `main` y reactiva el banner tras cada `git push`.
4. **Configuración de GitHub:** **No existe ninguna opción legítima de repositorio en GitHub para ocultar únicamente este banner.** La única forma limpia y profesional de evitar avisos innecesarios es cerrar/retirar la rama una vez integrado su PR y trabajar siempre sobre ramas nuevas temporales solo durante cada workstream activo.

---

## 10. Reglas de Seguridad Git para Antigravity (`Antigravity Git Safety Rules`)

| Categoría | Ejemplos | Regla permanente |
|---|---|---|
| **Solo lectura** | `status`, `diff`, `log`, `show`, `branch -avv`, `rev-parse`, `ls-remote`, `ls-files`, `merge-base`, `reflog` | Permitido siempre para verificación y pre-flight. |
| **Escritura controlada** | `switch`, `checkout -b`, `add`, `commit`, `push`, `fetch origin`, `fetch --prune`, borrado de rama cerrada | **Requiere autorización explícita del Project Owner** caso por caso. |
| **Destructivo / Reescritura** | `reset --hard`, `clean -fd`, `rebase` de ramas compartidas, `push --force`, `stash drop`, borrado de rama no integrada | **Prohibido por defecto.** Exige mandato forense explícito tras respaldo externo SHA-256. |

---

## 11. Principios de Recuperación e Incidentes (`Recovery & Incident Principles`)

1. **PRs pequeños = rollbacks seguros:** Evitar acumular varias fases en un único PR masivo. Un PR acotado por workstream permite inspeccionar o revertir quirúrgicamente sin poner en riesgo meses de código.
2. **Nunca pulsar el botón `"Revert"` de GitHub tras un PR grande sin revisión previa:** Un *revert* sobre un commit de merge masivo revierte todo el bloque histórico completo.
3. **Respaldar fuera de cualquier `.git` antes de maniobras delicadas:** Cualquier archivo local sin confirmar valioso debe respaldarse con verificación SHA-256 fuera de `BETHESDA WORSHIP STUDIO` y fuera de `C:\Users\juanc\.git` (p. ej. en `C:\Users\Public\Documents\...`).
4. **Preferir *fast-forward* y ramas nuevas limpias:** Actualizar `main` mediante `--ff-only` o `git fetch origin main:main` (solo lectura sobre árbol activo) en lugar de forzar historial.

---

## 12. Compuertas de Aprobación del Project Owner (`Approval Gates`)

1. **Compuerta A — Inicio de Workstream:** El Owner aprueba el alcance y autoriza crear la nueva rama desde `main` verificado.
2. **Compuerta B — Commit y Push:** Antigravity presenta `git status` y `git diff --stat`; el Owner autoriza confirmar y empujar.
3. **Compuerta C — Apertura de Pull Request:** Solo tras validar pruebas/criterios y documentar evidencia.
4. **Compuerta D — Integración en `main`:** El Owner aprueba e integra el PR en `main`.
5. **Compuerta E — Retiro de Rama:** Confirmado el merge en `main` sin commits pendientes, el Owner autoriza retirar la rama cerrada y podar referencias locales obsoletas.

---

## 13. Ciclo Estandarizado de 18 Pasos y Checklist Reutilizable por Workstream

Usar esta lista en cada nuevo workstream autorizado:

- [ ] **1.** Verificar raíz del repositorio (`git rev-parse --show-toplevel` == `.../BETHESDA WORSHIP STUDIO`).
- [ ] **2.** Verificar rama activa actual (`git rev-parse --abbrev-ref HEAD`).
- [ ] **3.** Verificar que `main` y `origin/main` están sincronizados (`0 0`).
- [ ] **4.** Verificar árbol de trabajo limpio (`git status -uall --porcelain=v1` e índice vacío).
- [ ] **5.** Verificar ausencia de cambios locales sin resolver o archivos sin seguimiento inesperados.
- [ ] **6.** Confirmar por escrito el workstream y su alcance autorizado.
- [ ] **7.** *(Con autorización del Owner)* Crear rama dedicada desde `main` actualizado siguiendo la convención de nombres.
- [ ] **8.** Ejecutar la implementación exclusivamente dentro del alcance autorizado.
- [ ] **9.** Generar la documentación de implementación y evidencia de validación.
- [ ] **10.** Revisar todos los cambios y el `git diff` completo (`0` código/migraciones/dependencias no autorizadas).
- [ ] **11.** *(Con autorización del Owner)* Crear commit(s) con mensajes descriptivos.
- [ ] **12.** *(Con autorización del Owner)* Empujar la rama del workstream a `origin`.
- [ ] **13.** *(Con autorización del Owner)* Abrir un Pull Request hacia `main` cuando el workstream esté listo.
- [ ] **14.** Revisar el Pull Request junto con su evidencia de validación documentada.
- [ ] **15.** Fusionar el Pull Request a `main` únicamente al cumplirse todos los criterios de aceptación.
- [ ] **16.** Verificar la presencia del commit integrado en `main` y actualizar `main` local (`--ff-only`).
- [ ] **17.** *(Con autorización del Owner)* Retirar la rama completada una vez confirmada su seguridad.
- [ ] **18.** Iniciar el siguiente workstream nuevamente desde `main` actualizado.
