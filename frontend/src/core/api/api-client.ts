/**
 * @file api-client.ts
 * @description Cliente HTTP tipado para comunicar el frontend con el backend Fastify (Fases 2A y 2B).
 *
 * Incluye interceptor de autenticación con Bearer token en memoria,
 * soporte de cookies HttpOnly (credentials: 'include'), y renovación silenciosa automática.
 */

import { CanonicalMusicPayload, type CanonicalMusicPayloadJSON } from '../canonical-model/index.ts';
import { tokenManager } from '../auth/token-manager.ts';
import type { AuthResponseData, UserRole, AccountStatus } from '../auth/types.ts';
import { ApiError } from './api-error.ts';
import type {
  CreateSetlistItemPayload,
  CreateSetlistPayload,
  FrontendListSetlistsResult,
  FrontendSetlistDetail,
  FrontendSetlistEntity,
  FrontendSetlistItem,
  FrontendSetlistStatus,
  HttpListSetlistsResponse,
  UpdateSetlistItemPayload,
  UpdateSetlistPayload,
} from './setlist-types.ts';
import type {
  GetUserPreferencesResponse,
  UpdateUserPreferencesResponse,
  UpdateUserViewPreferencePayload,
  UserViewPreferenceData,
} from './preference-types.ts';

export * from './setlist-types.ts';
export * from './preference-types.ts';
export { ApiError } from './api-error.ts';

export interface BackendSongItem {
  id: string;
  title: string;
  artist: string | null;
  ccliNumber: string | null;
  defaultKey: string;
  defaultBpm: number;
  timeSignature: string;
  status: 'DRAFT' | 'APPROVED' | 'ARCHIVED';
  currentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BackendVersionItem {
  id: string;
  songId: string;
  versionNumber: number;
  name: string;
  description: string | null;
  sourceFormat: 'MUSIC_XML' | 'CHORD_PRO' | 'INTERNAL';
  canonicalPayload: CanonicalMusicPayloadJSON;
  totalMeasures: number;
  totalNotes: number;
  totalChords: number;
  isCurrent: boolean;
  createdAt: string;
}

export interface BackendSongResponse {
  song: BackendSongItem;
  version: BackendVersionItem;
}

export interface ApiClientConfig {
  baseUrl?: string;
}

export class BethesdaApiClient {
  private static instance: BethesdaApiClient | null = null;
  public readonly baseUrl: string;
  private refreshPromise: Promise<AuthResponseData> | null = null;

  public constructor(config?: ApiClientConfig) {
    this.baseUrl = config?.baseUrl ?? (import.meta as any).env?.VITE_API_URL ?? '/api/v1';
  }

  public static getInstance(config?: ApiClientConfig): BethesdaApiClient {
    if (!BethesdaApiClient.instance) {
      BethesdaApiClient.instance = new BethesdaApiClient(config);
    }
    return BethesdaApiClient.instance;
  }

  /**
   * Petición HTTP con inyección automática de Bearer token y soporte de renovación silenciosa ante 401.
   */
  public async fetchWithAuth(input: string, init?: RequestInit): Promise<Response> {
    const url = input.startsWith('http') ? input : `${this.baseUrl}${input.startsWith('/') ? '' : '/'}${input}`;
    const headers = new Headers(init?.headers);

    const token = tokenManager.getToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const requestInit: RequestInit = {
      ...init,
      headers,
      credentials: 'include', // Enviar y recibir cookies HttpOnly siempre
    };

    let response = await fetch(url, requestInit);

    // Si el servidor responde 401 y no es ya una petición de auth, intentar refrescar una vez
    if (response.status === 401 && !input.includes('/auth/')) {
      try {
        const refreshData = await this.refreshSession();
        tokenManager.setToken(refreshData.accessToken, refreshData.expiresIn);

        // Reintentar la solicitud original con el nuevo token
        headers.set('Authorization', `Bearer ${refreshData.accessToken}`);
        response = await fetch(url, { ...requestInit, headers });
      } catch {
        tokenManager.clearToken();
      }
    }

    return response;
  }

