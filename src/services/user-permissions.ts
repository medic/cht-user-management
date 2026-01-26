import _ from 'lodash';

import { AuthError } from '../lib/authentication-error';

import { ADMIN_ROLES } from '../lib/cht-session';
export const REQUIRED_PERMISSIONS = [
  'can_create_people',
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

    const missingPermissions = REQUIRED_PERMISSIONS.filter(permission => {
      const rolesWithPermission = permissions[permission] || [];
      return _.intersection(userRoles, rolesWithPermission).length === 0;
    });

    if (missingPermissions.length > 0 ) {
      console.error(`User ${username} is missing permissions:`, missingPermissions);
      throw AuthError.MISSING_PERMISSIONS(username);
    }
  }
}
