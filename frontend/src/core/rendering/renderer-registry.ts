/**
 * @file renderer-registry.ts
 * @description Registro y fábrica de adaptadores de renderizado (Fase 1E).
 * Permite a la capa de aplicación seleccionar dinámicamente el motor de renderizado
 * óptimo según las representaciones visuales solicitadas por el músico.
 */

import { type ViewRepresentation } from '../projection/types.ts';
import { AlphaTabAdapter } from './adapters/alphatab-adapter.ts';
import { LeadSheetDomAdapter } from './adapters/leadsheet-dom-adapter.ts';
import { OsmdAdapter } from './adapters/osmd-adapter.ts';
import { type IMusicRenderer } from './renderer-contract.ts';
import { type RendererId } from './types.ts';

export class RendererRegistry {
  private readonly renderers = new Map<RendererId, IMusicRenderer>();

  public constructor() {
    this.registerDefaults();
  }

  public register(renderer: IMusicRenderer): void {
    this.renderers.set(renderer.id, renderer);
  }

  public get(id: RendererId): IMusicRenderer | undefined {
    return this.renderers.get(id);
  }

  public getOrThrow(id: RendererId): IMusicRenderer {
    const renderer = this.renderers.get(id);
    if (!renderer) {
      throw new Error(`Adaptador de renderizado no registrado: "${id}"`);
    }
    return renderer;
  }

  public getAll(): IMusicRenderer[] {
    return Array.from(this.renderers.values());
  }

  /**
   * Obtiene todos los renderizadores que pueden satisfacer las representaciones solicitadas.
   */
  public getCompatibleRenderers(requested: readonly ViewRepresentation[]): IMusicRenderer[] {
    return this.getAll().filter((r) => r.capabilities.canRender(requested));
  }

  /**
   * Selecciona el renderizador más idóneo según la jerarquía de capacidades:
   * 1. Si se solicita TABLATURE -> AlphaTab (soporte nativo de cuerdas y digitación).
   * 2. Si se solicita GRAND_STAFF -> OSMD (soporte nativo de gran pentagrama de piano/teclado).
   * 3. Si solo se solicitan CHORDS/LYRICS/SECTION_MARKERS (sin pentagramas) -> LeadSheetDOM (ultra-liviano).
   * 4. Si se solicita STANDARD_NOTATION -> AlphaTab o OSMD.
   */
  public selectBestRenderer(requested: readonly ViewRepresentation[]): IMusicRenderer | undefined {
    if (requested.length === 0) {
      return undefined;
    }

    if (requested.includes('TABLATURE')) {
      const alphaTab = this.get('ALPHATAB');
      if (alphaTab && alphaTab.capabilities.canRender(requested)) {
        return alphaTab;
      }
    }

    if (requested.includes('GRAND_STAFF')) {
      const osmd = this.get('OSMD');
      if (osmd && osmd.capabilities.canRender(requested)) {
        return osmd;
      }
    }

    const hasNotation = requested.includes('STANDARD_NOTATION') || requested.includes('PERCUSSION_NOTATION');
    const isChordsLyricsOnly = requested.every((r) =>
      ['CHORDS', 'LYRICS', 'SECTION_MARKERS'].includes(r)
    );

    if (isChordsLyricsOnly) {
      const leadSheet = this.get('LEADSHEET_DOM');
      if (leadSheet && leadSheet.capabilities.canRender(requested)) {
        return leadSheet;
      }
    }

    if (hasNotation) {
      // Preferir AlphaTab para instrumentos de guitarra/bajo o OSMD para viento/madera
      const alphaTab = this.get('ALPHATAB');
      if (alphaTab && alphaTab.capabilities.canRender(requested)) {
        return alphaTab;
      }
      const osmd = this.get('OSMD');
      if (osmd && osmd.capabilities.canRender(requested)) {
        return osmd;
      }
    }

    // Fallback al primer compatible
    const compatibles = this.getCompatibleRenderers(requested);
    return compatibles[0];
  }

  /**
   * Fábrica de instancias frescas para cada objetivo de renderizado o componente React.
   * Evita fugas y estados DISPOSED residuales en multi-vista o re-montaje de componentes.
   */
  public createRenderer(id: RendererId): IMusicRenderer {
    switch (id) {
      case 'ALPHATAB':
        return new AlphaTabAdapter();
      case 'OSMD':
        return new OsmdAdapter();
      case 'LEADSHEET_DOM':
        return new LeadSheetDomAdapter();
      default:
        throw new Error(`Adaptador de renderizado desconocido: "${id}"`);
    }
  }

  /**
   * Instancia un renderizador nuevo compatible con las representaciones solicitadas.
   */
  public createBestRenderer(requested: readonly ViewRepresentation[]): IMusicRenderer | undefined {
    const template = this.selectBestRenderer(requested);
    if (!template) {
      return undefined;
    }
    return this.createRenderer(template.id);
  }

  private registerDefaults(): void {
    this.register(new AlphaTabAdapter());
    this.register(new OsmdAdapter());
    this.register(new LeadSheetDomAdapter());
  }
}
