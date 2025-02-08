import _ from 'lodash';

import { ADMIN_ROLES } from '../lib/cht-session';
const REQUIRED_PERMISSIONS = ['can_create_people'];

export class UserPermissionService {
  public static validateUserPermissions(userDoc: any, username: string, permissions: any): void {
    const userRoles = userDoc?.roles || [];

    if (_.intersection(ADMIN_ROLES, userRoles).length > 0) {
      return;
    }

    const hasAllRequiredPermissions = REQUIRED_PERMISSIONS.every(permission => {
      const rolesWithPermission = permissions[permission] || [];
      return _.intersection(userRoles, rolesWithPermission).length > 0;
    });

    if (!hasAllRequiredPermissions) {
      throw new Error(`User ${username} role does not have the required permissions`);
    }
  }
}
