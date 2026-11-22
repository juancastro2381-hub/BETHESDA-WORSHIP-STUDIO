# BETHESDA WORSHIP STUDIO — ESTÁNDAR PERMANENTE DE FLUJO GIT Y GOBERNANZA DE DESARROLLO

**Proyecto:** Bethesda Worship Studio  
**Repositorio:** `https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO.git`  
**Rama estable predeterminada:** `main`  
**Alcance:** Política permanente de ramas, pre-flight de Antigravity, disciplina de commits/PRs, protección recomendada y retiro seguro de ramas.

---

## 1. Estrategia de Ramas

Bethesda Worship Studio utiliza el modelo **`main` + Ramas Acotadas por Workstream**:

1. **`main` (Rama Estable):** Representa el estado integrado, revisado y aprobado del proyecto. Es siempre la línea base para todo nuevo workstream y **nunca** se utiliza como espacio casual de experimentación o edición directa.
2. **Ramas de Workstream (`feature/`, `fix/`, `docs/`, `chore/`, `hotfix/`):** Todo nuevo workstream autorizado debe nacer desde el `main` verificado más reciente y tener un alcance único y delimitado:
   - `feature/ws-r2-0-storage-foundation`
   - `fix/audio-ingestion-validation`
   - `docs/phase-2b-closure`
   - `chore/git-governance`
3. **Prohibición de reutilización indefinida:** Nunca debe seguir reutilizándose una rama antigua perteneciente a una fase ya cerrada o fusionada como espacio permanente de trabajo.

---

## 2. Pre-Flight Obligatorio Antes de Cualquier Workstream

Antes de iniciar un nuevo bloque de trabajo (código, migraciones, configuración o documentación), Antigravity **debe verificar en modo solo lectura** y reportar al Project Owner:

1. Identidad exacta del repositorio (`remote.origin.url`).
2. Raíz Git exacta (`git rev-parse --show-toplevel`), confirmando que opera exclusivamente dentro del directorio del proyecto (y nunca sobre un repositorio accidental en carpetas padre del perfil del sistema operativo).
3. Rama activa actual (`git rev-parse --abbrev-ref HEAD`) y upstream (`git branch -vv`).
4. Árbol de trabajo limpio (`git status -uall --porcelain=v1`), sin archivos modificados o sin seguimiento inesperados, sin staging residual y sin stashes ocultos.
5. Estado verificado de `main` y sincronización con `origin/main` (`0 0`). Si se autoriza sincronizar con remoto, usar solo avance limpio (`--ff-only` / `git fetch origin`).
6. Confirmación de que la nueva rama nace exactamente desde el `main` vigente aprobado y registro de su SHA base (`git rev-parse HEAD`).
7. Validación continua de alcance contra cambios no autorizados: archivos sensibles o credenciales (`.env`, tokens, llaves), migraciones de base de datos inesperadas, cambios en dependencias/lockfiles (`package*.json`, `requirements.txt`), cambios de infraestructura o comandos destructivos.

### Regla Estricta de Parada (`HARD STOP`)
Si la rama actual no corresponde al workstream autorizado, si existen cambios sin confirmar inesperados o si se detectan modificaciones fuera de alcance, **Antigravity debe detenerse de inmediato** sin ejecutar cambios de rama, merges, rebases, resets, force-push, limpiezas con `git clean` ni eliminaciones de archivos, y solicitar autorización explícita del Project Owner.

---

## 3. Disciplina de Commits y Push

- **Autorización:** Ningún `commit` ni `push` se ejecuta sin autorización explícita del Project Owner para el workstream en curso.
- **Staging explícito:** Usar rutas explícitas al preparar cambios; **nunca** ejecutar `git add .` a ciegas si hay incertidumbre en el árbol de trabajo.
- **Mensajes claros:** Usar mensajes descriptivos que identifiquen fase y objeto (p. ej. `docs(governance): ...`, `fix(audio): ...`, `feat(conversion): ...`).
- **Separación de alcances:** Mantener los cambios documentales o de gobernanza separados de los cambios funcionales de código o base de datos, evitando archivos no relacionados en un mismo commit.
- **Cero secretos o artefactos de máquina:** Nunca confirmar credenciales, secretos, salidas temporales de pruebas ni rutas privadas específicas de estación de trabajo cuando exista alternativa portátil.
- **Finales de línea (`core.autocrlf` en Windows):** Inspeccionar `git diff` antes de commitear para evitar ruido masivo de `LF`/`CRLF`.
- **Integridad de historial:** Prohibido ejecutar `push --force` o reescribir historial compartido (`reset --hard`, `rebase` sobre ramas ya empujadas) salvo mandato forense explícito tras respaldo externo verificado con SHA-256.
- **Frecuencia de `push`:** Agrupar subidas en hitos revisables y evitar micro-pushes fragmentados innecesarios.

