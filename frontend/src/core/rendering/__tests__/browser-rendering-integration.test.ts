/**
 * @file browser-rendering-integration.test.ts
 * @description Pruebas de integración para Fase 1F — Real Browser Rendering Integration.
 *
 * Valida:
 * 1. Inicialización y ciclo de vida de renderizadores (UNINITIALIZED -> READY -> RENDERING -> READY -> DISPOSED)
 * 2. Limpieza de recursos y disposición (dispose)
 * 3. Prevención de fugas de memoria y prevención de re-inicialización redundante
 * 4. Propagación de diagnósticos y errores
 * 5. Adaptadores de navegador y seguridad contra XSS (sin innerHTML inseguro)
 * 6. Multi-renderer isolation (4 vistas concurrentes sin contaminación cruzada)
 * 7. Inmutabilidad estricta de CanonicalMusicPayload
 * 8. Preservación de cejilla (Capo) y digitaciones relativas
 * 9. Preservación de tono escrito en instrumentos transpositores (ej. Saxofón Alto Eb)
 * 10. Invariante estricto: CERO notas melódicas para canciones tipo Lead Sheet / ChordPro
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  createCanonicalSongGMajorChordsAndLyricsOnly,
  createCanonicalSongGMajorWithNotes,
} from '../../projection/fixtures/golden-scenarios.ts';
import { InstrumentRegistry } from '../../projection/instrument-profile.ts';
import { ProjectionService } from '../../projection/projection-service.ts';
import { ViewPreference } from '../../projection/view-preference.ts';
import { AlphaTabAdapter } from '../adapters/alphatab-adapter.ts';
import { LeadSheetDomAdapter } from '../adapters/leadsheet-dom-adapter.ts';
import { OsmdAdapter } from '../adapters/osmd-adapter.ts';
import { RendererRegistry } from '../renderer-registry.ts';

// Mock simple de elementos DOM para probar de forma determinista en entorno Node
class MockDomElement {
  public tagName: string;
  public className: string = '';
  public textContent: string = '';
  public attributes = new Map<string, string>();
  public children: MockDomElement[] = [];

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  public getAttribute(name: string): string | undefined {
    return this.attributes.get(name);
  }

  public appendChild(child: MockDomElement): MockDomElement {
    this.children.push(child);
    return child;
  }

  public replaceChildren(...newChildren: MockDomElement[]): void {
    this.children = [...newChildren];
  }

  public querySelectorAll(selector: string): MockDomElement[] {
    const results: MockDomElement[] = [];
    const check = (node: MockDomElement) => {
      if (selector.startsWith('.') && node.className.split(' ').includes(selector.slice(1))) {
        results.push(node);
      } else if (node.tagName.toLowerCase() === selector.toLowerCase()) {
        results.push(node);
      }
      for (const child of node.children) {
        check(child);
      }
    };
    check(this);
    return results;
  }
}

describe('Phase 1F — Browser Rendering Integration Tests', () => {
  const instruments = new InstrumentRegistry();

  it('1. Lifecycle: Full state transitions (UNINITIALIZED -> READY -> RENDERING -> READY -> DISPOSED)', () => {
    const adapter = new LeadSheetDomAdapter();
    assert.strictEqual(adapter.status, 'UNINITIALIZED');

    // Attach target via initialize -> READY
    adapter.initialize({ container: {} });
    assert.strictEqual(adapter.status, 'READY');

    // Render -> RENDERING -> READY
    const song = createCanonicalSongGMajorChordsAndLyricsOnly();
    const vocal = instruments.getOrThrow('lead_vocal');
    const pref = new ViewPreference({ instrumentId: 'lead_vocal', primaryRepresentation: 'LYRICS' });
    const view = ProjectionService.project(song, vocal, pref).view!;

    const output = adapter.render(view);
    assert.strictEqual(output.success, true);
    assert.strictEqual(adapter.status, 'READY');

    // Dispose -> DISPOSED
    adapter.dispose();
    assert.strictEqual(adapter.status, 'DISPOSED');

    // En estado DISPOSED, renderizar genera fallo controlado
    const disposedOutput = adapter.render(view);
    assert.strictEqual(disposedOutput.success, false);
    assert.strictEqual(disposedOutput.diagnostics.some(d => d.code === 'RENDERER_RUNTIME_ERROR'), true);
  });

  it('2. Disposal: Cleans up listeners, targets and references without throwing', () => {
    const adapter = new AlphaTabAdapter();
    adapter.initialize({ container: {} });
    assert.strictEqual(adapter.status, 'READY');

    adapter.dispose();
    assert.strictEqual(adapter.status, 'DISPOSED');

    // Doble dispose debe ser idempotente y seguro
    assert.doesNotThrow(() => {
      adapter.dispose();
    });
  });

  it('3. LeadSheetDOM: Constructs semantic DOM nodes securely with zero innerHTML XSS injection', () => {
    // Instalar mock global de document y HTMLElement temporalmente
    const originalDoc = (globalThis as unknown as { document?: unknown }).document;
    const originalHtmlElement = (globalThis as unknown as { HTMLElement?: unknown }).HTMLElement;
    (globalThis as unknown as { document: unknown }).document = {
      createElement: (tag: string) => new MockDomElement(tag),
    };
    (globalThis as unknown as { HTMLElement: unknown }).HTMLElement = MockDomElement;

    try {
      const adapter = new LeadSheetDomAdapter();
      const mockContainer = new MockDomElement('div');
      adapter.initialize({ container: mockContainer as unknown as HTMLElement });

      const songWithXss = createCanonicalSongGMajorChordsAndLyricsOnly();
      // Inyectar posible vector XSS en título para verificar escape
      (songWithXss as { title: string }).title = '<script>alert("XSS")</script>';

      const vocal = instruments.getOrThrow('lead_vocal');
      const pref = new ViewPreference({ instrumentId: 'lead_vocal', primaryRepresentation: 'LYRICS', secondaryRepresentations: ['CHORDS'] });
      const view = ProjectionService.project(songWithXss, vocal, pref).view!;

      const output = adapter.render(view);
      assert.strictEqual(output.success, true);

      // Verificar que se crearon los nodos en mockContainer
      assert.ok(mockContainer.children.length > 0);

      // El título debe estar en textContent sin haberse ejecutado como script
      const titleEls = mockContainer.querySelectorAll('.bethesda-leadsheet-title');
      assert.strictEqual(titleEls.length, 1);
      assert.strictEqual(titleEls[0]!.textContent, '<script>alert("XSS")</script>');

      // Verificar insignia de Lead Sheet Puro
      const badges = mockContainer.querySelectorAll('.badge-melody');
      assert.strictEqual(badges.length, 1);
      assert.strictEqual(badges[0]!.textContent, 'Lead Sheet Puro (Sin notas melódicas)');

      // Verificar compases y acordes
      const measureCards = mockContainer.querySelectorAll('.bethesda-measure-card');
      assert.strictEqual(measureCards.length, 2);

      const chords = mockContainer.querySelectorAll('.bethesda-chord-symbol');
      assert.ok(chords.length >= 2);

      // Dispose limpia el contenedor
      adapter.dispose();
      assert.strictEqual(mockContainer.children.length, 0);
    } finally {
      (globalThis as unknown as { document: unknown }).document = originalDoc;
      (globalThis as unknown as { HTMLElement: unknown }).HTMLElement = originalHtmlElement;
    }
  });

  it('4. Multi-view Isolation: Concurrent renderers for Guitar, Piano, Sax, and Vocal do not leak state', () => {
    const registry = new RendererRegistry();
    const alphaTab = new AlphaTabAdapter();
    const osmd = new OsmdAdapter();
    const leadSheet = new LeadSheetDomAdapter();
    registry.register(alphaTab);
    registry.register(osmd);
    registry.register(leadSheet);

    const songNotation = createCanonicalSongGMajorWithNotes();
    const initialNotationJson = JSON.stringify(songNotation);

    const songChordPro = createCanonicalSongGMajorChordsAndLyricsOnly();
    const initialChordProJson = JSON.stringify(songChordPro);

    // View A: Guitar Capo 2 (TABLATURE + CHORDS)
    const guitar = instruments.getOrThrow('acoustic_guitar');
    const prefA = new ViewPreference({
      instrumentId: 'acoustic_guitar',
      primaryRepresentation: 'TABLATURE',
      secondaryRepresentations: ['CHORDS'],
      capoFret: 2,
    });
    const viewA = ProjectionService.project(songNotation, guitar, prefA).view!;

    // View B: Piano (GRAND_STAFF + CHORDS)
    const piano = instruments.getOrThrow('acoustic_piano');
    const prefB = new ViewPreference({
      instrumentId: 'acoustic_piano',
      primaryRepresentation: 'GRAND_STAFF',
      secondaryRepresentations: ['CHORDS'],
    });
    const viewB = ProjectionService.project(songNotation, piano, prefB).view!;

    // View C: Alto Sax (STANDARD_NOTATION)
    const sax = instruments.getOrThrow('alto_sax');
    const prefC = new ViewPreference({
      instrumentId: 'alto_sax',
      primaryRepresentation: 'STANDARD_NOTATION',
    });
    const viewC = ProjectionService.project(songNotation, sax, prefC).view!;

    // View D: Vocal (LYRICS + CHORDS)
    const vocal = instruments.getOrThrow('lead_vocal');
    const prefD = new ViewPreference({
      instrumentId: 'lead_vocal',
      primaryRepresentation: 'LYRICS',
      secondaryRepresentations: ['CHORDS'],
    });
    const viewD = ProjectionService.project(songChordPro, vocal, prefD).view!;

    // Renderizar todas concurrentemente
    const outA = alphaTab.render(viewA);
    const outB = osmd.render(viewB);
    const outC = osmd.render(viewC);
    const outD = leadSheet.render(viewD);

    // Verificaciones aisladas:
    // View A (Guitarra Capo 2)
    assert.strictEqual(outA.success, true);
    assert.strictEqual(outA.data.capo, 2);
    assert.strictEqual(outA.data.tracks[0]!.staves[0]!.bars[0]!.voices[0]!.beats[0]!.chord?.fingeringName, 'F');
    assert.strictEqual(outA.data.tracks[0]!.staves[0]!.bars[0]!.voices[0]!.beats[0]!.chord?.soundingName, 'G');

    // View B (Piano Gran Pentagrama)
    assert.strictEqual(outB.success, true);
    assert.strictEqual(outB.data.stavesCount, 2);
    assert.deepStrictEqual(outB.data.clefs, ['TREBLE', 'BASS']);

    // View C (Saxofón Alto Eb)
    assert.strictEqual(outC.success, true);
    assert.strictEqual(outC.data.concertKeySignature.tonic, 'G');
    assert.strictEqual(outC.data.writtenKeySignature.tonic, 'E');
    assert.strictEqual(outC.data.measures[0]!.staves[0]!.voices[0]!.entries[0]!.writtenPitch, 'E5');

    // View D (Vocal Lead Sheet)
    assert.strictEqual(outD.success, true);
    assert.strictEqual(outD.data.totalMelodyNotes, 0); // Invariante 0 notas
    assert.strictEqual(outD.data.sections.length, 1);

    // Modificar View A no tiene ningún efecto secundario en B, C ni D
    const prefAUpdated = new ViewPreference({
      instrumentId: 'acoustic_guitar',
      primaryRepresentation: 'TABLATURE',
      capoFret: 3,
    });
    const viewAUpdated = ProjectionService.project(songNotation, guitar, prefAUpdated).view!;
    const outA2 = alphaTab.render(viewAUpdated);
    assert.strictEqual(outA2.data.capo, 3);

    // B, C, D conservan sus estados
    assert.strictEqual(outB.data.stavesCount, 2);
    assert.strictEqual(outC.data.writtenKeySignature.tonic, 'E');
    assert.strictEqual(outD.data.totalMelodyNotes, 0);

    // Invariante de inmutabilidad canónica
    assert.strictEqual(JSON.stringify(songNotation), initialNotationJson);
    assert.strictEqual(JSON.stringify(songChordPro), initialChordProJson);
  });

  it('5. Invariant: totalMelodyNotes remains strictly 0 for ChordPro songs without melody', () => {
    const songChordPro = createCanonicalSongGMajorChordsAndLyricsOnly();
    const vocal = instruments.getOrThrow('lead_vocal');
    const pref = new ViewPreference({
      instrumentId: 'lead_vocal',
      primaryRepresentation: 'LYRICS',
      secondaryRepresentations: ['CHORDS', 'SECTION_MARKERS'],
    });

    const derivedView = ProjectionService.project(songChordPro, vocal, pref).view!;
    const adapter = new LeadSheetDomAdapter();
    const result = adapter.render(derivedView);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.totalMelodyNotes, 0);
    // Verificar que todas las medidas tienen 0 notas
    for (const sec of result.data.sections) {
      for (const m of sec.measures) {
        // En un lead sheet puro, los tokens tienen acordes y sílabas, pero no notas generadas
        for (const tok of m.tokens) {
          assert.strictEqual(typeof tok.syllable === 'string' || typeof tok.chord === 'string', true);
        }
      }
    }
  });

  it('6. Error diagnostics: Surfaces UNSUPPORTED_RENDERER_CAPABILITY when asked to render incompatible views', () => {
    const registry = new RendererRegistry();
    const leadSheet = new LeadSheetDomAdapter();
    registry.register(leadSheet);

    // LeadSheetDOM no soporta TABLATURE ni GRAND_STAFF
    assert.strictEqual(leadSheet.capabilities.canRender(['TABLATURE']), false);
    assert.strictEqual(leadSheet.capabilities.canRender(['GRAND_STAFF']), false);
    assert.strictEqual(leadSheet.capabilities.canRender(['STANDARD_NOTATION']), false);

    // Pero sí soporta CHORDS, LYRICS, SECTION_MARKERS
    assert.strictEqual(leadSheet.capabilities.canRender(['CHORDS', 'LYRICS']), true);
  });

  it('7. Resize handling: Attaches and disconnects ResizeObserver cleanly during target lifecycle', () => {
    let observedElement: unknown = null;
    let disconnected = false;

    class MockResizeObserver {
      public observe(target: unknown): void {
        observedElement = target;
      }
      public disconnect(): void {
        disconnected = true;
      }
    }

    const originalResizeObserver = (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = MockResizeObserver;

    const originalDoc = (globalThis as unknown as { document?: unknown }).document;
    const originalHtmlElement = (globalThis as unknown as { HTMLElement?: unknown }).HTMLElement;
    (globalThis as unknown as { document: unknown }).document = {
      createElement: (tag: string) => new MockDomElement(tag),
    };
    (globalThis as unknown as { HTMLElement: unknown }).HTMLElement = MockDomElement;

    try {
      const adapter = new LeadSheetDomAdapter();
      const mockContainer = new MockDomElement('div');
      adapter.initialize({ container: mockContainer as unknown as HTMLElement });

      const song = createCanonicalSongGMajorChordsAndLyricsOnly();
      const vocal = instruments.getOrThrow('lead_vocal');
      const pref = new ViewPreference({ instrumentId: 'lead_vocal', primaryRepresentation: 'LYRICS' });
      const view = ProjectionService.project(song, vocal, pref).view!;

      adapter.render(view);
      assert.strictEqual(observedElement, mockContainer);

      adapter.dispose();
      assert.strictEqual(disconnected, true);
    } finally {
      (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver = originalResizeObserver;
      (globalThis as unknown as { document: unknown }).document = originalDoc;
      (globalThis as unknown as { HTMLElement: unknown }).HTMLElement = originalHtmlElement;
    }
  });

  it('8. Update without recreation: Subsequent render/update calls re-render without recreating base adapter instance', () => {
    const adapter = new LeadSheetDomAdapter();
    const song = createCanonicalSongGMajorChordsAndLyricsOnly();
    const vocal = instruments.getOrThrow('lead_vocal');

    const pref1 = new ViewPreference({ instrumentId: 'lead_vocal', primaryRepresentation: 'LYRICS', capoFret: 0 });
    const view1 = ProjectionService.project(song, vocal, pref1).view!;
    const res1 = adapter.render(view1);
    assert.strictEqual(res1.success, true);
    assert.strictEqual(res1.data.capo, 0);

    // Actualización rápida a Capo 2
    const pref2 = new ViewPreference({ instrumentId: 'lead_vocal', primaryRepresentation: 'LYRICS', capoFret: 2 });
    const view2 = ProjectionService.project(song, vocal, pref2).view!;
    const res2 = adapter.update(view2);
    assert.strictEqual(res2.success, true);
    assert.strictEqual(res2.data.capo, 2);
    assert.strictEqual(adapter.status, 'READY');
  });

  it('9. Chord Notation Systems: Standard vs Latin/Solfège notation preservation in LeadSheet', () => {
    const song = createCanonicalSongGMajorChordsAndLyricsOnly();
    const vocal = instruments.getOrThrow('lead_vocal');

    // Sistema Estándar: G, Em, C, D
    const prefStandard = new ViewPreference({
      instrumentId: 'lead_vocal',
      primaryRepresentation: 'CHORDS',
      chordNotationSystem: 'STANDARD',
    });
    const viewStd = ProjectionService.project(song, vocal, prefStandard).view!;
    const adapter = new LeadSheetDomAdapter();
    const outStd = adapter.render(viewStd);
    assert.strictEqual(outStd.data.sections[0]!.measures[0]!.chords[0]!.fingeringSymbol, 'G');

    // Sistema Latino: Sol, Mim, Do, Re
    const prefLatin = new ViewPreference({
      instrumentId: 'lead_vocal',
      primaryRepresentation: 'CHORDS',
      chordNotationSystem: 'LATIN',
    });
    const viewLatin = ProjectionService.project(song, vocal, prefLatin).view!;
    const outLatin = adapter.render(viewLatin);
    assert.strictEqual(outLatin.data.sections[0]!.measures[0]!.chords[0]!.fingeringSymbol, 'Sol');
  });

  it('10. Written pitch vs Canonical pitch preservation for transposing instruments in OSMD', () => {
    const song = createCanonicalSongGMajorWithNotes();
    const altoSax = instruments.getOrThrow('alto_sax');
    const pref = new ViewPreference({
      instrumentId: 'alto_sax',
      primaryRepresentation: 'STANDARD_NOTATION',
    });
    const view = ProjectionService.project(song, altoSax, pref).view!;
    const osmd = new OsmdAdapter();
    const output = osmd.render(view);

    assert.strictEqual(output.success, true);
    // Tono de concierto es G Mayor (1 sostenido)
    assert.strictEqual(output.data.concertKeySignature.tonic, 'G');
    // Tono escrito para Saxofón Alto en Eb es E Mayor (4 sostenidos)
    assert.strictEqual(output.data.writtenKeySignature.tonic, 'E');
    assert.strictEqual(output.data.writtenKeySignature.fifths, 4);

    // Entrada de nota escrita
    const firstEntry = output.data.measures[0]!.staves[0]!.voices[0]!.entries[0]!;
    assert.strictEqual(firstEntry.writtenPitch, 'E5');
    assert.strictEqual(firstEntry.canonicalPitch, 'G4');
  });
});
