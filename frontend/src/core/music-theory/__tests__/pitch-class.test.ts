import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PitchClass } from '../pitch-class.ts';

describe('PitchClass Core Domain Tests', () => {
  it('should correctly represent all 12 canonical pitch classes (0 to 11)', () => {
    assert.strictEqual(PitchClass.C.value, 0);
    assert.strictEqual(PitchClass.CS.value, 1);
    assert.strictEqual(PitchClass.DB.value, 1);
    assert.strictEqual(PitchClass.D.value, 2);
    assert.strictEqual(PitchClass.DS.value, 3);
    assert.strictEqual(PitchClass.EB.value, 3);
    assert.strictEqual(PitchClass.E.value, 4);
    assert.strictEqual(PitchClass.F.value, 5);
    assert.strictEqual(PitchClass.FS.value, 6);
    assert.strictEqual(PitchClass.GB.value, 6);
    assert.strictEqual(PitchClass.G.value, 7);
    assert.strictEqual(PitchClass.GS.value, 8);
    assert.strictEqual(PitchClass.AB.value, 8);
    assert.strictEqual(PitchClass.A.value, 9);
    assert.strictEqual(PitchClass.AS.value, 10);
    assert.strictEqual(PitchClass.BB.value, 10);
    assert.strictEqual(PitchClass.B.value, 11);
  });

  it('should perform addition modulo 12 correctly with overflow', () => {
    // B (11) + 1 = C (0)
    const bPlus1 = PitchClass.B.add(1);
    assert.strictEqual(bPlus1.value, 0);
    assert.strictEqual(bPlus1.equals(PitchClass.C), true);

    // G (7) + 7 = D (2)
    const gPlus7 = PitchClass.G.add(7);
    assert.strictEqual(gPlus7.value, 2);
    assert.strictEqual(gPlus7.equals(PitchClass.D), true);
  });

  it('should perform subtraction modulo 12 correctly with underflow (negative semitones)', () => {
    // C (0) - 1 = B (11)
    const cMinus1 = PitchClass.C.subtract(1);
    assert.strictEqual(cMinus1.value, 11);
    assert.strictEqual(cMinus1.equals(PitchClass.B), true);

    // C (0) + (-1) = B (11)
    const cPlusNeg1 = PitchClass.C.add(-1);
    assert.strictEqual(cPlusNeg1.value, 11);
    assert.strictEqual(cPlusNeg1.equals(PitchClass.B), true);

    // D (2) - 5 = A (9) (a fourth down from D is A)
    const dMinus5 = PitchClass.D.subtract(5);
    assert.strictEqual(dMinus5.value, 9);
    assert.strictEqual(dMinus5.equals(PitchClass.A), true);
  });

  it('should calculate directional semitone distance accurately', () => {
    // C (0) to G (7) = 7 semitones
    assert.strictEqual(PitchClass.C.semitonesTo(PitchClass.G), 7);

    // G (7) to C (0) = 5 semitones (clockwise)
    assert.strictEqual(PitchClass.G.semitonesTo(PitchClass.C), 5);

    // Shortest distance: G (7) to C (0) = -5 or +7 -> shortest is -5
    assert.strictEqual(PitchClass.G.shortestDistanceTo(PitchClass.C), 5);
    assert.strictEqual(PitchClass.C.shortestDistanceTo(PitchClass.B), -1);
  });

  it('should verify equality and normalization of large numbers', () => {
    assert.strictEqual(PitchClass.from(24).equals(PitchClass.C), true);
    assert.strictEqual(PitchClass.from(-12).equals(PitchClass.C), true);
    assert.strictEqual(PitchClass.from(-1).equals(PitchClass.B), true);
    assert.strictEqual(PitchClass.from(25).equals(PitchClass.CS), true);
  });
});