---

## 4. Disciplina de Pull Requests y Aviso `"Compare & pull request"` en GitHub

- **Naturaleza informativa del banner:** El recuadro `"Compare & pull request"` de GitHub es un indicador visual estándar que aparece automáticamente cuando una rama distinta de `main` tiene commits recientes no presentes en `main` y carece de Pull Request abierto. **No indica un error** y no requiere acción inmediata.
- **Regla de apertura:** Nunca abrir un Pull Request por cada commit individual ni simplemente porque aparezca el banner de GitHub. Crear un Pull Request únicamente cuando el workstream completo esté revisado, validado con evidencia documentada y listo para integrarse en `main`.
- **Prohibición de desactivar PRs globalmente:** Nunca deshabilitar la función de Pull Requests en la configuración del repositorio; el control visual se logra manteniendo las ramas acotadas y cerrándolas tras su integración.

---

## 5. Política Recomendada de Protección Mínima para `main`

Toda configuración de GitHub requiere autorización explícita del Project Owner antes de aplicarse. Como estándar mínimo equilibrado para un proyecto individual asistido por IA:

- **Prevenir *force-push* sobre `main`** (protege el historial aprobado).
- **Prevenir eliminación accidental de `main`**.
- **Integrar mediante Pull Request** cuando se cierren workstreams formales; en proyectos de un solo aprobador en GitHub, evitar exigir aprobaciones de un segundo revisor distinto del autor que bloquearían al propio Project Owner si trabaja sin cuentas secundarias, y **no** activar *status checks* obligatorios de CI mientras no existan pipelines automatizados confiables y estables que los respalden.

---

## 6. Retiro Seguro de Ramas e Incidentes

1. **Retiro ordenado tras el merge:** Ninguna rama de workstream se elimina automáticamente sin autorización explícita del Project Owner. Antes de retirarla, verificar:
   - El commit o merge ya existe en `main`.
   - El Pull Request está cerrado y marcado como `merged`.
   - No quedan commits únicos ni cambios pendientes dentro de la rama.
   - Toda documentación o evidencia valiosa ya reside en `main` o en un respaldo externo verificado por SHA-256 fuera de cualquier árbol `.git`.
2. **Limpieza de referencias obsoletas:** Tras confirmar la eliminación remota de ramas ya integradas o descartadas, ejecutar `git fetch --prune origin` únicamente bajo autorización explícita del Project Owner.
3. **Ante incidentes o errores post-merge:** No utilizar el botón *"Revert"* de GitHub sobre merges masivos sin diagnóstico previo; documentar primero los árboles, padres y diffs antes de tomar acción correctiva.

---

## 7. Checklist Reutilizable por Nuevo Workstream

- [ ] Raíz Git verificada (`--show-toplevel`) e identidad del repositorio confirmada.
- [ ] `main` verificado y sincronizado con `origin/main` (`0 0`).
- [ ] Árbol de trabajo limpio (`git status -uall --porcelain=v1` vacío, `0` stashes).
- [ ] Alcance único del workstream confirmado por el Project Owner (recordando compuertas previas vigentes, p. ej. `WS-R2.0` solo si está expresamente autorizado).
- [ ] Nueva rama creada desde `main` actualizado y SHA base registrado.
- [ ] Validación completa del diff, hashes y escaneo de ausencia de secretos/rutas privadas antes de staging explícito.
- [ ] Commit(s) descriptivos, `push` de la rama y Pull Request abierto solo cuando el workstream esté validado y listo.
- [ ] Verificación en `main` tras el merge y retiro autorizado de la rama cerrada antes de iniciar la siguiente fase.
