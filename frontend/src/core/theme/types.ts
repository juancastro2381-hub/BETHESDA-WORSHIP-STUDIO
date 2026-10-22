/**
 * @file types.ts
 * @description Tipos de datos para el sistema de temas (Light/Dark) de Bethesda Worship Studio.
 */

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'bethesda_theme';

export interface ThemeContextType {
  theme: Theme;
  isLight: boolean;
  isDark: boolean;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

