import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';

const STAFF_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'FINANCE_MANAGER',
  'KYC_OFFICER',
  'LOAN_OFFICER',
  'SUPPORT_AGENT',
  'AUDITOR',
];

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const req = context.switchToHttp().getRequest();
    const user = req?.user;
    const controllerName = context.getClass()?.name || '';
    const reqPath: string = req?.path || req?.url || '';
    const isAdminRoute =
      controllerName === 'AdminController' ||
      reqPath.startsWith('/api/v1/admin') ||
      reqPath.startsWith('/admin');

    const userRoles: string[] = Array.isArray(user?.roles)
      ? user.roles
      : user?.role
      ? [user.role]
      : [];

    if (isAdminRoute) {
      if (!user) {
        throw new ForbiddenException('AUTH_REQUIRED');
      }
      const hasStaffRole = userRoles.some((r) => STAFF_ROLES.includes(r));
      if (!hasStaffRole) {
        throw new ForbiddenException('Staff administrative privileges required');
      }
    }

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    if (!user) {
      throw new ForbiddenException('AUTH_REQUIRED');
    }

    // Super Admin and Admin have universal access
    if (userRoles.includes('SUPER_ADMIN') || userRoles.includes('ADMIN')) {
      return true;
    }

    const userPermissions: string[] = user.permissions || [];
    const normalizedUserPerms = userPermissions.map((p) => p.replace(/:/g, '.'));

    const hasPermission = requiredPermissions.every((permission) => {
      const normReq = permission.replace(/:/g, '.');
      return normalizedUserPerms.includes(normReq);
    });

    if (!hasPermission) {
      throw new ForbiddenException('PERMISSION_DENIED');
    }

    return true;
  }
}

