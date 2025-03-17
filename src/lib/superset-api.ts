import { AxiosError } from 'axios';
import { 
  SupersetRole, 
  SupersetRls, 
  SupersetUserPayload,
  SupersetTable
} from '../services/superset-payload';
import SupersetSession from './superset-session';

// Centralize API endpoints for better maintainability
const ENDPOINTS = {
  ROLES: '/security/roles/',
  PERMISSIONS: (roleId: string) => `/security/roles/${roleId}/permissions`,
  RLS: '/rowlevelsecurity/',
  RLS_BY_ID: (rlsId: string) => `/rowlevelsecurity/${rlsId}`,
  USERS: '/security/users/',
} as const;

export class SupersetApi {
  constructor(private readonly session: SupersetSession) {}

  /**
   * Creates a new role in Superset
   * @param prefix level prefix for the role name
   * @param roleName Base name for the role
   * @returns ID of the created role
   */
  async createRole(prefix: string, roleName: string): Promise<string> {
    try {
      const rolePayload: SupersetRole = {
        name: `${prefix}_${roleName}`.replace(/\s+/g, '_').toUpperCase(),
      };

      const response = await this.session.axiosInstance.post(
        ENDPOINTS.ROLES,
        rolePayload
      );
      return response.data.id;
    } catch (error) {
      throw this.handleError(error, `create role '${roleName}'`);
    }
  }

  /**
   * Gets permissions associated with a role
   * @param roleId ID of the role
   * @returns Array of permission IDs
   */
  async getPermissionsByRoleID(roleId: string): Promise<string[]> {
    try {
      const response = await this.session.axiosInstance.get(
        `${ENDPOINTS.PERMISSIONS(roleId)}/`
      );
      return response.data.result.map((permission: { id: string }) => permission.id);
    } catch (error) {
      throw this.handleError(error, `get permissions for role '${roleId}'`);
    }
  }

  /**
   * Assigns permissions to a role
   * @param roleId ID of the role
   * @param permissionIds Array of permission IDs to assign
   */
  async assignPermissionsToRole(roleId: string, permissionIds: string[]): Promise<void> {
    try {
      await this.session.axiosInstance.post(
        ENDPOINTS.PERMISSIONS(roleId),
        { permission_view_menu_ids: permissionIds }
      );
    } catch (error) {
      throw this.handleError(error, `assign permissions to role '${roleId}'`);
    }
  }

  /**
   * Gets tables associated with a RLS rule
   * @param rlsId ID of the RLS rule
   * @returns Array of table information
   */
  async getTablesByRlsID(rlsId: string): Promise<SupersetTable[]> {
    try {
      const response = await this.session.axiosInstance.get(
        ENDPOINTS.RLS_BY_ID(rlsId)
      );
      return response.data.result.tables;
    } catch (error) {
      throw this.handleError(error, `get tables for RLS '${rlsId}'`);
    }
  }

  /**
   * Creates a new RLS rule based on a template
   * @param roleId ID of the role to associate with the RLS
   * @param placeName Name of the place for filtering
   * @param groupKey Key used for RLS grouping
   * @param prefix level prefix for the RLS name
   * @param tableIds Array of table IDs to apply RLS to
   */
  async createRowLevelSecurityFromTemplate(
    roleId: string,
    placeName: string,
    groupKey: string,
    prefix: string,
    tableIds: string[]
  ): Promise<void> {
    try {
      const rlsPayload: SupersetRls = {
        clause: `${groupKey}='${placeName}'`,
        filter_type: 'Regular',
        group_key: groupKey,
        name: `${prefix}_${placeName}`.replace(/\s+/g, '_').toUpperCase(),
        roles: [roleId],
        tables: tableIds,
      };

      await this.session.axiosInstance.post(ENDPOINTS.RLS, rlsPayload);
    } catch (error) {
      throw this.handleError(error, `create RLS for place '${placeName}'`);
    }
  }

  /**
   * Creates a new user in Superset
   * @param userPayload User information
   */
  async createUser(userPayload: SupersetUserPayload): Promise<void> {
    try {
      await this.session.axiosInstance.post(ENDPOINTS.USERS, userPayload);
    } catch (error) {
      throw this.handleError(error, `create user '${userPayload.username}'`);
    }
  }

  /**
   * Handles API errors with context
   * @param error The caught error
   * @param operation Description of the failed operation
   * @returns A new error with context
   */
  private handleError(error: unknown, operation: string): Error {
    if (error instanceof AxiosError && error.response) {
      const { status, data } = error.response;
      return new Error(
        `Failed to ${operation} (${status}): ${data.message || error.message}`
      );
    }
    return new Error(
      `Failed to ${operation}: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

