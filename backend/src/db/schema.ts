/**
 * @file schema.ts
 * @description Definición del esquema relacional y JSONB de PostgreSQL con Drizzle ORM
 * para Bethesda Worship Studio (Fases 2A, 2B & 2C).
 *
 * Mantiene la Estrategia Híbrida (Opción C) de la Fase 2A:
 * - Entidades relacionales para canciones, versiones y fuentes.
 * - JSONB validado para el grafo canónico completo (CanonicalMusicPayload).
 *
 * Incorpora la Arquitectura de Seguridad y RBAC de la Fase 2B:
 * - Tablas: users, refresh_tokens, password_reset_tokens, user_invitations, audit_logs.
 *
 * Incorpora la Gestión Litúrgica y Flujo de Alabanza de la Fase 2C:
 * - Tablas: setlists, setlist_items.
 * - Cero alteración destructiva de tablas existentes.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// ============================================================================
// ENUMS DE SEGURIDAD (FASE 2B)
// ============================================================================

export const userRoleEnum = pgEnum('user_role', [
  'SUPER_ADMIN',
  'ADMIN',
  'WORSHIP_LEADER',
  'MUSICIAN',
  'VIEWER',
]);

export const accountStatusEnum = pgEnum('account_status', [
  'PENDING_INVITATION',
  'MUST_CHANGE_PASSWORD',
  'ACTIVE',
  'LOCKED',
  'SUSPENDED',
]);

// ============================================================================
// ENUMS DE SETLISTS Y LITURGIA (FASE 2C)
// ============================================================================

export const setlistStatusEnum = pgEnum('setlist_status', [
  'PLANNING',
  'ACTIVE',
  'COMPLETED',
  'ARCHIVED',
]);

export const setlistItemTypeEnum = pgEnum('setlist_item_type', [
  'SONG',
  'SERVICE_MOMENT',
]);

export const transitionTypeEnum = pgEnum('transition_type', [
  'SEGUE',
  'CROSSFADE',
  'STOP',
  'MEDLEY',
]);

// ============================================================================
// ENTIDADES DE SEGURIDAD Y USUARIOS (FASE 2B)
// ============================================================================

/**
 * Tabla: users
 * Credenciales, perfil y estado de acceso de cada integrante del ministerio.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    firstName: varchar('first_name', { length: 128 }).notNull(),
    lastName: varchar('last_name', { length: 128 }).notNull(),
    role: userRoleEnum('role').notNull().default('MUSICIAN'),
    accountStatus: accountStatusEnum('account_status').notNull().default('ACTIVE'),
    emailVerified: boolean('email_verified').notNull().default(false),
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
    lockoutUntil: timestamp('lockout_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    tokenVersion: integer('token_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_users_email_unique').on(table.email),
    index('idx_users_role').on(table.role),
    index('idx_users_status').on(table.accountStatus),
  ]
);

/**
 * Tabla: refresh_tokens
 * Almacenamiento seguro de sesiones persistentes con control de rotación y familias de tokens.
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(), // SHA-256 hex
    familyId: uuid('family_id').notNull(),
    isRevoked: boolean('is_revoked').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    userAgent: varchar('user_agent', { length: 512 }),
    ipAddress: varchar('ip_address', { length: 45 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_refresh_tokens_user_id').on(table.userId),
    index('idx_refresh_tokens_family_id').on(table.familyId),
    uniqueIndex('idx_refresh_tokens_token_hash').on(table.tokenHash),
  ]
);

/**
 * Tabla: password_reset_tokens
 * Tokens criptográficos de un solo uso para restablecimiento seguro de clave.
 */
export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(), // SHA-256 hex
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    isUsed: boolean('is_used').notNull().default(false),
    ipAddress: varchar('ip_address', { length: 45 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_password_reset_user_id').on(table.userId),
    uniqueIndex('idx_password_reset_token_hash').on(table.tokenHash),
  ]
);

/**
 * Tabla: user_invitations
 * Invitaciones emitidas por administradores para registro autónomo de contraseñas.
 */
