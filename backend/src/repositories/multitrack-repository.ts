/**
 * @file multitrack-repository.ts
 * @description Repositorio para la persistencia y consulta de sesiones y pistas multipista en PostgreSQL (Fase 3C / R1).
 */

import { eq, and, asc, desc } from 'drizzle-orm';
import { db as defaultDb, type Database } from '../db/index.ts';
import {
  multitrackSessions,
  multitrackTracks,
  type MultitrackSessionRow,
  type NewMultitrackSessionRow,
  type MultitrackTrackRow,
  type NewMultitrackTrackRow,
} from '../db/schema.ts';
import type {
  MultitrackSession,
  MultitrackTrack,
  MultitrackTrackType,
} from '../domain/multitrack/types.ts';

export interface IMultitrackRepository {
  createSession(
    sessionData: NewMultitrackSessionRow,
    tracksData: NewMultitrackTrackRow[]
  ): Promise<MultitrackSession>;
  findById(sessionId: string): Promise<MultitrackSession | null>;
  findBySongId(songId: string): Promise<MultitrackSession[]>;
  updateTrackMix(
    sessionId: string,
    trackId: string,
    updates: { volume?: number; pan?: number; isMuted?: boolean; isSolo?: boolean }
  ): Promise<MultitrackTrack | null>;
  deleteSession(sessionId: string): Promise<boolean>;
}

export class DrizzleMultitrackRepository implements IMultitrackRepository {
  public constructor(private readonly db: Database = defaultDb) {}

  public async createSession(
    sessionData: NewMultitrackSessionRow,
    tracksData: NewMultitrackTrackRow[]
  ): Promise<MultitrackSession> {
    return await this.db.transaction(async (tx) => {
      const [insertedSession] = await tx
        .insert(multitrackSessions)
        .values(sessionData)
        .returning();

      if (!insertedSession) {
        throw new Error('Fallo al crear la sesión multipista en PostgreSQL.');
      }

      let insertedTracks: MultitrackTrackRow[] = [];
      if (tracksData.length > 0) {
        const preparedTracks = tracksData.map((t) => ({
          ...t,
          sessionId: insertedSession.id,
        }));
        insertedTracks = await tx
          .insert(multitrackTracks)
          .values(preparedTracks)
          .returning();
      }

      return this.mapToDomain(insertedSession, insertedTracks);
    });
  }

  public async findById(sessionId: string): Promise<MultitrackSession | null> {
    const [session] = await this.db
      .select()
      .from(multitrackSessions)
      .where(eq(multitrackSessions.id, sessionId))
      .limit(1);

    if (!session) {
      return null;
    }

    const tracks = await this.db
      .select()
      .from(multitrackTracks)
      .where(eq(multitrackTracks.sessionId, sessionId))
      .orderBy(asc(multitrackTracks.sortOrder));

    return this.mapToDomain(session, tracks);
  }

  public async findBySongId(songId: string): Promise<MultitrackSession[]> {
    const sessions = await this.db
      .select()
      .from(multitrackSessions)
      .where(eq(multitrackSessions.songId, songId))
      .orderBy(desc(multitrackSessions.createdAt));

    const results: MultitrackSession[] = [];
    for (const session of sessions) {
      const tracks = await this.db
        .select()
        .from(multitrackTracks)
        .where(eq(multitrackTracks.sessionId, session.id))
        .orderBy(asc(multitrackTracks.sortOrder));

      results.push(this.mapToDomain(session, tracks));
    }

    return results;
  }

  public async updateTrackMix(
    sessionId: string,
    trackId: string,
    updates: { volume?: number; pan?: number; isMuted?: boolean; isSolo?: boolean }
  ): Promise<MultitrackTrack | null> {
    const [updatedTrack] = await this.db
      .update(multitrackTracks)
      .set({
        ...(updates.volume !== undefined ? { volume: updates.volume } : {}),
        ...(updates.pan !== undefined ? { pan: updates.pan } : {}),
        ...(updates.isMuted !== undefined ? { isMuted: updates.isMuted } : {}),
        ...(updates.isSolo !== undefined ? { isSolo: updates.isSolo } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(multitrackTracks.id, trackId),
          eq(multitrackTracks.sessionId, sessionId)
        )
      )
      .returning();

    if (!updatedTrack) {
      return null;
    }

    // Actualizar timestamp de la sesión
    await this.db
      .update(multitrackSessions)
      .set({ updatedAt: new Date() })
      .where(eq(multitrackSessions.id, sessionId));

    return this.mapTrackToDomain(updatedTrack);
  }

  public async deleteSession(sessionId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(multitrackSessions)
      .where(eq(multitrackSessions.id, sessionId))
      .returning({ id: multitrackSessions.id });

    return deleted.length > 0;
  }

  private mapToDomain(
    session: MultitrackSessionRow,
    tracks: MultitrackTrackRow[]
  ): MultitrackSession {
    return {
      id: session.id,
      songId: session.songId,
      title: session.title,
      durationSeconds: session.durationSeconds,
      bpm: session.bpm,
      tracks: tracks.map((t) => this.mapTrackToDomain(t)),
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    };
  }

  private mapTrackToDomain(track: MultitrackTrackRow): MultitrackTrack {
    return {
      id: track.id,
      sessionId: track.sessionId,
      name: track.name,
      trackType: track.trackType as MultitrackTrackType,
      audioAssetId: track.audioAssetId,
      volume: track.volume,
      pan: track.pan,
      isMuted: track.isMuted,
      isSolo: track.isSolo,
      offsetMs: track.offsetMs,
      sortOrder: track.sortOrder,
    };
  }
}