  /**
   * Diagnóstico de salud y conectividad con la base de datos PostgreSQL.
   */
  public async checkHealth(): Promise<{ status: string; database: string }> {
    const res = await this.fetchWithAuth('/health');
    if (!res.ok) {
      throw new Error(`Fallo de verificación de salud: HTTP ${res.status}`);
    }
    return await res.json();
  }

  /**
   * Inicio de sesión de usuario (Fase 2B).
   */
  public async login(email: string, password: string): Promise<AuthResponseData> {
    const res = await fetch(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? `Error en autenticación: HTTP ${res.status}`);
    }

    const json = await res.json();
    return json.data;
  }

  /**
   * Renovación de token de sesión mediante Cookie HttpOnly (Fase 2B).
   * Deduplica llamadas concurrentes para mitigar carreras en recargas simultáneas de página.
   */
  public async refreshSession(): Promise<AuthResponseData> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        const res = await fetch(`${this.baseUrl}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error?.message ?? `Sesión expirada o no iniciada: HTTP ${res.status}`);
        }

        const json = await res.json();
        return json.data;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  /**
   * Cierre de sesión (Fase 2B).
   */
  public async logout(): Promise<void> {
    await fetch(`${this.baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
  }

  /**
   * Cambio de contraseña inicial para cuentas en estado MUST_CHANGE_PASSWORD (Fase 2B).
   */
  public async changeInitialPassword(currentPassword: string, newPassword: string): Promise<void> {
    const res = await this.fetchWithAuth('/auth/change-initial-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? `Error al cambiar contraseña: HTTP ${res.status}`);
    }
  }

  /**
   * Consulta el catálogo de canciones persistidas en la base de datos.
   */
  public async listSongs(params?: { search?: string; limit?: number; offset?: number }): Promise<{
    items: BackendSongItem[];
    total: number;
  }> {
    const query = new URLSearchParams();
    if (params?.search) query.set('search', params.search);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));