export const userInvitations = pgTable(
  'user_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(), // SHA-256 hex
    role: userRoleEnum('role').notNull().default('MUSICIAN'),
    invitedByUserId: uuid('invited_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    isAccepted: boolean('is_accepted').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_user_invitations_email').on(table.email),
    uniqueIndex('idx_user_invitations_token_hash').on(table.tokenHash),
  ]
);

/**
 * Tabla: audit_logs
 * Registro inmutable de eventos de seguridad y gobernanza ("application-level append-only").
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    resource: varchar('resource', { length: 128 }),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_audit_logs_event_type').on(table.eventType),
    index('idx_audit_logs_user_id').on(table.userId),
    index('idx_audit_logs_created_at').on(table.createdAt),
  ]
);

// ============================================================================
// ENTIDADES MUSICALES (FASE 2A CON ATRIBUCIÓN FASE 2B)
// ============================================================================

/**
 * Tabla: songs
 * Identidad estable de la canción y metadatos maestros.
 */
export const songs = pgTable(
  'songs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: varchar('title', { length: 255 }).notNull(),
    artist: varchar('artist', { length: 255 }),
    ccliNumber: varchar('ccli_number', { length: 64 }),
    defaultKey: varchar('default_key', { length: 16 }).notNull(),
    defaultBpm: integer('default_bpm').notNull().default(120),
    timeSignature: varchar('time_signature', { length: 16 }).notNull().default('4/4'),
    status: varchar('status', { length: 32 }).notNull().default('DRAFT'), // 'DRAFT' | 'APPROVED' | 'ARCHIVED'
    currentVersionId: uuid('current_version_id'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_songs_title').on(table.title),
    index('idx_songs_artist').on(table.artist),
    index('idx_songs_status').on(table.status),
    index('idx_songs_default_key').on(table.defaultKey),
    index('idx_songs_created_by').on(table.createdByUserId),
  ]
);

/**
 * Tabla: song_versions
 * Versiones inmutables de contenido musical.
 * Almacena el grafo canónico en JSONB preservando el modelo sin mutaciones.
 */
export const songVersions = pgTable(
  'song_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    songId: uuid('song_id')
      .notNull()
      .references(() => songs.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    name: varchar('name', { length: 255 }).notNull().default('Principal'),
    description: text('description'),
    sourceFormat: varchar('source_format', { length: 32 }).notNull(), // 'MUSIC_XML' | 'CHORD_PRO' | 'INTERNAL'
    canonicalPayload: jsonb('canonical_payload').notNull(), // CanonicalMusicPayloadJSON
    totalMeasures: integer('total_measures').notNull().default(0),
    totalNotes: integer('total_notes').notNull().default(0),
    totalChords: integer('total_chords').notNull().default(0),
    isCurrent: boolean('is_current').notNull().default(false),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_song_versions_song_id').on(table.songId),
    uniqueIndex('idx_song_versions_song_version').on(table.songId, table.versionNumber),
    index('idx_song_versions_created_by').on(table.createdByUserId),
  ]
);

/**
 * Tabla: song_sources
 * Procedencia del contenido importado (MusicXML, ChordPro, etc.).
 */
export const songSources = pgTable(
  'song_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    songId: uuid('song_id')
      .notNull()
      .references(() => songs.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id').references(() => songVersions.id, { onDelete: 'set null' }),
    sourceType: varchar('source_type', { length: 32 }).notNull(), // 'MUSIC_XML' | 'CHORD_PRO'
    filename: varchar('filename', { length: 255 }),
    rawContent: text('raw_content'),
    importerName: varchar('importer_name', { length: 64 }).notNull(),
    importerVersion: varchar('importer_version', { length: 32 }).notNull(),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_song_sources_song_id').on(table.songId),
    index('idx_song_sources_version_id').on(table.versionId),
  ]
);

/**
 * Tabla: song_metadata
 * Metadatos complementarios (etiquetas temáticas, notas pastorales/litúrgicas).
 */
