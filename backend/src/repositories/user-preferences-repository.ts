/**
 * @file user-preferences-repository.ts
 * @description Repositorio para la persistencia de preferencias de vista de músicos (Fase 3A — DEC-02)
 * utilizando Drizzle ORM y PostgreSQL con soporte de upsert atómico.
 */

import { eq } from 'drizzle-orm';
import { db as defaultDb, type Database } from '../db/index.ts';
import { userViewPreferences, type UserViewPreferenceEntity } from '../db/schema.ts';

export interface UpsertUserPreferencesDTO {
  instrumentId: string;
  primaryRepresentation: string;
  secondaryRepresentations?: string[] | undefined;
  chordNotationSystem?: string | undefined;
  transpositionSemitones?: number | undefined;
  capoFret?: number | undefined;
  clefOverride?: string | null | undefined;
  preferFlats?: boolean | undefined;
}

export interface IUserPreferencesRepository {
  findByUserId(userId: string): Promise<UserViewPreferenceEntity | null>;
  upsert(userId: string, data: UpsertUserPreferencesDTO): Promise<UserViewPreferenceEntity>;
  deleteByUserId(userId: string): Promise<boolean>;
}

export class DrizzleUserPreferencesRepository implements IUserPreferencesRepository {
  public constructor(private readonly db: Database = defaultDb) {}

  /**
   * Obtiene las preferencias guardadas para un usuario específico.
   * Retorna null si el usuario no tiene preferencias persistidas aún.
   */
  public async findByUserId(userId: string): Promise<UserViewPreferenceEntity | null> {
    const [found] = await this.db
      .select()
      .from(userViewPreferences)
      .where(eq(userViewPreferences.userId, userId))
      .limit(1);

    return found ?? null;
  }

  /**
   * Ejecuta un UPSERT atómico en PostgreSQL sobre user_view_preferences:
   * Si no existe registro para el user_id, lo inserta.
   * Si ya existe registro para el user_id (violación de índice único), lo actualiza.
   */
  public async upsert(
    userId: string,
    data: UpsertUserPreferencesDTO
  ): Promise<UserViewPreferenceEntity> {
    const [upserted] = await this.db
      .insert(userViewPreferences)
      .values({
        userId,
        instrumentId: data.instrumentId.trim(),
        primaryRepresentation: data.primaryRepresentation,
        secondaryRepresentations: data.secondaryRepresentations ?? [],
        chordNotationSystem: data.chordNotationSystem ?? 'STANDARD',
        transpositionSemitones: data.transpositionSemitones ?? 0,
        capoFret: data.capoFret ?? 0,
        clefOverride: data.clefOverride ?? null,
        preferFlats: data.preferFlats ?? false,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userViewPreferences.userId,
        set: {
          instrumentId: data.instrumentId.trim(),
          primaryRepresentation: data.primaryRepresentation,
          secondaryRepresentations: data.secondaryRepresentations ?? [],
          chordNotationSystem: data.chordNotationSystem ?? 'STANDARD',
          transpositionSemitones: data.transpositionSemitones ?? 0,
          capoFret: data.capoFret ?? 0,
          clefOverride: data.clefOverride ?? null,
          preferFlats: data.preferFlats ?? false,
          updatedAt: new Date(),
        },
      })
      .returning();

    return upserted;
  }

  /**
   * Elimina las preferencias guardadas de un usuario.
   */
  public async deleteByUserId(userId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(userViewPreferences)
      .where(eq(userViewPreferences.userId, userId))
      .returning();

    return deleted.length > 0;
  }
}
