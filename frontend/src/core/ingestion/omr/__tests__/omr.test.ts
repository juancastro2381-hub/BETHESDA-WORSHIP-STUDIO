/**
 * @file omr.test.ts
 * @description Suite de pruebas unitarias para el gestor de propuestas OMR en frontend (Fase 3C — D2).
 *
 * Cubre:
 * 1. Validación de propuesta OMR con preservación de isAiDraft=true.
 * 2. Rechazo de propuesta corrupta o sin condición de borrador de IA.
 * 3. Puerta de control: prohibición de commit canónico si no está en APPROVED_FOR_IMPORT.
 * 4. Reporte explícito de zonas dudosas sin invención de notas musicales.
 * 5. Verificación estricta: EXCLUSIÓN TOTAL de pedales físicos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { OmrProposalHandler } from '../omr-proposal-handler.ts';

describe('Workstream D — Phase 3C OMR Proposal Handler Suite (Frontend)', () => {
  const validProposalFixture = {
    proposalId: 'prop-uuid-999',
    sourceFilename: 'partitura_gracia.pdf',
    sourceHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    detectedTitle: 'Gracia Sublime Es',
    detectedKey: 'G',
    detectedBpm: 104,
    detectedTimeSignature: '4/4',
    overallConfidence: 0.88,
    isAiDraft: true,
    reviewStatus: 'PENDING_REVIEW',
    measures: [
      { measureNumber: 1, confidence: 0.92 },
      { measureNumber: 2, confidence: 0.89 },
    ],
    unrecognizedRegions: [
      { page: 1, reason: 'Compás 5 borroso por pliegue de hoja; omitido para revisión manual.' },
    ],
  };

  it('1. should validate incoming OMR proposal and enforce isAiDraft=true', () => {
    const validated = OmrProposalHandler.validateProposal(validProposalFixture);
    assert.equal(validated.proposalId, 'prop-uuid-999');
    assert.equal(validated.isAiDraft, true);
    assert.equal(validated.reviewStatus, 'PENDING_REVIEW');
    assert.equal(validated.measuresCount, 2);
    assert.equal(validated.unrecognizedCount, 1);
  });

  it('2. should reject proposal that violates isAiDraft invariant', () => {
    const badProposal = { ...validProposalFixture, isAiDraft: false };
    assert.throws(
      () => {
        OmrProposalHandler.validateProposal(badProposal);
      },
      /Violación de invariante: la propuesta OMR debe poseer isAiDraft=true/
    );
  });

  it('3. should enforce human review gate: canCommitToCanonical is false for PENDING_REVIEW and REJECTED', () => {
    const pending = OmrProposalHandler.validateProposal(validProposalFixture);
    assert.equal(OmrProposalHandler.canCommitToCanonical(pending), false);

    const rejected = OmrProposalHandler.validateProposal({
      ...validProposalFixture,
      reviewStatus: 'REJECTED',
    });
    assert.equal(OmrProposalHandler.canCommitToCanonical(rejected), false);

    const approved = OmrProposalHandler.validateProposal({
      ...validProposalFixture,
      reviewStatus: 'APPROVED_FOR_IMPORT',
    });
    assert.equal(OmrProposalHandler.canCommitToCanonical(approved), true);
  });

  it('4. should preserve unrecognized regions without fabricating musical data', () => {
    const validated = OmrProposalHandler.validateProposal(validProposalFixture);
    assert.equal(validated.unrecognizedRegions.length, 1);
    const region = validated.unrecognizedRegions[0];
    assert.ok(region);
    assert.ok(region.reason.includes('omitido para revisión manual'));
  });

  it('5. should strictly verify ZERO physical pedal code, APIs, or listeners exist', () => {
    const dir = path.resolve('src/core/ingestion/omr');
    const files = fs.readdirSync(dir);

    const forbiddenTerms = [
      'pedal',
      'bluetooth',
      'navigator.bluetooth',
      'navigator.usb',
      'navigator.hid',
      'gamepad',
      'PageUp',
      'PageDown',
    ];

    for (const file of files) {
      if (file.endsWith('.ts') || file.endsWith('.tsx')) {
        const content = fs.readFileSync(path.join(dir, file), 'utf8');
        for (const term of forbiddenTerms) {
          assert.equal(
            content.toLowerCase().includes(term.toLowerCase()),
            false,
            `Forbidden pedal term "${term}" found in ${file}`
          );
        }
      }
    }
  });
});
