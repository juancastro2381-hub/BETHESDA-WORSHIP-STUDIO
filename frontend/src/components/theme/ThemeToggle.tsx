/**
 * @file ThemeToggle.tsx
 * @description Conmutador accesible de tema Light/Dark para la cabecera principal de Bethesda Worship Studio.
 */

import React from 'react';
import { useTheme } from '../../core/theme/use-theme.ts';

export const ThemeToggle: React.FC = () => {
  const { theme, toggleTheme, isDark } = useTheme();

  const label = isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
  const icon = isDark ? '☀️' : '🌙';
  const modeText = isDark ? 'Claro' : 'Oscuro';

  return (
    <button
      type="button"
      className="theme-toggle-button"
      onClick={toggleTheme}
      role="switch"
      aria-checked={isDark}
      aria-label={label}
      title={label}
      id="theme-toggle-btn"
    >
      <span className="theme-toggle-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="theme-toggle-text">Modo {modeText}</span>
    </button>
  );
};
