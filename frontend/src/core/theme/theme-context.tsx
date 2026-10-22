/**
 * @file theme-context.tsx
 * @description Proveedor de contexto para el sistema de temas (Light / Dark) de Bethesda Worship Studio.
 *
 * Características:
 * - Persistencia de preferencia en localStorage ('bethesda_theme').
 * - Detección automática del esquema del sistema mediante prefers-color-scheme cuando no hay preferencia guardada.
 * - Sincronización inmediata con el atributo data-theme en document.documentElement.
 * - Sincronización del meta tag theme-color para navegadores móviles.
 * - Libre de dependencias externas pesadas.
 */

import React, { createContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { THEME_STORAGE_KEY, type Theme, type ThemeContextType } from './types.ts';

export { THEME_STORAGE_KEY };

export const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';

  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
  } catch {
    // Si localStorage no está disponible (modo privado estricto), fallback a detección del sistema
  }

  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }

  return 'dark';
}

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  const applyThemeToDOM = useCallback((newTheme: Theme) => {
    if (typeof document === 'undefined') return;

    // Aplicar atributo data-theme en <html>
    document.documentElement.setAttribute('data-theme', newTheme);
    document.documentElement.style.colorScheme = newTheme;

    // Sincronizar meta theme-color para barras de estado de navegadores
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', newTheme === 'light' ? '#f8fafc' : '#090d16');
    }
  }, []);

  // Sincronizar en el montaje y ante cambios de tema
  useEffect(() => {
    applyThemeToDOM(theme);
  }, [theme, applyThemeToDOM]);

  // Escuchar cambios en el sistema si el usuario no ha forzado manualmente una preferencia
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
    const handleSystemChange = (e: MediaQueryListEvent) => {
      try {
        const userSaved = localStorage.getItem(THEME_STORAGE_KEY);
        if (!userSaved) {
          const sysTheme: Theme = e.matches ? 'light' : 'dark';
          setThemeState(sysTheme);
        }
      } catch {
        // Fallback transparente
      }
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleSystemChange);
      return () => mediaQuery.removeEventListener('change', handleSystemChange);
    }
  }, []);

  const setTheme = useCallback(
    (newTheme: Theme) => {
      setThemeState(newTheme);
      try {
        localStorage.setItem(THEME_STORAGE_KEY, newTheme);
      } catch {
        // Ignorar fallo de almacenamiento
      }
      applyThemeToDOM(newTheme);
    },
    [applyThemeToDOM]
  );

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  const value: ThemeContextType = {
    theme,
    isLight: theme === 'light',
    isDark: theme === 'dark',
    toggleTheme,
    setTheme,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};