export const songMetadata = pgTable(
  'song_metadata',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    songId: uuid('song_id')
      .notNull()
      .references(() => songs.id, { onDelete: 'cascade' }),
    tags: jsonb('tags').notNull().default([]),
    themes: jsonb('themes').notNull().default([]),
    copyright: text('copyright'),
    notes: text('notes'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_song_metadata_song_id').on(table.songId),
  ]
);

// ============================================================================
// ENTIDADES DE SETLISTS Y LITURGIA (FASE 2C)
// ============================================================================

/**
 * Tabla: setlists
 * Estructura de servicios, cultos y listas de alabanza de la congregación.
 */
export const setlists = pgTable(
  'setlists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: varchar('title', { length: 255 }).notNull(),
    scheduledDateTime: timestamp('scheduled_date_time', { withTimezone: true }),
    status: setlistStatusEnum('status').notNull().default('PLANNING'),
    directorUserId: uuid('director_user_id').references(() => users.id, { onDelete: 'set null' }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_setlists_status').on(table.status),
    index('idx_setlists_scheduled').on(table.scheduledDateTime),
    index('idx_setlists_director').on(table.directorUserId),
    uniqueIndex('idx_setlists_single_active')
      .on(table.status)
      .where(sql`${table.status} = 'ACTIVE'`),
  ]
);

/**
 * Tabla: setlist_items
 * Elementos ordenados del servicio: Canciones canónicas con sobrescritura litúrgica
 * o momentos litúrgicos de adoración (oración, palabra, ofrendas, ministración).
 */
export const setlistItems = pgTable(
  'setlist_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    setlistId: uuid('setlist_id')
      .notNull()
      .references(() => setlists.id, { onDelete: 'cascade' }),
    sequenceOrder: integer('sequence_order').notNull(),
    itemType: setlistItemTypeEnum('item_type').notNull(),
    // Campos exclusivos para SONG
    songId: uuid('song_id').references(() => songs.id, { onDelete: 'restrict' }),
    targetKey: varchar('target_key', { length: 16 }),
    targetBpm: integer('target_bpm'),
    transitionType: transitionTypeEnum('transition_type').default('STOP'),
    // Campos exclusivos para SERVICE_MOMENT
    momentTitle: varchar('moment_title', { length: 255 }),
    durationMinutes: integer('duration_minutes'),
    musicalKey: varchar('musical_key', { length: 16 }),
    // Notas compartidas de dirección y dinámica
    notesForTeam: text('notes_for_team'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_setlist_items_setlist_id').on(table.setlistId),
    index('idx_setlist_items_sequence').on(table.setlistId, table.sequenceOrder),
    index('idx_setlist_items_song_id').on(table.songId),
  ]
);

// ============================================================================
// ENTIDADES DE PREFERENCIAS DE VISTA (FASE 3A — DEC-02)
// ============================================================================

/**
 * Tabla: user_view_preferences
 * Configuración persistente del atril y formato de lectura por usuario.
 */
export const userViewPreferences = pgTable(
  'user_view_preferences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    instrumentId: varchar('instrument_id', { length: 64 }).notNull(),
    primaryRepresentation: varchar('primary_representation', { length: 64 }).notNull(),
    secondaryRepresentations: jsonb('secondary_representations')
      .$type<string[]>()
      .notNull()
      .default([]),
    chordNotationSystem: varchar('chord_notation_system', { length: 32 })
      .notNull()
      .default('STANDARD'),
    transpositionSemitones: integer('transposition_semitones').notNull().default(0),
    capoFret: integer('capo_fret').notNull().default(0),
    clefOverride: varchar('clef_override', { length: 32 }),
    preferFlats: boolean('prefer_flats').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_user_view_preferences_user_id').on(table.userId),
    index('idx_user_view_preferences_instrument_id').on(table.instrumentId),
  ]
);

// ============================================================================
// ENTIDADES DE AUDIO Y MULTIMEDIA (WORKSTREAM A)
// ============================================================================

/**
 * Tabla: audio_assets
 * Recursos de audio asociados a canciones (pistas de referencia, grabaciones, stems).
 */