    const path = `/songs${query.toString() ? `?${query.toString()}` : ''}`;
    const res = await this.fetchWithAuth(path);
    if (!res.ok) {
      throw new Error(`Error al listar canciones persistidas: HTTP ${res.status}`);
    }
    const json = await res.json();
    return {
      items: json.data,
      total: json.pagination?.total ?? json.data.length,
    };
  }

  /**
   * Obtiene una canción y su versión canónica actual desde la base de datos.
   */
  public async getSong(songId: string): Promise<BackendSongResponse> {
    const res = await this.fetchWithAuth(`/songs/${songId}`);
    if (!res.ok) {
      throw new Error(`Error al obtener canción '${songId}': HTTP ${res.status}`);
    }
    const json = await res.json();
    return json.data;
  }

  /**
   * Importa una fuente (MusicXML / ChordPro) y la persiste inmediatamente en el servidor.
   */
  public async importAndPersist(source: string, filename?: string): Promise<BackendSongResponse> {
    const res = await this.fetchWithAuth('/songs/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, filename }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson?.error?.message ?? `Error en importación remota: HTTP ${res.status}`);
    }

    const json = await res.json();
    return json.data;
  }

  /**
   * Deserializa la carga canónica recuperada de la base de datos
   * para su integración en ProjectionService y renderizado visual.
   */
  public static toCanonicalPayload(response: BackendSongResponse): CanonicalMusicPayload {
    return CanonicalMusicPayload.fromJSON(response.version.canonicalPayload);
  }

  // ==========================================================================
  // MÉTODOS DE SETLISTS Y MOMENTOS LITÚRGICOS (FASE 2C — WS6)
  // ==========================================================================

  /**
   * Consulta el listado paginado de setlists con filtros opcionales.
   * Endpoint: GET /api/v1/setlists
   */
  public async listSetlists(params?: {
    status?: FrontendSetlistStatus;
    upcoming?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<FrontendListSetlistsResult> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.upcoming !== undefined) query.set('upcoming', String(params.upcoming));
    if (params?.limit !== undefined) query.set('limit', String(params.limit));
    if (params?.offset !== undefined) query.set('offset', String(params.offset));

    const path = `/setlists${query.toString() ? `?${query.toString()}` : ''}`;
    const res = await this.fetchWithAuth(path);
    if (!res.ok) {
      throw await ApiError.fromResponse(res);
    }

    const json: HttpListSetlistsResponse = await res.json();
    return {
      items: json.data,
      total: json.pagination.total,
      limit: json.pagination.limit,
      offset: json.pagination.offset,
    };
  }

  /**
   * Crea un nuevo setlist en estado PLANNING.
   * Endpoint: POST /api/v1/setlists
   */
  public async createSetlist(payload: CreateSetlistPayload): Promise<FrontendSetlistEntity> {
    const res = await this.fetchWithAuth('/setlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw await ApiError.fromResponse(res);
    }

    const json = await res.json();
    return json.data;
  }

  /**
   * Obtiene el detalle completo de un setlist con sus ítems ordenados.
   * Endpoint: GET /api/v1/setlists/:id
   */
  public async getSetlist(id: string): Promise<FrontendSetlistDetail> {
    const res = await this.fetchWithAuth(`/setlists/${id}`);
    if (!res.ok) {
      throw await ApiError.fromResponse(res);
    }

    const json = await res.json();
    return json.data;
  }

  /**
   * Modifica los metadatos de un setlist existente.
   * Endpoint: PUT /api/v1/setlists/:id
   */
  public async updateSetlist(id: string, payload: UpdateSetlistPayload): Promise<FrontendSetlistEntity> {
    const res = await this.fetchWithAuth(`/setlists/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw await ApiError.fromResponse(res);
    }

    const json = await res.json();
    return json.data;
  }

  /**
   * Elimina un setlist en cascada.
   * Endpoint: DELETE /api/v1/setlists/:id
   */
  public async deleteSetlist(id: string): Promise<{ success: boolean; message: string }> {
    const res = await this.fetchWithAuth(`/setlists/${id}`, {
      method: 'DELETE',
    });

    if (!res.ok) {
      throw await ApiError.fromResponse(res);
    }

    return await res.json();
  }

  /**
   * Ejecuta una transición en la máquina de estados litúrgicos (ej. a ACTIVE o COMPLETED).
   * Endpoint: POST /api/v1/setlists/:id/status
   */
  public async updateSetlistStatus(id: string, status: FrontendSetlistStatus): Promise<FrontendSetlistEntity> {
    const res = await this.fetchWithAuth(`/setlists/${id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });

    if (!res.ok) {
      throw await ApiError.fromResponse(res);
    }

    const json = await res.json();
    return json.data;
  }

  /**
   * Agrega un ítem (Canción o Momento Litúrgico) al setlist.
   * Endpoint: POST /api/v1/setlists/:id/items
   */
  public async addSetlistItem(setlistId: string, item: CreateSetlistItemPayload): Promise<FrontendSetlistItem> {
    const res = await this.fetchWithAuth(`/setlists/${setlistId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    });

    if (!res.ok) {
      throw await ApiError.fromResponse(res);
    }

    const json = await res.json();
    return json.data;
  }

  /**
   * Modifica un ítem específico del setlist.
   * Endpoint: PUT /api/v1/setlists/:id/items/:itemId
   */
  public async updateSetlistItem(
    setlistId: string,
    itemId: string,
    item: UpdateSetlistItemPayload
  ): Promise<FrontendSetlistItem> {
    const res = await this.fetchWithAuth(`/setlists/${setlistId}/items/${itemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    });

    if (!res.ok) {
      throw await ApiError.fromResponse(res);
    }

    const json = await res.json();
    return json.data;
  }

  /**
   * Elimina un ítem específico del setlist.
   * Endpoint: DELETE /api/v1/setlists/:id/items/:itemId
   */
  public async deleteSetlistItem(setlistId: string, itemId: string): Promise<{ success: boolean; message: string }> {
    const res = await this.fetchWithAuth(`/setlists/${setlistId}/items/${itemId}`, {
      method: 'DELETE',
    });

    if (!res.ok) {
      throw await ApiError.fromResponse(res);
    }

    return await res.json();
  }

  /**
   * Reordena atómicamente la secuencia de los elementos del setlist.
   * Endpoint: PUT /api/v1/setlists/:id/reorder
   */
  public async reorderSetlist(setlistId: string, itemIds: string[]): Promise<FrontendSetlistItem[]> {
    const res = await this.fetchWithAuth(`/setlists/${setlistId}/reorder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIds }),
    });

    if (!res.ok) {
      throw await ApiError.fromResponse(res);
    }

    const json = await res.json();
    return json.data;
  }

  /**
   * Obtiene las preferencias de visualización del usuario autenticado (Fase 3A — WP-02).
   * Si no existen registros en base de datos, retorna los valores por defecto del rol.
   * Endpoint: GET /api/v1/users/me/preferences
   */
  public async getUserPreferences(): Promise<UserViewPreferenceData> {
    const res = await this.fetchWithAuth('/users/me/preferences', {
      method: 'GET',
    });

    if (!res.ok) {
      throw await ApiError.fromResponse(res);
    }

    const json: GetUserPreferencesResponse = await res.json();
    return json.data;
  }

  /**
   * Actualiza o crea las preferencias de visualización del usuario autenticado en PostgreSQL (Fase 3A — WP-02).
   * Endpoint: PUT /api/v1/users/me/preferences
   */
  public async updateUserPreferences(
    payload: UpdateUserViewPreferencePayload
  ): Promise<UserViewPreferenceData> {
    const res = await this.fetchWithAuth('/users/me/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw await ApiError.fromResponse(res);
    }

    const json: UpdateUserPreferencesResponse = await res.json();
    return json.data;
  }

  // ============================================================================
  // WORKSTREAM A: MÉTODOS DE AUDIO Y PLAYBACK OFFLINE
  // ============================================================================

  /**
   * Obtiene la lista de pistas de audio asociadas a una canción (Workstream A).
   */
  public async getSongAudioAssets(songId: string): Promise<AudioAssetDTO[]> {
    const res = await this.fetchWithAuth(`/songs/${songId}/audio`, { method: 'GET' });
    if (!res.ok) {
      throw await ApiError.fromResponse(res);
    }
    const json = await res.json();
    return json.data;
  }

  /**
   * Obtiene los metadatos canónicos de un activo de audio por su ID.
   */
  public async getAudioMetadata(audioId: string): Promise<AudioAssetDTO> {
    const res = await this.fetchWithAuth(`/audio/${audioId}`, { method: 'GET' });
    if (!res.ok) {
      throw await ApiError.fromResponse(res);
    }
    const json = await res.json();
    return json.data;
  }

  /**
   * Retorna la URL de streaming base para un activo de audio.
   */
  public getAudioStreamUrl(audioId: string): string {
    return `${this.baseUrl}/audio/${audioId}/stream`;
  }

  /**
   * Obtiene una URL de streaming autenticada mediante un ticket temporal de corta duración (R1-P0).
   * Compatible con el elemento nativo <audio> sin exponer el token de acceso JWT en URLs persistentes.
   */
  public async getAudioPlaybackStreamUrl(audioId: string): Promise<string> {
    const res = await this.fetchWithAuth(`/audio/${audioId}/ticket`, { method: 'POST' });
    if (!res.ok) {
      throw await ApiError.fromResponse(res);
    }
    const json = await res.json();
    const ticket = json.data?.ticket;
    return `${this.baseUrl}/audio/${audioId}/stream?ticket=${encodeURIComponent(ticket)}`;
  }

  /**
   * Descarga el archivo de audio como Blob para almacenamiento local en IndexedDB.
   */
  public async downloadAudioBlob(audioId: string): Promise<{ blob: Blob; filename: string; mimeType: string }> {
    const res = await this.fetchWithAuth(`/audio/${audioId}/download`, { method: 'GET' });
    if (!res.ok) {
      throw await ApiError.fromResponse(res);
    }
    const blob = await res.blob();
    const disposition = res.headers.get('content-disposition') || '';
    let filename = `audio_${audioId}.mp3`;
    const match = disposition.match(/filename="?([^";]+)"?/);
    if (match && match[1]) {
      filename = decodeURIComponent(match[1]);
    }
    const mimeType = res.headers.get('content-type') || blob.type || 'audio/mpeg';
    return { blob, filename, mimeType };
  }

  // ==========================================================================
  // GESTIÓN DE USUARIOS Y ROLES (FASE 2B / FASE C)
  // ==========================================================================

  /**
   * Consulta el listado paginado de usuarios del ministerio.
   */
  public async listUsers(
    params?: ListUsersParams
  ): Promise<{ items: FrontendUserEntity[]; total: number; limit: number; offset: number }> {
    const query = new URLSearchParams();
    if (params?.limit !== undefined) query.set('limit', String(params.limit));
    if (params?.offset !== undefined) query.set('offset', String(params.offset));
    if (params?.role) query.set('role', params.role);
    if (params?.status) query.set('status', params.status);
    if (params?.search) query.set('search', params.search);

    const path = `/users${query.toString() ? `?${query.toString()}` : ''}`;
    const res = await this.fetchWithAuth(path);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? `Error al listar usuarios: HTTP ${res.status}`);
    }
    const json = await res.json();
    return {
      items: json.data,
      total: json.pagination?.total ?? json.data.length,
      limit: json.pagination?.limit ?? params?.limit ?? 20,
      offset: json.pagination?.offset ?? params?.offset ?? 0,
    };
  }

  /**
   * Emite una invitación administrativa para un nuevo integrante.
   */
  public async inviteUser(payload: {
    email: string;
    firstName: string;
    lastName: string;
    role: UserRole;
  }): Promise<InviteUserResponseData> {
    const res = await this.fetchWithAuth('/users/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? `Error al invitar usuario: HTTP ${res.status}`);
    }
    const json = await res.json();
    return json.data;
  }

  /**
   * Reenvía una invitación a un usuario en PENDING_INVITATION, invalidando el token anterior.
   */
  public async resendInvitation(userId: string): Promise<InviteUserResponseData> {
    const res = await this.fetchWithAuth(`/users/${userId}/resend-invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? `Error al reenviar invitación: HTTP ${res.status}`);
    }
    const json = await res.json();
    return json.data;
  }

  /**
   * Modifica el rol RBAC de un usuario.
   */
  public async changeUserRole(userId: string, role: UserRole): Promise<{ id: string; email: string; role: UserRole }> {
    const res = await this.fetchWithAuth(`/users/${userId}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? `Error al modificar rol: HTTP ${res.status}`);
    }
    const json = await res.json();
    return json.data;
  }

  /**
   * Deshabilita o suspende la cuenta de un usuario.
   */
  public async disableUser(userId: string): Promise<{ message: string }> {
    const res = await this.fetchWithAuth(`/users/${userId}/disable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? `Error al suspender usuario: HTTP ${res.status}`);
    }
    const json = await res.json();
    return { message: json.message };
  }

  /**
   * Reactiva la cuenta de un usuario suspendido o bloqueado.
   */
  public async enableUser(userId: string): Promise<{ message: string }> {
    const res = await this.fetchWithAuth(`/users/${userId}/enable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? `Error al reactivar usuario: HTTP ${res.status}`);
    }
    const json = await res.json();
    return { message: json.message };
  }
}

export interface ListUsersParams {
  limit?: number | undefined;
  offset?: number | undefined;
  role?: UserRole | undefined;
  status?: AccountStatus | undefined;
  search?: string | undefined;
}

export interface FrontendUserEntity {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  accountStatus: AccountStatus;
  emailVerified: boolean;
  createdAt: string;
}

export interface InviteUserResponseData {
  invitationId?: string;
  userId: string;
  email: string;
  role: UserRole;
  expiresAt: string;
  invitationToken: string;
  deliveryStatus: 'SENT' | 'UNCONFIGURED_MOCK';
  deliveryMessage: string;
}

export interface AudioAssetDTO {
  readonly id: string;
  readonly songId: string;
  readonly title: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly fileSizeBytes: number;
  readonly checksumSha256: string;
  readonly durationSeconds?: number | null;
  readonly createdAt: string;
}

