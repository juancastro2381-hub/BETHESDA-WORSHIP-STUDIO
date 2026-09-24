/**
 * @file provenance-and-diagnostics.test.ts
 * @description Pruebas unitarias para ProvenanceManager y DiagnosticCollector.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { DiagnosticCollector } from '../diagnostics.ts';
import { ProvenanceManager } from '../provenance.ts';

describe('Provenance and Diagnostics Tests', () => {
  it('should compute deterministic hashes for source content', () => {
    const text1 = 'Score Content 123';
    const text2 = 'Score Content 123';
    const text3 = 'Different Score Content';

    const hash1 = ProvenanceManager.computeHash(text1);
    const hash2 = ProvenanceManager.computeHash(text2);
    const hash3 = ProvenanceManager.computeHash(text3);

    assert.strictEqual(hash1, hash2);
    assert.notStrictEqual(hash1, hash3);
    assert.strictEqual(hash1.length, 8); // Hexadecimal de 8 caracteres
  });

  it('should manage diagnostics severities and determine correct overall status', () => {
    const collector = new DiagnosticCollector();
    assert.strictEqual(collector.determineStatus(), 'SUCCESS');

    collector.addInfo('INFO_1', 'Info message', { lineNumber: 5 });
    assert.strictEqual(collector.determineStatus(), 'SUCCESS');

    collector.addWarning('WARN_1', 'Warning message', { measureNumber: 3, elementName: 'note' });
    assert.strictEqual(collector.determineStatus(), 'SUCCESS_WITH_WARNINGS');
    assert.strictEqual(collector.hasWarnings, true);
    assert.strictEqual(collector.hasErrors, false);

    collector.addError('ERR_1', 'Error message', { measureNumber: 3 });
    assert.strictEqual(collector.determineStatus(), 'FAILED');
    assert.strictEqual(collector.hasErrors, true);

    const all = collector.diagnostics;
    assert.strictEqual(all.length, 3);
    assert.strictEqual(all[1]?.location?.measureNumber, 3);
    assert.strictEqual(all[1]?.location?.elementName, 'note');
  });
});
