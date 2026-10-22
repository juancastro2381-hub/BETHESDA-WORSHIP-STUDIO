/**
 * @file use-theme.ts
 * @description Hook de consumo del contexto de tema (Light/Dark).
 */

import { useContext } from 'react';
import { ThemeContext } from './theme-context.tsx';
import type { ThemeContextType } from './types.ts';

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme debe ser utilizado dentro de un ThemeProvider.');
  }
  return context;
}
