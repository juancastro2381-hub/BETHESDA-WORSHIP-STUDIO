import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Chord } from '../chord.ts';
import { MusicalKey } from '../musical-key.ts';
import { NoteName } from '../note-name.ts';
import { CapoCalculator } from '../transposition.ts';

describe('Capo vs Transposition Domain Invariant Tests', () => {
  it('should prove the canonical example: Concert G Major with Capo 2 produces F fingering shapes while sounding key remains G Major', () => {
    // 1. Tonalidad y acorde canónico de concierto
    const canonicalConcertKey = MusicalKey.G_MAJOR;
    const concertChordG = Chord.parse('G');

    // 2. El guitarrista coloca Capo en el traste 2
    const capoFret = 2;

    // 3. Calcular la forma/digitación para los dedos del guitarrista
    // G (concierto) - 2 semitonos = F (forma visual en el atril)
    const fingeringChord = CapoCalculator.calculateFingeringChord(
      concertChordG,
      capoFret,
      MusicalKey.F_MAJOR
    );

    // La digitación mostrada al guitarrista debe tener fundamental 'F'
    assert.strictEqual(fingeringChord.root.toString(), 'F');
    assert.strictEqual(fingeringChord.quality, 'MAJOR');
    assert.strictEqual(fingeringChord.toString(), 'F');

    // 4. Calcular el acorde sonante real que escucha la congregación y tocan los demás
    // F (forma de los dedos) + 2 semitonos del capo = G (acorde sonante real)
    const soundingChord = CapoCalculator.calculateSoundingChord(
      fingeringChord,
      capoFret,
      canonicalConcertKey
    );

    assert.strictEqual(soundingChord.root.toString(), 'G');
    assert.strictEqual(soundingChord.quality, 'MAJOR');
    assert.strictEqual(soundingChord.toString(), 'G');

    // 5. Demostrar el invariante: la tonalidad canónica de concierto NO ha mutado
    assert.strictEqual(canonicalConcertKey.equals(MusicalKey.G_MAJOR), true);
    assert.strictEqual(canonicalConcertKey.tonic.equals(NoteName.G), true);
  });

  it('should correctly calculate fingering shapes across various capo positions', () => {
    // Caso 1: Tono Concierto D Mayor con Capo 2 -> Digitación C (Do Mayor)
    const concertD = Chord.parse('D');
    const fingeringForDWithCapo2 = CapoCalculator.calculateFingeringChord(
      concertD,
      2,
      MusicalKey.C_MAJOR
    );
    assert.strictEqual(fingeringForDWithCapo2.root.toString(), 'C');
    assert.strictEqual(fingeringForDWithCapo2.toString(), 'C');

    // Caso 2: Tono Concierto Ab Mayor con Capo 1 -> Digitación G (Sol Mayor)
    const concertAb = Chord.parse('Ab');
    const fingeringForAbWithCapo1 = CapoCalculator.calculateFingeringChord(
      concertAb,
      1,
      MusicalKey.G_MAJOR
    );
    assert.strictEqual(fingeringForAbWithCapo1.root.toString(), 'G');
    assert.strictEqual(fingeringForAbWithCapo1.toString(), 'G');

    // Caso 3: Tono Concierto B Mayor con Capo 4 -> Digitación G (Sol Mayor)
    const concertB = Chord.parse('B');
    const fingeringForBWithCapo4 = CapoCalculator.calculateFingeringChord(
      concertB,
      4,
      MusicalKey.G_MAJOR
    );
    assert.strictEqual(fingeringForBWithCapo4.root.toString(), 'G');
    assert.strictEqual(fingeringForBWithCapo4.toString(), 'G');
  });

  it('should maintain slash chords and qualities during capo calculations', () => {
    // Acorde de concierto D/F# con Capo 2 -> Digitación C/E
    const dOverFs = Chord.parse('D/F#');
    const fingering = CapoCalculator.calculateFingeringChord(
      dOverFs,
      2,
      MusicalKey.C_MAJOR
    );

    assert.strictEqual(fingering.root.toString(), 'C');
    assert.strictEqual(fingering.bass?.toString(), 'E');
    assert.strictEqual(fingering.toString(), 'C/E');

    // Al tocar C/E con Capo 2, debe sonar D/F#
    const sounding = CapoCalculator.calculateSoundingChord(
      fingering,
      2,
      MusicalKey.D_MAJOR
    );
    assert.strictEqual(sounding.root.toString(), 'D');
    assert.strictEqual(sounding.bass?.toString(), 'F#');
    assert.strictEqual(sounding.toString(), 'D/F#');
  });
});
