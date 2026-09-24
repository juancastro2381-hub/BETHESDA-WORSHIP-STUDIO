/**
 * @file use-auth.ts
 * @description Hook de conveniencia para acceder al contexto de autenticación y RBAC.
 */

import { useContext } from 'react';
import { AuthContext, type AuthContextType } from './auth-context.tsx';

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe ser utilizado dentro de un AuthProvider');
  }
  return context;
}