export const audioAssets = pgTable(
  'audio_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    songId: uuid('song_id')
      .notNull()
      .references(() => songs.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    filename: varchar('filename', { length: 255 }).notNull(),
    storagePath: varchar('storage_path', { length: 512 }).notNull(),
    mimeType: varchar('mime_type', { length: 64 }).notNull(),
    fileSizeBytes: integer('file_size_bytes').notNull(),
    checksumSha256: varchar('checksum_sha256', { length: 64 }).notNull(),
    durationSeconds: integer('duration_seconds'),
    uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_audio_assets_song_id').on(table.songId),
    index('idx_audio_assets_uploaded_by').on(table.uploadedByUserId),
    index('idx_audio_assets_created_at').on(table.createdAt),
  ]
);

// ============================================================================
// RELACIONES DRIZZLE ORM
// ============================================================================

export const usersRelations = relations(users, ({ many, one }) => ({
  refreshTokens: many(refreshTokens),
  passwordResetTokens: many(passwordResetTokens),
  invitationsSent: many(userInvitations),
  auditLogs: many(auditLogs),
  createdSongs: many(songs, { relationName: 'creator' }),
  updatedSongs: many(songs, { relationName: 'updater' }),
  createdVersions: many(songVersions),
  directedSetlists: many(setlists),
  viewPreferences: one(userViewPreferences),
  uploadedAudios: many(audioAssets),
}));

export const userViewPreferencesRelations = relations(userViewPreferences, ({ one }) => ({
  user: one(users, {
    fields: [userViewPreferences.userId],
    references: [users.id],
  }),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, {
    fields: [refreshTokens.userId],
    references: [users.id],
  }),
}));

export const passwordResetTokensRelations = relations(passwordResetTokens, ({ one }) => ({
  user: one(users, {
    fields: [passwordResetTokens.userId],
    references: [users.id],
  }),
}));

