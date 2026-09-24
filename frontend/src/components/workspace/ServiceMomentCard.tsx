/**
 * @file ServiceMomentCard.tsx
 * @description Tarjeta litúrgica para momentos del culto que no contienen partitura musical (Fase 2C — WS7).
 *
 * Responsabilidades:
 * - Representar ítems de tipo SERVICE_MOMENT (oración, bienvenida, ofrenda, prédica, ministración).
 * - PROHIBICIÓN ESTRICTA: NO inicializa adaptadores de partitura (alphaTab, OSMD, LeadSheetDOM).
 * - Mostrar título, duración estimada, tono base sugerido para Pad/acompañamiento, notas litúrgicas y notas de transición.
 * - Estética solemne y serena coherente con el lenguaje de diseño de Bethesda Worship Studio.
 * - Accesibilidad semántica (section role="region", encabezados estructurados).
 */

import React from 'react';
import type { FrontendSetlistItem } from '../../core/api/setlist-types.ts';

export interface ServiceMomentCardProps {
  readonly item: FrontendSetlistItem;
  readonly onNext?: (() => void) | undefined;
  readonly onPrevious?: (() => void) | undefined;
  readonly hasNext?: boolean | undefined;
  readonly hasPrevious?: boolean | undefined;
}

export const ServiceMomentCard: React.FC<ServiceMomentCardProps> = ({
  item,
  onNext,
  onPrevious,
  hasNext = false,
  hasPrevious = false,
}) => {
  const displayTitle = item.momentTitle || 'Momento Litúrgico';

  return (
    <section
      className="service-moment-card"
      role="region"
      aria-label={`Momento litúrgico: ${displayTitle}`}
    >
      <div className="service-moment-card-inner">
        {/* Cabecera Litúrgica */}
        <header className="service-moment-header">
          <div className="service-moment-symbol" aria-hidden="true">
            🕊️
          </div>
          <div className="service-moment-badge-row">
            <span className="liturgical-tag">Momento de Culto</span>
            {item.durationMinutes !== null && item.durationMinutes > 0 && (
              <span className="duration-tag">
                ⏱️ {item.durationMinutes} {item.durationMinutes === 1 ? 'minuto' : 'minutos'}
              </span>
            )}
            {item.musicalKey && (
              <span className="pad-key-tag">
                🎹 Pad / Tono: <strong>{item.musicalKey}</strong>
              </span>
            )}
          </div>
          <h2 className="service-moment-title">{displayTitle}</h2>
        </header>

        {/* Cuerpo de Indicaciones Pastorales */}
        <div className="service-moment-body">
          {item.notesForTeam ? (
            <div className="service-moment-notes-block">
              <h3 className="section-subtitle">
                <span aria-hidden="true">📖</span> Indicaciones Litúrgicas & Pastorales
              </h3>
              <p className="service-moment-notes-text">{item.notesForTeam}</p>
            </div>
          ) : (
            <div className="service-moment-empty-notes">
              <p>Tiempo de ministración, oración o palabra sin notas técnicas adicionales.</p>
            </div>
          )}

          {/* Notas de Transición / Modulación */}
          {item.transitionType && (
            <div className="service-moment-transition-block" role="note">
              <h3 className="transition-subtitle">
                <span aria-hidden="true">🔄</span> Enlace con el Siguiente Ítem
              </h3>
              <p className="transition-notes-text">
                Tipo de transición: <strong>{item.transitionType}</strong>
              </p>
            </div>
          )}
        </div>

        {/* Controles Directos en Tarjeta (Opcionales para facilitar navegación) */}
        {(onPrevious || onNext) && (
          <footer className="service-moment-footer-nav">
            {onPrevious && (
              <button
                type="button"
                className="btn-card-nav"
                onClick={onPrevious}
                disabled={!hasPrevious}
                aria-label="Ítem anterior"
              >
                ◀ Anterior
              </button>
            )}
            <span className="service-moment-card-hint">
              Presione [Espacio] o [Flecha Derecha] para continuar
            </span>
            {onNext && (
              <button
                type="button"
                className="btn-card-nav primary"
                onClick={onNext}
                disabled={!hasNext}
                aria-label="Siguiente ítem"
              >
                Siguiente ▶
              </button>
            )}
          </footer>
        )}
      </div>
    </section>
  );
};
