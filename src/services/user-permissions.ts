import _ from 'lodash';

import { ADMIN_ROLES } from '../lib/cht-session';
export const REQUIRED_PERMISSIONS = [
  'can_create_people',
  'can_configure',
  'can_create_places',
  'can_create_users',
  'can_delete_contacts',
  'can_delete_users',
  'can_edit',
  'can_update_users',
  'can_view_contacts',
  'can_view_users'
];

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
