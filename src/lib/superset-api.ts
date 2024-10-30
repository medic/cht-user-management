import { AxiosInstance } from 'axios';
import { SupersetRole, SupersetRls, SupersetUserPayload } from '../services/supertset-payload';
import { SupersetSession } from './superset-session';

export class SupersetApi {
  private axiosInstance: AxiosInstance;

  constructor(private session: SupersetSession) {
    this.axiosInstance = session.axiosInstance; // Use the same axios instance with headers set
  }

  // Method to create a new role
  async createRole(prefix: string, roleName: string): Promise<string> {
    const url = `/security/roles/`;
    const rolePayload: SupersetRole = {
      name: `${prefix}_${roleName}`.replace(/\s+/g, '_').toUpperCase(),
    };
    const response = await this.axiosInstance.post(url, rolePayload);
    console.log('axios.post', url);
    return response.data.id;
  }

  // Method to assign permissions to a role
  async assignPermissionsToRole(roleId: string, permissionIds: string[]): Promise<void> {
    const url = `/security/roles/${roleId}/permissions`;
    await this.axiosInstance.post(url, { permission_view_menu_ids: permissionIds });
    console.log('axios.post', url);
  }

  // Method to fetch permissions by Role ID
  async getPermissionsByRoleID(roleId: string): Promise<string[]> {
    const url = `/security/roles/${roleId}/permissions/`;
    const response = await this.axiosInstance.get(url);
    console.log('axios.get', url);
    return response.data.result.map((permission: { id: string }) => permission.id);
  }

  // Method to create row-level security for a role
  async createRowLevelSecurityFromTemplate(
    roleId: string, placeName: string, groupKey:string, prefix: string, tableIds: string[]
  ): Promise<void> {
    const rlsPayload: SupersetRls = {
      clause: `${groupKey}='${placeName}'`,
      filter_type: 'Regular',
      group_key: groupKey,
      name: `${prefix}_${placeName}`.replace(/\s+/g, '_').toUpperCase(),
      roles: [roleId],
      tables: tableIds,
    };

    const url = `/rowlevelsecurity/`;
    await this.axiosInstance.post(url, rlsPayload);
    console.log('axios.post', url);
  }

  // Method to fetch tables by RLS ID
  async getTablesByRlsID(rlsId: string): Promise<{ id: string }[]> {
    const url = `/rowlevelsecurity/${rlsId}`;
    const response = await this.axiosInstance.get(url);
    console.log('axios.get', url);
    return response.data.result.tables;
  }

  // Method to create a user in Superset
  async createUser(userPayload: SupersetUserPayload): Promise<void> {
    const url = `/security/users/`;
    await this.axiosInstance.post(url, userPayload);
    console.log('axios.post', url);
  }
}
