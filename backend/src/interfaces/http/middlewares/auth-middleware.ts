/**
 * @file auth-middleware.ts
 * @description Middlewares y guards de Fastify para Autenticación JWT HS256 y Control de Acceso Basado en Roles (RBAC).
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { JwtPayload, Permission, UserRole } from '../../../domain/auth-types.ts';
import { ROLE_PERMISSIONS } from '../../../domain/auth-types.ts';
import { UnauthorizedError, ForbiddenError } from '../../../domain/errors.ts';
import { JwtTokenService } from '../../../application/token-service.ts';
import type { IUserRepository } from '../../../repositories/user-repository.ts';

declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtPayload;
  }
}

export class AuthGuard {
  constructor(
    private tokenService: JwtTokenService,
    private userRepository: IUserRepository
  ) {}

  /**
   * Hook opcional/base de autenticación: extrae el token Bearer si existe y lo verifica.
   * Si no hay encabezado Authorization, no lanza excepción (permite rutas públicas o semipúblicas).
   */
  public authenticate = async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const authHeader = request.headers.authorization;
    let token: string | undefined;

    if (authHeader) {
      const parts = authHeader.split(' ');
      if (parts.length !== 2 || parts[0] !== 'Bearer') {
        throw new UnauthorizedError('Formato de encabezado de autorización inválido. Use "Bearer <token>".');
      }
      token = parts[1];
    }

    if (!token) {
      return;
    }

    const payload = this.tokenService.verifyAccessToken(token);
    request.user = payload;
  };

  /**
   * Valida estado de cuenta, bloqueo y tokenVersion en tiempo real contra BD para mitigar tokens revocados.
   */
  private validateDbSessionState(
    dbUser: Awaited<ReturnType<IUserRepository['findById']>>,
    tokenPayload: JwtPayload,
    options: { allowMustChangePassword: boolean }
  ): NonNullable<Awaited<ReturnType<IUserRepository['findById']>>> {
    if (!dbUser) {
      throw new UnauthorizedError('Usuario no encontrado o dado de baja en la base de datos.');
    }

    if (
      tokenPayload.tokenVersion !== undefined &&
      dbUser.tokenVersion !== tokenPayload.tokenVersion
    ) {
      throw new UnauthorizedError('Token revocado por cambio de seguridad en la cuenta.');
    }

    if (
      dbUser.accountStatus === 'SUSPENDED' ||
      dbUser.accountStatus === 'LOCKED' ||
      dbUser.accountStatus === 'PENDING_INVITATION'
    ) {
      throw new ForbiddenError(
        `Su cuenta se encuentra en estado '${dbUser.accountStatus}'. Operación denegada.`
      );
    }

    if (!options.allowMustChangePassword && dbUser.accountStatus !== 'ACTIVE') {
      throw new ForbiddenError(
        `Su cuenta se encuentra en estado '${dbUser.accountStatus}'. Operación denegada.`
      );
    }

    if (dbUser.lockoutUntil && dbUser.lockoutUntil.getTime() > Date.now()) {
      throw new ForbiddenError('La cuenta se encuentra temporalmente bloqueada por seguridad.');
    }

    return dbUser;
  }

  private async ensureJwtAuthenticated(request: FastifyRequest, reply: FastifyReply): Promise<JwtPayload> {
    if (!request.user) {
      await this.authenticate(request, reply);
      if (!request.user) {
        throw new UnauthorizedError('Autenticación requerida para acceder a este recurso.');
      }
    }
    return request.user;
  }

  /**
   * Guard que exige que el usuario esté autenticado y valida estado de cuenta y tokenVersion.
   */
  public requireAuth = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = await this.ensureJwtAuthenticated(request, reply);
    const dbUser = await this.userRepository.findById(user.sub);
    this.validateDbSessionState(dbUser, user, { allowMustChangePassword: true });
  };

  /**
   * Guard que valida si el usuario posee un permiso específico (RBAC).
   * @param permission Permiso requerido
   * @param verifyDatabaseRole Si es true, valida en tiempo real el rol y tokenVersion contra la base de datos (para operaciones sensibles)
   */
  public requirePermission = (permission: Permission, verifyDatabaseRole = false) => {
    return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const user = await this.ensureJwtAuthenticated(request, reply);

      const tokenRole = user.role as UserRole;
      const allowedPermissions = ROLE_PERMISSIONS[tokenRole] || [];

      if (!allowedPermissions.includes(permission)) {
        throw new ForbiddenError(
          `No tiene los permisos suficientes (${permission}) para ejecutar esta acción.`
        );
      }

      // Si la operación es sensible, verificar el estado, tokenVersion y rol autoritativo directo en la BD
      if (verifyDatabaseRole) {
        const rawDbUser = await this.userRepository.findById(user.sub);
        const dbUser = this.validateDbSessionState(rawDbUser, user, {
          allowMustChangePassword: false,
        });

        const currentDbPermissions = ROLE_PERMISSIONS[dbUser.role as UserRole] || [];
        if (!currentDbPermissions.includes(permission)) {
          throw new ForbiddenError(
            `El rol actual en base de datos (${dbUser.role}) no autoriza el permiso requerido (${permission}).`
          );
        }
      }
    };
  };
}
