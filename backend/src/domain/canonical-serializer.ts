/**
 * @file canonical-serializer.ts
 * @description Frontera de serialización y deserialización determinista del modelo canónico (Fase 2A).
 *
 * Convierte entre objetos de dominio `CanonicalMusicPayload` y estructuras de persistencia JSONB,
 * garantizando validación estricta en servidor antes de almacenar cualquier dato.
 */

import {
  CanonicalMusicPayload,
  type CanonicalMusicPayloadJSON,
  CanonicalModelValidator,
} from '../../../frontend/src/core/canonical-model/index.ts';
import { InvalidMusicPayloadError } from './errors.ts';

export interface CanonicalStatistics {
  readonly totalMeasures: number;
  readonly totalNotes: number;
  readonly totalChords: number;
}

export class CanonicalSerializer {
  /**
   * Serializa un objeto de dominio `CanonicalMusicPayload` a una estructura JSONB persistible.
   */
  public static serialize(payload: CanonicalMusicPayload): CanonicalMusicPayloadJSON {
    if (!payload || !(payload instanceof CanonicalMusicPayload)) {
      throw new InvalidMusicPayloadError('No se puede serializar un payload canónico nulo o inválido.');
    }

    // Validación de integridad canónica previa a la serialización
    const validation = CanonicalModelValidator.validate(payload);
    if (!validation.isValid) {
      throw new InvalidMusicPayloadError(
        'El payload canónico no cumple las reglas de integridad del modelo.',
        validation.errors
      );
    }

    return payload.toJSON();
  }

  /**
   * Extrae estadísticas cuantitativas del payload canónico para indexación relacional.
   */
  public static extractStatistics(payload: CanonicalMusicPayload): CanonicalStatistics {
    const totalMeasures = payload.measures.length;
    let totalNotes = 0;
    let totalChords = 0;

    for (const measure of payload.measures) {
      totalNotes += measure.getAllNotes().length;
      totalChords += measure.chords.length;
    }

    return {
      totalMeasures,
      totalNotes,
      totalChords,
    };
  }
}

export class CanonicalDeserializer {
  /**
   * Deserializa una estructura JSONB almacenada en la base de datos a un objeto de dominio
   * `CanonicalMusicPayload` inmutable y validado.
   */
  public static deserialize(input: unknown): CanonicalMusicPayload {
    if (!input || typeof input !== 'object') {
      throw new InvalidMusicPayloadError('El JSON recibido para el payload canónico no es un objeto válido.');
    }

    const json = input as CanonicalMusicPayloadJSON;

    if (!json.title || typeof json.title !== 'string') {
      throw new InvalidMusicPayloadError("El payload canónico carece del atributo obligatorio 'title'.");
    }

    if (!json.timeline || typeof json.timeline !== 'object') {
      throw new InvalidMusicPayloadError("El payload canónico carece de una 'timeline' válida.");
    }

    if (!Array.isArray(json.measures)) {
      throw new InvalidMusicPayloadError("El payload canónico carece de un arreglo de 'measures'.");
    }

    try {
      const payload = CanonicalMusicPayload.fromJSON(json);

      // Validación canónica exhaustiva en servidor
      const validation = CanonicalModelValidator.validate(payload);
      if (!validation.isValid) {
        throw new InvalidMusicPayloadError(
          'El payload canónico deserializado falló la validación del modelo:',
          validation.errors
        );
      }

      return payload;
    } catch (error) {
      if (error instanceof InvalidMusicPayloadError) {
        throw error;
      }
      throw new InvalidMusicPayloadError(
        `Fallo durante la reconstrucción del modelo canónico: ${error instanceof Error ? error.message : 'Error desconocido'}`,
        error
      );
    }
  }
}
