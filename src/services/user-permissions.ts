import _ from 'lodash';
import { Config } from '../config';

import { ADMIN_ROLES } from '../lib/cht-session';

export class UserPermissionService {
  public static validateUserPermissions(userDoc: any, username: string, permissions: any): void {
    const userRoles = userDoc?.roles || [];

    if (_.intersection(ADMIN_ROLES, userRoles).length > 0) {
      return;
    }

    const REQUIRED_PERMISSIONS = Config.getRequiredPermissions();

    const hasAllRequiredPermissions = REQUIRED_PERMISSIONS.every(permission => {
      const rolesWithPermission = permissions[permission] || [];
      return _.intersection(userRoles, rolesWithPermission).length > 0;
    });

    if (!hasAllRequiredPermissions) {
      throw new Error(`User ${username} role does not have the required permissions`);
    }
  }
}
