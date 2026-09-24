/**
 * @file key-signature-reference.ts
 * @description Modela la referencia a la armadura de clave y contexto tonal de un compás,
 * reutilizando directamente los tipos de dominio de la Fase 1A (MusicalKey, KeySignature, NoteName).
 */

import { KeySignature } from '../music-theory/key-signature.ts';
import { type KeyMode, MusicalKey } from '../music-theory/musical-key.ts';
import { NoteName } from '../music-theory/note-name.ts';

export interface KeySignatureReferenceJSON {
  tonic: string;
  mode: KeyMode;
  accidentalCount: number;
}

export class KeySignatureReference {
  public readonly tonic: NoteName;
  public readonly mode: KeyMode;
  public readonly keySignature: KeySignature;

  public constructor(tonic: NoteName, mode: KeyMode, keySignature?: KeySignature) {
    this.tonic = tonic;
    this.mode = mode;
    this.keySignature = keySignature ?? new KeySignature(0);
  }

  public toMusicalKey(): MusicalKey {
    return new MusicalKey(this.tonic, this.mode, this.keySignature);
  }

  public static fromMusicalKey(key: MusicalKey): KeySignatureReference {
    return new KeySignatureReference(key.tonic, key.mode, key.keySignature);
  }

  public toJSON(): KeySignatureReferenceJSON {
    return {
      tonic: this.tonic.toString(),
      mode: this.mode,
      accidentalCount: this.keySignature.accidentalCount,
    };
  }

  public static fromJSON(json: KeySignatureReferenceJSON): KeySignatureReference {
    const tonic = NoteName.parse(json.tonic);
    const keySig = new KeySignature(json.accidentalCount);
    return new KeySignatureReference(tonic, json.mode, keySig);
  }
}