export const userInvitationsRelations = relations(userInvitations, ({ one }) => ({
  invitedBy: one(users, {
    fields: [userInvitations.invitedByUserId],
    references: [users.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, {
    fields: [auditLogs.userId],
    references: [users.id],
  }),
}));

export const songsRelations = relations(songs, ({ many, one }) => ({
  versions: many(songVersions),
  sources: many(songSources),
  metadata: one(songMetadata, {
    fields: [songs.id],
    references: [songMetadata.songId],
  }),
  createdByUser: one(users, {
    fields: [songs.createdByUserId],
    references: [users.id],
    relationName: 'creator',
  }),
  updatedByUser: one(users, {
    fields: [songs.updatedByUserId],
    references: [users.id],
    relationName: 'updater',
  }),
  setlistItems: many(setlistItems),
  audioAssets: many(audioAssets),
}));

export const audioAssetsRelations = relations(audioAssets, ({ one }) => ({
  song: one(songs, {
    fields: [audioAssets.songId],
    references: [songs.id],
  }),
  uploadedByUser: one(users, {
    fields: [audioAssets.uploadedByUserId],
    references: [users.id],
  }),
}));

export const songVersionsRelations = relations(songVersions, ({ one, many }) => ({
  song: one(songs, {
    fields: [songVersions.songId],
    references: [songs.id],
  }),
  sources: many(songSources),
  createdByUser: one(users, {
    fields: [songVersions.createdByUserId],
    references: [users.id],
  }),
}));

export const songSourcesRelations = relations(songSources, ({ one }) => ({
  song: one(songs, {
    fields: [songSources.songId],
    references: [songs.id],
  }),
  version: one(songVersions, {
    fields: [songSources.versionId],
    references: [songVersions.id],
  }),
}));

export const songMetadataRelations = relations(songMetadata, ({ one }) => ({
  song: one(songs, {
    fields: [songMetadata.songId],
    references: [songs.id],
  }),
}));

export const setlistsRelations = relations(setlists, ({ one, many }) => ({
  director: one(users, {
    fields: [setlists.directorUserId],
    references: [users.id],
  }),
  items: many(setlistItems),
}));

export const setlistItemsRelations = relations(setlistItems, ({ one }) => ({
  setlist: one(setlists, {
    fields: [setlistItems.setlistId],
    references: [setlists.id],
  }),
  song: one(songs, {
    fields: [setlistItems.songId],
    references: [songs.id],
  }),
}));

// ============================================================================
// TIPOS INFERIDOS DRIZZLE ORM (FASE 2C)
// ============================================================================

export type Setlist = typeof setlists.$inferSelect;
export type NewSetlist = typeof setlists.$inferInsert;
export type SetlistItem = typeof setlistItems.$inferSelect;
export type NewSetlistItem = typeof setlistItems.$inferInsert;
export type SetlistStatus = (typeof setlistStatusEnum.enumValues)[number];
export type SetlistItemType = (typeof setlistItemTypeEnum.enumValues)[number];
export type TransitionType = (typeof transitionTypeEnum.enumValues)[number];

// ============================================================================
// TIPOS INFERIDOS DRIZZLE ORM (FASE 3A — DEC-02)
// ============================================================================

export type UserViewPreferenceEntity = typeof userViewPreferences.$inferSelect;
export type NewUserViewPreferenceEntity = typeof userViewPreferences.$inferInsert;

// ============================================================================
// ENTIDADES DE MULTITRACKS Y MEZCLA (FASE 3C — WORKSTREAM R1)
// ============================================================================

/**
 * Tabla: multitrack_sessions
 * Sesiones de multipistas persistentes asociadas a una canción canónica.
 */
export const multitrackSessions = pgTable(
  'multitrack_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    songId: uuid('song_id')
      .notNull()
      .references(() => songs.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    durationSeconds: integer('duration_seconds').notNull().default(0),
    bpm: integer('bpm').notNull().default(120),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_multitrack_sessions_song_id').on(table.songId),
    index('idx_multitrack_sessions_created_by').on(table.createdByUserId),
  ]
);

/**
 * Tabla: multitrack_tracks
 * Pistas o stems individuales pertenecientes a una sesión de multipistas.
 */
export const multitrackTracks = pgTable(
  'multitrack_tracks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => multitrackSessions.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    trackType: varchar('track_type', { length: 64 }).notNull(),
    audioAssetId: uuid('audio_asset_id')
      .notNull()
      .references(() => audioAssets.id, { onDelete: 'cascade' }),
    volume: real('volume').notNull().default(0.8),
    pan: real('pan').notNull().default(0),
    isMuted: boolean('is_muted').notNull().default(false),
    isSolo: boolean('is_solo').notNull().default(false),
    offsetMs: integer('offset_ms').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_multitrack_tracks_session_id').on(table.sessionId),
    index('idx_multitrack_tracks_audio_asset_id').on(table.audioAssetId),
  ]
);

export const multitrackSessionsRelations = relations(multitrackSessions, ({ one, many }) => ({
  song: one(songs, {
    fields: [multitrackSessions.songId],
    references: [songs.id],
  }),
  createdByUser: one(users, {
    fields: [multitrackSessions.createdByUserId],
    references: [users.id],
  }),
  tracks: many(multitrackTracks),
}));

export const multitrackTracksRelations = relations(multitrackTracks, ({ one }) => ({
  session: one(multitrackSessions, {
    fields: [multitrackTracks.sessionId],
    references: [multitrackSessions.id],
  }),
  audioAsset: one(audioAssets, {
    fields: [multitrackTracks.audioAssetId],
    references: [audioAssets.id],
  }),
}));

// ============================================================================
// TIPOS INFERIDOS DRIZZLE ORM (WORKSTREAM A — AUDIO)
// ============================================================================

export type AudioAsset = typeof audioAssets.$inferSelect;
export type NewAudioAsset = typeof audioAssets.$inferInsert;

// ============================================================================
// TIPOS INFERIDOS DRIZZLE ORM (FASE 3C — MULTITRACKS)
// ============================================================================

export type MultitrackSessionRow = typeof multitrackSessions.$inferSelect;
export type NewMultitrackSessionRow = typeof multitrackSessions.$inferInsert;
export type MultitrackTrackRow = typeof multitrackTracks.$inferSelect;
export type NewMultitrackTrackRow = typeof multitrackTracks.$inferInsert;


