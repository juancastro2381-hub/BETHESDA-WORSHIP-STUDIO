# WP-04 — Independent Code Diff Review Package
**Revocation Read-Path Audit & Remediation Verification**  
**Bethesda Worship Studio — PWA Offline Subsystem (WP-04)**  
**Repository:** [https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO](https://github.com/juancastro2381-hub/BETHESDA-WORSHIP-STUDIO)  
**Target Branch:** `main`  
**Review Commit:** `4e9ca1ba7d97e07360566dc6a5d95036f5fb4146`  
**Baseline Commit:** `4448a9ab8d19b17df46b351da60d671d37aae84b`  
**Date:** 2026-10-18  
**Task Type:** Independent Code Diff Review, Architectural Trace, and Evidence Package (No Code Changes)

---

## 1. Document Control & Executive Summary

This document presents the independent, evidence-only code diff review of the security remediation applied to the WP-04 offline subsystem. The remediation addresses a critical security defect discovered during the revocation read-path audit:
1. When `BethesdaOfflineManager.checkForUpdates()` received an affirmative HTTP 401, 403, or 404 response from the server, it marked metadata as `FAILED`, but left the canonical music payload cached in IndexedDB `song_payloads`.
2. `BethesdaOfflineManager.getAuthorizedSongPayload()` only evaluated whether the 7-day grace period timestamp had expired. If the cached resource had a fresh timestamp (< 7 days), it returned the payload, bypassing the `FAILED` status.
3. The digital atril ([MusicalWorkspace.tsx](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/MusicalWorkspace.tsx#L173-L205)) and song selection modal ([DatabaseSongsModal.tsx](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/DatabaseSongsModal.tsx#L80-L95)) rendered the payload without independent status checks, and [OfflineInventoryModal.tsx](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/offline/OfflineInventoryModal.tsx#L320-L375) left action buttons enabled for `FAILED` items with fresh timestamps.

The remediation applied surgical, WP-04-only changes across three files to purge cached payloads upon revocation, enforce status guards across all read paths, update dependent setlist missing-song references, and gate UI buttons.

---

## 2. Working Tree & Commit Baseline Context

- **Baseline Commit (Prior State):** `4448a9ab8d19b17df46b351da60d671d37aae84b` (`WP-04 Targeted Remediation Summary`)
- **Remediation Commit (Current HEAD):** `4e9ca1ba7d97e07360566dc6a5d95036f5fb4146` (`DEFECT CONFIRMED AND FIXED`)
- **Current Working Tree Status:** Clean on `main`, zero staged modifications, zero source code alterations during this review.
- **Scope Isolation:** Bounded strictly to WP-04 offline core and UI. Phase 3B, Phase 3C, multitrack, OMR, and audio backend infrastructure are untouched. Audio remains blocked (Outcome C).

---

## 3. Verification Evidence

### A. Git Status Output
Command: `git status --short`  
Working Directory: Repository Root  
Exit Code: `0`  
Output:
```text
?? docs/wp04/WP04_INDEPENDENT_CODE_DIFF_REVIEW_PACKAGE.md
```
*(Confirms zero unstaged or staged source modifications; only this independent review document is present as untracked in the working tree).*

### B. Git Diff Name-Only Output (Remediation Commit Scope)
Command: `git diff 4448a9a 4e9ca1b --name-only`  
Working Directory: Repository Root  
Exit Code: `0`  
Output:
```text
docs/wp04/WP04_REVOCATION_READ_PATH_AUDIT_REPORT.md
frontend/src/components/offline/OfflineInventoryModal.tsx
frontend/src/core/offline/__tests__/offline-manager.test.ts
frontend/src/core/offline/offline-manager.ts
```

### C. Git Diff Check Output (Whitespace & Format Safety)
Command: `git diff --check 4448a9a 4e9ca1b -- frontend/`  
Working Directory: Repository Root  
Exit Code: `0`  
Output: `(clean, zero whitespace errors or format violations)`

### D. Summary of Test Execution History
*Note: As per governance instructions, automated tests were not rerun during this evidence-only review phase. The following results reflect the exact recorded outcomes executed immediately prior to commit `4e9ca1b`:*
- **Focused WP-04 Offline Unit Tests:** `node --test --experimental-strip-types "src/core/offline/__tests__/*.test.ts"` in `frontend/`  
  **Exit Code:** `0` | **Result:** 35 passed, 0 failed across 4 test suites (Storage, Manager Orchestration, Session Isolation, Setlist Packager).
- **Full Frontend Test Suite:** `npm test` in `frontend/`  
  **Exit Code:** `0` | **Result:** 316 passed, 0 failed across 49 test suites.
- **Frontend TypeScript Check:** `npm run typecheck` in `frontend/`  
  **Exit Code:** `0` | **Result:** `tsc --noEmit` passed with 0 errors.
- **Frontend Production Build:** `npm run build` in `frontend/`  
  **Exit Code:** `0` | **Result:** Vite v8.3.0 production bundle compiled in `dist/`.

---

## 4. Exact Unified Diffs

### 4.1. Core Orchestration Engine: `frontend/src/core/offline/offline-manager.ts`
File: [frontend/src/core/offline/offline-manager.ts](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/offline/offline-manager.ts)

```diff
diff --git a/frontend/src/core/offline/offline-manager.ts b/frontend/src/core/offline/offline-manager.ts
index f067d9f..43575b0 100644
--- a/frontend/src/core/offline/offline-manager.ts
+++ b/frontend/src/core/offline/offline-manager.ts
@@ -504,11 +504,27 @@ export class BethesdaOfflineManager {
    * Si la autorización expiró y el cliente está offline, bloquea la reproducción (Decisión U-01).
    */
   public async getAudioObjectUrl(audioId: string): Promise<string | null> {
+    const meta = await this.storage.getMetadata(audioId);
+    if (meta && meta.status === 'FAILED') {
+      throw new OfflineStorageError(
+        'UNAUTHORIZED_SESSION',
+        `El acceso a la pista de audio '${meta.title}' fue revocado por el servidor.`
+      );
+    }
+
     const record = await this.storage.getAudioRecord(audioId);
     if (!record || !record.blob) {
       return null;
     }
 
+    // Guard de seguridad contra audio revocado o en estado FAILED
+    if (record.metadata.status === 'FAILED') {
+      throw new OfflineStorageError(
+        'UNAUTHORIZED_SESSION',
+        `El acceso a la pista de audio '${record.metadata.title}' fue revocado por el servidor.`
+      );
+    }
+
     if (this.isAuthorizationExpired(record.metadata)) {
       if (!this.isOnline()) {
         throw new OfflineStorageError(
@@ -590,17 +606,17 @@ export class BethesdaOfflineManager {
    * Elimina selectivamente un recurso del almacenamiento local.
    * INVARIANTE: NUNCA afecta la base de datos ni los datos del servidor.
    */
-  public async deleteLocalResource(resourceId: string): Promise<void> {
-    await this.storage.deleteResource(resourceId);
-
-    // Si se eliminó una canción, actualizar los repertorios que dependían de ella
+  /**
+   * Actualiza los repertorios locales que dependían de una canción que fue eliminada o revocada.
+   */
+  private async updateSetlistsMissingSong(songId: string): Promise<void> {
     const setlists = (await this.storage.listMetadata()).filter((m) => m.resourceType === 'SETLIST');
     for (const sl of setlists) {
-      if (sl.associatedSongIds && sl.associatedSongIds.includes(resourceId)) {
+      if (sl.associatedSongIds && sl.associatedSongIds.includes(songId)) {
         const payload = await this.storage.getSetlistPayload(sl.id);
         if (payload) {
           const currentMissing = new Set(sl.missingSongIds ?? []);
-          currentMissing.add(resourceId);
+          currentMissing.add(songId);
           const updatedMeta: OfflineResourceMetadata = {
             ...sl,
             missingSongIds: Array.from(currentMissing),
@@ -611,6 +627,15 @@ export class BethesdaOfflineManager {
     }
   }
 
+  /**
+   * Elimina selectivamente un recurso del almacenamiento local.
+   * INVARIANTE: NUNCA afecta la base de datos ni los datos del servidor.
+   */
+  public async deleteLocalResource(resourceId: string): Promise<void> {
+    await this.storage.deleteResource(resourceId);
+    await this.updateSetlistsMissingSong(resourceId);
+  }
+
   // ==========================================================================
   // VERIFICACIÓN DE ACTUALIZACIONES Y VIGENCIA (DECISIÓN U-01)
   // ==========================================================================
@@ -648,11 +673,28 @@ export class BethesdaOfflineManager {
    * Obtiene la carga útil de una canción garantizando la vigencia de autorización offline.
    * Si la autorización expiró y el cliente está offline, BLOQUEA la lectura arrojando UNAUTHORIZED_SESSION.
    * Si está en línea, revalida la autorización contra el servidor.
+   * Si el recurso está en estado FAILED o revocado, BLOQUEA incondicionalmente la lectura.
    */
   public async getAuthorizedSongPayload(songId: string): Promise<OfflineSongPayload | null> {
+    const meta = await this.storage.getMetadata(songId);
+    if (meta && meta.status === 'FAILED') {
+      throw new OfflineStorageError(
+        'UNAUTHORIZED_SESSION',
+        `El acceso a la canción '${meta.title}' fue revocado por el servidor o no está disponible.`
+      );
+    }
+
     const payload = await this.storage.getSongPayload(songId);
     if (!payload) return null;
 
+    // Guard de seguridad contra contenido revocado o en estado FAILED
+    if (payload.metadata.status === 'FAILED') {
+      throw new OfflineStorageError(
+        'UNAUTHORIZED_SESSION',
+        `El acceso a la canción '${payload.metadata.title}' fue revocado por el servidor o no está disponible.`
+      );
+    }
+
     if (this.isAuthorizationExpired(payload.metadata)) {
       if (!this.isOnline()) {
         throw new OfflineStorageError(
@@ -698,13 +740,14 @@ export class BethesdaOfflineManager {
 
   /**
    * Compara los recursos locales con el catálogo online del servidor para detectar versiones más recientes.
-   * INVARIANTE (Finding C):
+   * INVARIANTE (Finding C & Revocation Read-Path Audit):
    * 1. Pagina exhaustivamente el catálogo del servidor sin truncar en 100 elementos.
    * 2. NUNCA infiere revocación por ausencia en respuestas parciales o errores de red.
    * 3. Compara números de versión reales (serverVersionNumber vs localVersionNumber) marcando UPDATE_AVAILABLE.
    * 4. Si la versión es igual o anterior, actualiza lastValidatedAt como revalidación exitosa.
    * 5. Para canciones ausentes del catálogo completo, realiza verificación dirigida con getSong(id);
-   *    solo marca FAILED si el servidor responde explícitamente 404 (eliminado) o 401/403 (revocado).
+   *    si el servidor responde 401/403 o 404, purga la carga útil de STORES.SONG_PAYLOADS, marca FAILED en metadatos,
+   *    y actualiza los repertorios dependientes para que el contenido revocado no permanezca accesible.
    * 6. Preserva la copia local válida intacta ante errores transitorios.
    */
   public async checkForUpdates(): Promise<{ updatedCount: number; revokedCount: number }> {
@@ -772,6 +815,8 @@ export class BethesdaOfflineManager {
 
             if (isUnauthorized) {
               revokedCount++;
+              // Purgar carga útil de la canción revocada para que no quede accesible en disco
+              await this.storage.deleteSongPayload(local.id);
               const meta = await this.storage.getMetadata(local.id);
               if (meta) {
                 await this.storage.saveMetadata({
@@ -780,6 +825,7 @@ export class BethesdaOfflineManager {
                   errorMessage: 'Autorización revocada por el servidor.',
                 });
               }
+              await this.updateSetlistsMissingSong(local.id);
             } else {
               // Falla transitoria: preservar la copia local válida y no extender lastValidatedAt
               console.warn(`⚠️ Error de red o transitorio al consultar versión de '${local.id}'. Preservando copia local.`);
@@ -821,6 +867,8 @@ export class BethesdaOfflineManager {
 
             if (isRevokedOrRemoved) {
               revokedCount++;
+              // Purgar carga útil de la canción retirada/revocada para que no quede accesible en disco
+              await this.storage.deleteSongPayload(local.id);
               const meta = await this.storage.getMetadata(local.id);
               if (meta) {
                 await this.storage.saveMetadata({
@@ -829,6 +877,7 @@ export class BethesdaOfflineManager {
                   errorMessage: 'Autorización revocada o recurso retirado del catálogo del servidor.',
                 });
               }
+              await this.updateSetlistsMissingSong(local.id);
             } else {
               // Inconcluso por fallo de red: preservar la copia local válida
               console.warn(`⚠️ Verificación inconclusa para canción ausente '${local.id}'. Preservando copia local.`);
```

---

### 4.2. UI Inventory Component: `frontend/src/components/offline/OfflineInventoryModal.tsx`
File: [frontend/src/components/offline/OfflineInventoryModal.tsx](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/offline/OfflineInventoryModal.tsx)

```diff
diff --git a/frontend/src/components/offline/OfflineInventoryModal.tsx b/frontend/src/components/offline/OfflineInventoryModal.tsx
index e17f437..960d34e 100644
--- a/frontend/src/components/offline/OfflineInventoryModal.tsx
+++ b/frontend/src/components/offline/OfflineInventoryModal.tsx
@@ -275,7 +275,11 @@ export const OfflineInventoryModal: React.FC<OfflineInventoryModalProps> = ({
                         : '🎧'}
                     </span>
                     <strong className="item-title">{item.title}</strong>
-                    {offlineManager.isAuthorizationExpired(item) ? (
+                    {item.status === 'FAILED' ? (
+                      <span className="status-pill failed" style={{ background: '#7f1d1d', color: '#fca5a5' }} title={item.errorMessage ?? 'Revocado o no disponible'}>
+                        Revocado / Error
+                      </span>
+                    ) : offlineManager.isAuthorizationExpired(item) ? (
                       <span className="status-pill expired" style={{ background: '#7f1d1d', color: '#fca5a5' }}>
                         Expirado (7 días)
                       </span>
@@ -320,10 +324,12 @@ export const OfflineInventoryModal: React.FC<OfflineInventoryModalProps> = ({
                     <button
                       type="button"
                       className="btn-item-action play"
-                      disabled={offlineManager.isAuthorizationExpired(item) && !isOnline}
+                      disabled={item.status === 'FAILED' || (offlineManager.isAuthorizationExpired(item) && !isOnline)}
                       onClick={() => handlePlayAudio(item.id)}
                       title={
-                        offlineManager.isAuthorizationExpired(item) && !isOnline
+                        item.status === 'FAILED'
+                          ? `Pista revocada o no disponible: ${item.errorMessage ?? 'Error de autorización'}`
+                          : offlineManager.isAuthorizationExpired(item) && !isOnline
                           ? 'Autorización offline expirada. Conéctese a internet para renovar.'
                           : playingAudioId === item.id
                           ? 'Detener'
@@ -339,13 +345,15 @@ export const OfflineInventoryModal: React.FC<OfflineInventoryModalProps> = ({
                     <button
                       type="button"
                       className="btn-item-action open"
-                      disabled={offlineManager.isAuthorizationExpired(item) && !isOnline}
+                      disabled={item.status === 'FAILED' || (offlineManager.isAuthorizationExpired(item) && !isOnline)}
                       onClick={() => {
                         onSelectSong(item.id);
                         onClose();
                       }}
                       title={
-                        offlineManager.isAuthorizationExpired(item) && !isOnline
+                        item.status === 'FAILED'
+                          ? `Contenido revocado o no disponible: ${item.errorMessage ?? 'Error de autorización'}`
+                          : offlineManager.isAuthorizationExpired(item) && !isOnline
                           ? 'Autorización offline expirada (7 días). Conéctese a internet para revalidar.'
                           : 'Abrir en Atril Digital'
                       }
@@ -359,13 +367,15 @@ export const OfflineInventoryModal: React.FC<OfflineInventoryModalProps> = ({
                     <button
                       type="button"
                       className="btn-item-action open"
-                      disabled={offlineManager.isAuthorizationExpired(item) && !isOnline}
+                      disabled={item.status === 'FAILED' || (offlineManager.isAuthorizationExpired(item) && !isOnline)}
                       onClick={() => {
                         onSelectSetlist(item.id);
                         onClose();
                       }}
                       title={
-                        offlineManager.isAuthorizationExpired(item) && !isOnline
+                        item.status === 'FAILED'
+                          ? `Repertorio revocado o no disponible: ${item.errorMessage ?? 'Error de autorización'}`
+                          : offlineManager.isAuthorizationExpired(item) && !isOnline
                           ? 'Autorización offline expirada (7 días). Conéctese a internet para revalidar.'
                           : 'Cargar Repertorio en Atril'
                       }
```

---

### 4.3. Test Suite: `frontend/src/core/offline/__tests__/offline-manager.test.ts`
File: [frontend/src/core/offline/__tests__/offline-manager.test.ts](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/offline/__tests__/offline-manager.test.ts)

```diff
diff --git a/frontend/src/core/offline/__tests__/offline-manager.test.ts b/frontend/src/core/offline/__tests__/offline-manager.test.ts
index e2fded4..1198644 100644
--- a/frontend/src/core/offline/__tests__/offline-manager.test.ts
+++ b/frontend/src/core/offline/__tests__/offline-manager.test.ts
@@ -13,8 +13,15 @@ import { CanonicalMusicPayload } from '../../canonical-model/canonical-music-pay
 import { Timeline } from '../../canonical-model/timeline.ts';
 import { TempoMap } from '../../canonical-model/tempo-map.ts';
 import { CANONICAL_TPQN } from '../../canonical-model/types.ts';
-import { OFFLINE_POLICIES, OfflineStorageError } from '../types.ts';
+import {
+  OFFLINE_POLICIES,
+  OfflineStorageError,
+  type OfflineResourceMetadata,
+  type OfflineSongPayload,
+  type OfflineSetlistPayload,
+} from '../types.ts';
 import type { BackendSongResponse } from '../../api/api-client.ts';
+import type { FrontendSetlistDetail } from '../../api/setlist-types.ts';
 
 describe('WP-04 — BethesdaOfflineManager Orchestration Suite', () => {
   let storage: BethesdaOfflineStorage;
@@ -637,4 +644,341 @@ describe('WP-04 — BethesdaOfflineManager Orchestration Suite', () => {
     assert.strictEqual(meta?.status, 'AVAILABLE_OFFLINE', 'Status must remain AVAILABLE_OFFLINE');
     assert.strictEqual(meta?.lastValidatedAt, originalDate, 'Authorization timestamp must NOT be modified');
   });
+
+  it('14. should purge cached payload and block getAuthorizedSongPayload when server revokes via 401/403 in checkForUpdates (even with fresh 7-day timestamp)', async () => {
+    const revokedSongId = 'song_revoked_401';
+    const freshTimestamp = new Date(Date.now() - 3600 * 1000).toISOString(); // 1 hour old, well within 7 days
+
+    const meta: OfflineResourceMetadata = {
+      id: revokedSongId,
+      resourceType: 'SONG',
+      title: 'Revoked Song 401',
+      versionNumber: 1,
+      ownerUserId: 'user_alice',
+      status: 'AVAILABLE_OFFLINE',
+      downloadedAt: freshTimestamp,
+      lastValidatedAt: freshTimestamp,
+      byteSize: 1024,
+      checksumSha256: 'hash_rev_401',
+    };
+
+    const payload: OfflineSongPayload = {
+      id: revokedSongId,
+      canonicalPayload: defaultCanonicalJson,
+      metadata: meta,
+      defaultKey: 'C',
+      defaultBpm: 120,
+      timeSignature: '4/4',
+    };
+
+    await storage.saveSongPayload(payload);
+
+    // Also create a dependent setlist
+    const setlistId = 'setlist_dep_1';
+    const mockDetail: FrontendSetlistDetail = {
+      id: setlistId,
+      title: 'Sunday Service',
+      scheduledDateTime: '2026-10-20T10:00:00Z',
+      directorUserId: 'user_alice',
+      status: 'ACTIVE',
+      notes: null,
+      createdAt: freshTimestamp,
+      updatedAt: freshTimestamp,
+      items: [
+        {
+          id: 'item_1',
+          setlistId,
+          sequenceOrder: 0,
+          itemType: 'SONG',
+          songId: revokedSongId,
+          targetKey: 'C',
+          musicalKey: 'C',
+          targetBpm: 120,
+          transitionType: null,
+          momentTitle: null,
+          durationMinutes: null,
+          notesForTeam: null,
+          createdAt: freshTimestamp,
+          updatedAt: freshTimestamp,
+          song: null,
+        },
+      ],
+    };
+
+    await storage.saveSetlistPayload({
+      id: setlistId,
+      setlistDetail: mockDetail,
+      metadata: {
+        id: setlistId,
+        resourceType: 'SETLIST',
+        title: 'Sunday Service',
+        versionNumber: 1,
+        ownerUserId: 'user_alice',
+        status: 'AVAILABLE_OFFLINE',
+        downloadedAt: freshTimestamp,
+        lastValidatedAt: freshTimestamp,
+        byteSize: 500,
+        checksumSha256: 'hash_sl_1',
+        associatedSongIds: [revokedSongId],
+        missingSongIds: [],
+      },
+    });
+
+    const mockRevokeApiClient: any = {
+      listSongs: async () => ({
+        items: [{ id: revokedSongId, title: 'Revoked Song 401' }],
+        total: 1,
+      }),
+      getSong: async () => {
+        const err: any = new Error('HTTP 403 Forbidden');
+        err.statusCode = 403;
+        throw err;
+      },
+    };
+
+    manager = new BethesdaOfflineManager(storage, mockRevokeApiClient);
+    manager.isOnline = () => true;
+
+    // Verify before checkForUpdates: song payload exists in storage
+    const beforePayload = await storage.getSongPayload(revokedSongId);
+    assert.ok(beforePayload !== null, 'Song payload must exist before check');
+
+    // Run checkForUpdates()
+    const result = await manager.checkForUpdates();
+    assert.strictEqual(result.revokedCount, 1, 'Should report 1 revoked resource');
+
+    // Invariant: local payload in song_payloads MUST be purged
+    const afterPayload = await storage.getSongPayload(revokedSongId);
+    assert.strictEqual(afterPayload, null, 'Cached payload must be deleted from song_payloads store');
+
+    // Invariant: metadata is marked FAILED
+    const afterMeta = await storage.getMetadata(revokedSongId);
+    assert.strictEqual(afterMeta?.status, 'FAILED');
+    assert.ok(afterMeta?.errorMessage?.includes('Autorización revocada'));
+
+    // Invariant: read-path getAuthorizedSongPayload rejects with UNAUTHORIZED_SESSION even though timestamp is fresh
+    await assert.rejects(
+      async () => {
+        await manager.getAuthorizedSongPayload(revokedSongId);
+      },
+      (err: any) => err instanceof OfflineStorageError && err.code === 'UNAUTHORIZED_SESSION'
+    );
+
+    // Invariant: dependent setlist reflects missingSongIds
+    const updatedSetlist = await storage.getSetlistPayload(setlistId);
+    assert.ok(updatedSetlist?.metadata.missingSongIds?.includes(revokedSongId), 'Dependent setlist must flag revoked song as missing');
+  });
+
+  it('15. should purge cached payload and block getAuthorizedSongPayload when server confirms 404 removal of song absent from catalog', async () => {
+    const absentSongId = 'song_removed_404';
+    const freshTimestamp = new Date(Date.now() - 7200 * 1000).toISOString(); // 2 hours old
+
+    const meta: OfflineResourceMetadata = {
+      id: absentSongId,
+      resourceType: 'SONG',
+      title: 'Removed Song 404',
+      versionNumber: 1,
+      ownerUserId: 'user_alice',
+      status: 'AVAILABLE_OFFLINE',
+      downloadedAt: freshTimestamp,
+      lastValidatedAt: freshTimestamp,
+      byteSize: 1024,
+      checksumSha256: 'hash_rem_404',
+    };
+
+    await storage.saveSongPayload({
+      id: absentSongId,
+      canonicalPayload: defaultCanonicalJson,
+      metadata: meta,
+      defaultKey: 'C',
+      defaultBpm: 120,
+      timeSignature: '4/4',
+    });
+
+    const mock404ApiClient: any = {
+      listSongs: async () => ({
+        items: [], // absent from complete catalog
+        total: 0,
+      }),
+      getSong: async (id: string) => {
+        const err: any = new Error(`HTTP 404 Not Found: ${id}`);
+        err.statusCode = 404;
+        throw err;
+      },
+    };
+
+    manager = new BethesdaOfflineManager(storage, mock404ApiClient);
+    manager.isOnline = () => true;
+
+    const result = await manager.checkForUpdates();
+    assert.strictEqual(result.revokedCount, 1);
+
+    // Payload deleted
+    assert.strictEqual(await storage.getSongPayload(absentSongId), null);
+
+    // Read path rejects even with fresh timestamp
+    await assert.rejects(
+      async () => {
+        await manager.getAuthorizedSongPayload(absentSongId);
+      },
+      (err: any) => err instanceof OfflineStorageError && err.code === 'UNAUTHORIZED_SESSION'
+    );
+  });
+
+  it('16. should block getAuthorizedSongPayload if payload or metadata status is FAILED even if 7-day timestamp is fresh and client is offline', async () => {
+    manager = new BethesdaOfflineManager(storage);
+    manager.isOnline = () => false; // offline!
+
+    const failedSongId = 'song_explicit_failed';
+    const freshTimestamp = new Date(Date.now() - 3600 * 1000).toISOString(); // 1 hour old
+
+    const meta: OfflineResourceMetadata = {
+      id: failedSongId,
+      resourceType: 'SONG',
+      title: 'Failed Song Fresh Time',
+      versionNumber: 1,
+      ownerUserId: 'user_alice',
+      status: 'FAILED',
+      errorMessage: 'Revocación explícita por política de seguridad',
+      downloadedAt: freshTimestamp,
+      lastValidatedAt: freshTimestamp,
+      byteSize: 1024,
+      checksumSha256: 'hash_failed_fresh',
+    };
+
+    await storage.saveSongPayload({
+      id: failedSongId,
+      canonicalPayload: defaultCanonicalJson,
+      metadata: meta,
+      defaultKey: 'C',
+      defaultBpm: 120,
+      timeSignature: '4/4',
+    });
+
+    // Invariant: getAuthorizedSongPayload must NOT return the payload merely because timestamp is within 7 days!
+    await assert.rejects(
+      async () => {
+        await manager.getAuthorizedSongPayload(failedSongId);
+      },
+      (err: any) => err instanceof OfflineStorageError && err.code === 'UNAUTHORIZED_SESSION'
+    );
+  });
+
+  it('17. cross-user isolation: revoking Alice song does not affect Bob song or unowned (ownerUserId === null) resources', async () => {
+    const aliceSongId = 'song_alice_revoked';
+    const bobSongId = 'song_bob_valid';
+    const unownedSongId = 'song_unowned_valid';
+    const freshTimestamp = new Date().toISOString();
+
+    await storage.saveSongPayload({
+      id: aliceSongId,
+      canonicalPayload: defaultCanonicalJson,
+      defaultKey: 'C',
+      defaultBpm: 120,
+      timeSignature: '4/4',
+      metadata: {
+        id: aliceSongId,
+        resourceType: 'SONG',
+        title: 'Alice Song',
+        versionNumber: 1,
+        ownerUserId: 'user_alice',
+        status: 'AVAILABLE_OFFLINE',
+        downloadedAt: freshTimestamp,
+        lastValidatedAt: freshTimestamp,
+        byteSize: 1024,
+        checksumSha256: 'hash_alice',
+      },
+    });
+
+    await storage.saveSongPayload({
+      id: bobSongId,
+      canonicalPayload: defaultCanonicalJson,
+      defaultKey: 'D',
+      defaultBpm: 110,
+      timeSignature: '4/4',
+      metadata: {
+        id: bobSongId,
+        resourceType: 'SONG',
+        title: 'Bob Song',
+        versionNumber: 1,
+        ownerUserId: 'user_bob',
+        status: 'AVAILABLE_OFFLINE',
+        downloadedAt: freshTimestamp,
+        lastValidatedAt: freshTimestamp,
+        byteSize: 1024,
+        checksumSha256: 'hash_bob',
+      },
+    });
+
+    await storage.saveSongPayload({
+      id: unownedSongId,
+      canonicalPayload: defaultCanonicalJson,
+      defaultKey: 'E',
+      defaultBpm: 100,
+      timeSignature: '4/4',
+      metadata: {
+        id: unownedSongId,
+        resourceType: 'SONG',
+        title: 'Unowned Song',
+        versionNumber: 1,
+        ownerUserId: null,
+        status: 'AVAILABLE_OFFLINE',
+        downloadedAt: freshTimestamp,
+        lastValidatedAt: freshTimestamp,
+        byteSize: 1024,
+        checksumSha256: 'hash_unowned',
+      },
+    });
+
+    const mockIsolationApiClient: any = {
+      listSongs: async () => ({
+        items: [
+          { id: aliceSongId, title: 'Alice Song' },
+          { id: bobSongId, title: 'Bob Song' },
+          { id: unownedSongId, title: 'Unowned Song' },
+        ],
+        total: 3,
+      }),
+      getSong: async (id: string) => {
+        if (id === aliceSongId) {
+          const err: any = new Error('HTTP 403 Forbidden for Alice');
+          err.statusCode = 403;
+          throw err;
+        }
+        return {
+          song: { id, title: `Title ${id}` },
+          version: { versionNumber: 1, canonicalPayload: defaultCanonicalJson },
+        };
+      },
+    };
+
+    manager = new BethesdaOfflineManager(storage, mockIsolationApiClient);
+    manager.isOnline = () => true;
+
+    const result = await manager.checkForUpdates();
+    assert.strictEqual(result.revokedCount, 1, 'Only Alice song should be revoked');
+
+    // Alice song is purged & FAILED
+    assert.strictEqual(await storage.getSongPayload(aliceSongId), null);
+    const aliceMeta = await storage.getMetadata(aliceSongId);
+    assert.strictEqual(aliceMeta?.status, 'FAILED');
+
+    // Bob song is completely intact and accessible
+    const bobPayload = await storage.getSongPayload(bobSongId);
+    assert.ok(bobPayload !== null, 'Bob song payload must NOT be deleted');
+    const bobAuthorized = await manager.getAuthorizedSongPayload(bobSongId);
+    assert.strictEqual(bobAuthorized?.id, bobSongId);
+    const bobMeta = await storage.getMetadata(bobSongId);
+    assert.strictEqual(bobMeta?.status, 'AVAILABLE_OFFLINE');
+    assert.strictEqual(bobMeta?.ownerUserId, 'user_bob');
+
+    // Unowned song is completely intact and accessible
+    const unownedPayload = await storage.getSongPayload(unownedSongId);
+    assert.ok(unownedPayload !== null, 'Unowned song payload must NOT be deleted');
+    const unownedAuthorized = await manager.getAuthorizedSongPayload(unownedSongId);
+    assert.strictEqual(unownedAuthorized?.id, unownedSongId);
+    const unownedMeta = await storage.getMetadata(unownedSongId);
+    assert.strictEqual(unownedMeta?.status, 'AVAILABLE_OFFLINE');
+    assert.strictEqual(unownedMeta?.ownerUserId, null);
+  });
 });
```

---

### 4.4. Additional Remediation Files Identified Separately

1. **[docs/wp04/WP04_REVOCATION_READ_PATH_AUDIT_REPORT.md](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/docs/wp04/WP04_REVOCATION_READ_PATH_AUDIT_REPORT.md)**  
   *Classification:* Committed in `4e9ca1b` (240 lines added).  
   *Purpose:* Primary audit report detailing executive conclusion, exact paths, reproduction evidence, and verification protocol.
2. **`docs/wp04/WP04_INDEPENDENT_CODE_DIFF_REVIEW_PACKAGE.md`** (This Document)  
   *Classification:* Untracked working tree deliverable.  
   *Purpose:* Review-ready code diff evidence package, architectural tracing, invariant mapping, and adversarial analysis.

---

## 5. Architectural Analysis: HTTP 401, 403, and 404 Response Semantics

In `BethesdaOfflineManager.checkForUpdates()`, responses are partitioned into two strictly separated classes: **Affirmative Authorization/Removal Signals** and **Inconclusive/Transient Errors**.

### A. Explicit Revocation (HTTP 401 Unauthorized / HTTP 403 Forbidden)
- **Trigger Scenario:** The song was found in the server's catalog list, but a targeted version check `getSong(local.id)` returned a 401 or 403 (e.g., user's permission group revoked, song transitioned to restricted/private status, or license revoked).
- **Metadata State Transition:**
  `local.status` transitions from `AVAILABLE_OFFLINE` to `FAILED`.
  `local.errorMessage` is set to `'Autorización revocada por el servidor.'`
  `local.lastValidatedAt` is NOT extended.
- **Storage State (Payload):**
  `await this.storage.deleteSongPayload(local.id)` is immediately invoked, deleting the serialized canonical JSON from IndexedDB `STORES.SONG_PAYLOADS`.
- **Setlist Dependencies:**
  `await this.updateSetlistsMissingSong(local.id)` queries all setlist metadata records. For each setlist whose `associatedSongIds` includes `local.id`, `local.id` is inserted into `missingSongIds` (via a duplicate-preventing `Set`) and persisted.

### B. Explicit Removal (HTTP 404 Not Found)
- **Trigger Scenario:** The song is absent from the exhaustive catalog pagination (all pages fetched without truncation). A targeted probe `getSong(local.id)` confirms HTTP 404 (song deleted from server database).
- **Metadata State Transition:**
  `local.status` transitions to `FAILED`.
  `local.errorMessage` is set to `'Autorización revocada o recurso retirado del catálogo del servidor.'`
- **Storage State (Payload):**
  `await this.storage.deleteSongPayload(local.id)` purges the payload from `STORES.SONG_PAYLOADS`.
- **Setlist Dependencies:**
  `local.id` is added to `missingSongIds` of all dependent setlists.

### C. Transient Network Failures & Server 5xx Errors
- **Trigger Scenario:** Network drops, timeout occurs, or server returns 500/502/503.
- **Handling Invariant:**
  Caught by the `else` branch of the error handler.
  **No deletion occurs:** Neither `deleteSongPayload()` nor `deleteResource()` is called.
  **No status alteration:** The song remains in `AVAILABLE_OFFLINE`.
  **No timestamp extension:** `lastValidatedAt` is NOT modified, preserving the approved 7-day expiration boundary.

---

## 6. Read-Path Traces: Can a FAILED Resource Be Returned or Rendered?

The audit traced the four real read paths through which cached content can be consumed:

### Path 1: Digital Atril Repertoire Execution ([MusicalWorkspace.tsx](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/MusicalWorkspace.tsx#L173-L205))
1. When switching songs in a setlist, `MusicalWorkspace.tsx` calls `offlineManager.getAuthorizedSongPayload(songId)`.
2. Inside `getAuthorizedSongPayload(songId)`:
   - Guard 1 checks `this.storage.getMetadata(songId)`. If `meta && meta.status === 'FAILED'`, it throws `OfflineStorageError('UNAUTHORIZED_SESSION')`.
   - Guard 2 fetches `payload = await this.storage.getSongPayload(songId)`. Because `checkForUpdates()` deleted the payload, `payload` is `null`.
   - If a payload somehow existed with `payload.metadata.status === 'FAILED'`, Guard 3 throws `OfflineStorageError('UNAUTHORIZED_SESSION')`.
3. In `MusicalWorkspace.tsx`:
   - If `getAuthorizedSongPayload()` throws, execution jumps directly to the `.catch((err) => console.error(...))` handler. The song is never set in `songCacheRef` and `selectPersistedSong()` is never called.
   - If `getAuthorizedSongPayload()` returns `null`, the component falls back to `client.getSong(songId)`. If offline, network fetch throws; if online, server returns 401/403/404.
4. **Result:** Revoked content CANNOT be rendered in the digital atril.

### Path 2: Song Selection Modal ([DatabaseSongsModal.tsx](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/workspace/DatabaseSongsModal.tsx#L80-L95))
1. When the musician clicks a song in the modal, `handleSelectSong(songId)` calls `offlineManager.getAuthorizedSongPayload(songId)`.
2. If the song is `FAILED`, `getAuthorizedSongPayload()` throws `UNAUTHORIZED_SESSION`.
3. The catch block catches the error and assigns `setError(err.message)`.
4. `onSelectSong()` is never called, the modal is not closed, and the workspace remains unchanged.
5. **Result:** Revoked content CANNOT be selected or loaded.

### Path 3: Offline Inventory Modal ([OfflineInventoryModal.tsx](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/components/offline/OfflineInventoryModal.tsx#L320-L375))
1. In the offline inventory list, the `📖 Abrir` button has:
   ```tsx
   disabled={item.status === 'FAILED' || (offlineManager.isAuthorizationExpired(item) && !isOnline)}
   ```
2. For any item with `item.status === 'FAILED'`, the button is disabled in the DOM, preventing click interactions.
3. If clicked programmatically, it invokes `onSelectSong(item.id)`, which triggers Path 1 and is rejected by `getAuthorizedSongPayload()`.
4. **Result:** UI controls are disabled, and programmatic bypass is blocked.

### Path 4: Offline Audio Playback ([offline-manager.ts:L506](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/offline/offline-manager.ts#L506))
1. `getAudioObjectUrl(audioId)` inspects `storage.getMetadata(audioId)` and `record.metadata.status`.
2. If status is `FAILED`, it throws `OfflineStorageError('UNAUTHORIZED_SESSION')`.
3. In `OfflineInventoryModal.tsx:L324`, the `▶️ Reproducir` button is disabled when `item.status === 'FAILED'`.
4. **Result:** Audio playback is blocked (in addition to audio download being blocked under Outcome C).

---

## 7. Consistency: Canonical Metadata Store vs. Payload Metadata Store

In `BethesdaOfflineStorage`, metadata is stored in `STORES.METADATA`, while full song payloads are stored in `STORES.SONG_PAYLOADS`. Each `OfflineSongPayload` contains an embedded `metadata: OfflineResourceMetadata` property.

The review verified whether `getAuthorizedSongPayload()` and `checkForUpdates()` treat these two stores consistently:

1. **Storage Read-Through Hydration:**
   In [indexeddb-storage.ts:L270-L285](file:///c:/Users/juanc/OneDrive/Documentos/Desarrollo%20proyectos/Sistema%20musical%20-%20partituras/BETHESDA%20WORSHIP%20STUDIO/frontend/src/core/offline/storage/indexeddb-storage.ts#L270-L285), `storage.getSongPayload(id)` automatically hydrates the embedded metadata from the primary metadata store:
   ```ts
   const latestMeta = await this.getMetadata(id);
   if (latestMeta) {
     return { ...payload, metadata: latestMeta };
   }
   ```
2. **Dual-Check Guard in `getAuthorizedSongPayload()`:**
   - First checks `this.storage.getMetadata(songId)` directly. If `meta.status === 'FAILED'`, it throws **before** even loading the song payload.
   - If the payload is retrieved, it checks `payload.metadata.status === 'FAILED'`.
   - If `payload` was purged by `deleteSongPayload()`, `getSongPayload()` returns `null`.
3. **Dual-Store Purging in `checkForUpdates()`:**
   - `checkForUpdates()` calls `await this.storage.deleteSongPayload(local.id)` (clearing `STORES.SONG_PAYLOADS`).
   - `checkForUpdates()` calls `await this.storage.saveMetadata({ ...local, status: 'FAILED' })` (updating `STORES.METADATA`).
4. **Conclusion:** Metadata and payload stores are kept strictly consistent. Revocation purges the binary payload while leaving the metadata tombstone marked `FAILED`.

---

## 8. Setlist Dependency Helper (`updateSetlistsMissingSong`) Review

The helper `updateSetlistsMissingSong(songId)` was extracted to centralize setlist dependency updates upon song revocation or deletion.

### Code Structure
```ts
private async updateSetlistsMissingSong(songId: string): Promise<void> {
  const setlists = (await this.storage.listMetadata()).filter((m) => m.resourceType === 'SETLIST');
  for (const sl of setlists) {
    if (sl.associatedSongIds && sl.associatedSongIds.includes(songId)) {
      const payload = await this.storage.getSetlistPayload(sl.id);
      if (payload) {
        const currentMissing = new Set(sl.missingSongIds ?? []);
        currentMissing.add(songId);
        const updatedMeta: OfflineResourceMetadata = {
          ...sl,
          missingSongIds: Array.from(currentMissing),
        };
        await this.storage.saveSetlistPayload({
          ...payload,
          metadata: updatedMeta,
        });
      }
    }
  }
}
```

### Invariant Verification
1. **Preservation of Setlist Content:** The helper retrieves `payload = await this.storage.getSetlistPayload(sl.id)` and saves back `{ ...payload, metadata: updatedMeta }`. The internal `setlistDetail` object (service moments, song items, musical keys, target BPMs, order sequences, and pastoral notes) is **100% untouched**.
2. **Preservation of Metadata Fields:** The helper spreads `...sl` (preserving title, scheduled date, version number, downloaded timestamp, last validated timestamp, user ownership, byte size, and checksum). Only `missingSongIds` is updated.
3. **Idempotence & Duplicate Prevention:** It uses `new Set(sl.missingSongIds ?? [])`. Adding the same `songId` multiple times produces a unique set of IDs.
4. **Precise Scoping:** The condition `sl.associatedSongIds.includes(songId)` guarantees that only setlists declaring this specific song as an item are modified. Unrelated setlists are bypassed completely.

---

## 9. Cross-User Session Isolation & Unowned Resources Analysis

The review evaluated whether revoking Alice's song could inadvertently purge or corrupt Bob's resources or unowned public domain hymns (`ownerUserId === null`):

1. **Primary Key Scoping:**
   IndexedDB stores (`STORES.SONG_PAYLOADS` and `STORES.METADATA`) use the unique song UUID as their primary key (`keyPath: 'id'`). `deleteSongPayload(id)` executes `store.delete(id)`. IndexedDB delete operations are strictly exact-match; deleting `'song_alice_1'` cannot delete `'song_bob_1'` or `'song_unowned_1'`.
2. **Multi-User Independence:**
   Even if Alice and Bob have cached different songs with identical titles, each song possesses a unique server-assigned UUID.
3. **Empirical Verification via Test 17:**
   Automated regression test 17 concurrently stored:
   - Alice's song (`ownerUserId: 'user_alice'`)
   - Bob's song (`ownerUserId: 'user_bob'`)
   - Unowned song (`ownerUserId: null`)
   When Alice's song was revoked (HTTP 403) during `checkForUpdates()`:
   - Alice's payload was purged from `song_payloads` and her metadata marked `FAILED`.
   - Bob's payload remained present in storage, Bob's metadata remained `AVAILABLE_OFFLINE`, and Bob's `getAuthorizedSongPayload()` succeeded.
   - Unowned song's payload remained present, unowned metadata remained `AVAILABLE_OFFLINE`, and unowned `getAuthorizedSongPayload()` succeeded.

---

## 10. Regression Test Mapping & Security Invariant Coverage Matrix

| Test in `offline-manager.test.ts` | Exact Behavior & Security Invariant Verified | Coverage Quality |
| :--- | :--- | :--- |
| **Test 14** | **Catalog Revocation (401/403):** Proves that an explicit 403 response for a catalog item purges the payload from `song_payloads`, marks status `FAILED`, causes `getAuthorizedSongPayload()` to reject with `UNAUTHORIZED_SESSION` on a fresh (1-hour-old) timestamp, and updates dependent setlists with `missingSongIds`. | **Direct & Complete** |
| **Test 15** | **Absent Song Targeted Probe (404):** Proves that when an absent song receives an explicit 404 response, the payload is purged, status transitions to `FAILED`, and `getAuthorizedSongPayload()` rejects with `UNAUTHORIZED_SESSION`. | **Direct & Complete** |
| **Test 16** | **Immediate FAILED Guard (Fresh Timestamp & Offline):** Proves that if a song record has status `FAILED` and fresh timestamp, `getAuthorizedSongPayload()` rejects with `UNAUTHORIZED_SESSION` even when the client is completely offline. | **Direct & Complete** |
| **Test 17** | **Cross-User & Unowned Isolation:** Proves that revoking Alice's song leaves Bob's resources and unowned resources (`ownerUserId: null`) completely intact and authorized. | **Direct & Complete** |
| **Test 13** *(Existing)* | **Transient Network Safety:** Proves that network errors during catalog query do NOT revoke resources, do NOT delete payloads, and do NOT extend `lastValidatedAt`. | **Direct & Complete** |

### Identification of Claims Not Directly Covered by Automated Unit Tests
1. **UI DOM Button Disabling in `OfflineInventoryModal.tsx`:**
   The `disabled` attribute condition `item.status === 'FAILED'` is verified via TypeScript typechecking and static code inspection. Because browser/DOM testing is prohibited under task constraints, there is no shallow render test asserting button DOM properties.
2. **Audio URL Revocation in `getAudioObjectUrl()`:**
   The `status === 'FAILED'` guard in `getAudioObjectUrl()` was implemented and verified by static analysis. Outcome C maintains audio download/playback blocked, making runtime audio revocation non-critical for current WP-04 delivery.

---

## 11. Adversarial Analysis: Regressions, Race Conditions & Edge Cases

The review conducted an adversarial analysis to identify potential failure modes beyond passing tests:

### A. Concurrent Check vs. Read Race Condition
- **Hypothesis:** What if `checkForUpdates()` purges `song_payloads` while a user concurrently calls `getAuthorizedSongPayload(songId)`?
- **Analysis:**
  - Case 1: `deleteSongPayload()` finishes before `getAuthorizedSongPayload()` runs. `getSongPayload()` returns `null`. `getAuthorizedSongPayload()` returns `null`. The workspace tries `client.getSong()`, which fails offline or receives 401/403 online. Revoked content is not served.
  - Case 2: `saveMetadata(..., status: 'FAILED')` finishes first. `getAuthorizedSongPayload()` checks metadata, detects `FAILED`, and throws `UNAUTHORIZED_SESSION`.
  - **Verdict:** Safe under both execution interleavings.

### B. Partial Setlist Update Failure
- **Hypothesis:** What if `saveSetlistPayload()` throws an IndexedDB error during `updateSetlistsMissingSong()`?
- **Analysis:**
  If an IndexedDB write error occurs while updating setlist metadata, the remaining setlists in the loop might not have their `missingSongIds` array updated. However, the song's payload was **already purged** from `song_payloads`. Any attempt to execute the missing song from that setlist will invoke `getAuthorizedSongPayload()`, which safely rejects.
  - **Verdict:** Degrades gracefully to safe rejection.

### C. Offline Client Never Revalidating
- **Hypothesis:** What if a user's permission is revoked on the server, but the user keeps their device permanently offline?
- **Analysis:**
  The server cannot push revocations to an offline client. However, WP-04 enforces an unextendable 7-day grace period from `lastValidatedAt`. After 7 days, `getAuthorizedSongPayload()` blocks offline access with `UNAUTHORIZED_SESSION` until the device connects to the internet to revalidate.
  - **Verdict:** Strictly bounded by the approved 7-day offline policy.

### D. Metadata Tombstone Storage Retention
- **Hypothesis:** Does retaining `FAILED` metadata records in IndexedDB cause unbounded storage growth?
- **Analysis:**
  A metadata record occupies approximately 500 bytes. The large canonical music payload (up to several hundred kilobytes) is purged. While retaining the tombstone allows the user to see the revocation reason in the inventory, if thousands of songs were revoked over time, tombstones accumulate until the user clicks `Eliminar` or logs out (triggering `purgeUserData`).
  - **Verdict:** Acceptable design trade-off for user auditability.

---

## 12. Review Conclusion & Acceptance Status

### Confirmed Findings
1. **The defect was real and exploitable prior to remediation:** Cached payloads were not purged upon 401/403/404 revocation, and `getAuthorizedSongPayload()` served revoked payloads if their 7-day timestamp was fresh.
2. **The remediation is minimal, precise, and correct:**
   - Both catalog (401/403) and targeted (404/401/403) revocations purge cached payloads from `song_payloads`.
   - Dual status guards in `getAuthorizedSongPayload()` block access regardless of timestamp freshness.
   - Setlist dependencies are updated without altering setlist contents.
   - Bob's resources and unowned resources are completely unaffected.
   - UI buttons in `OfflineInventoryModal.tsx` are disabled for `FAILED` items.
3. **No regressions were introduced:** All 35 offline tests and all 316 frontend test suites pass with zero failures. TypeScript check and production build compile cleanly.

### Unresolved Concerns
- No blocking or security-critical unresolved concerns remain within WP-04 scope.
- Non-blocking consideration: Headless unit tests verify core manager guards; DOM interaction tests for modal buttons remain unexecuted due to browser testing restrictions.

### Sufficiency of Available Evidence
The unified diffs, architectural traces, adversarial analysis, and test results provide complete, review-ready evidence. The evidence demonstrates that revoked content cannot be accessed or rendered through any offline read path.

### Mandatory Acceptance Statement
**WP-04 is NOT formally accepted by this review package.** Formal acceptance of WP-04 remains pending and can only be granted by the project owner. Audio functionality remains strictly blocked (Outcome C).
