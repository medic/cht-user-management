import { Config } from '../config';
import { SupersetApi } from '../lib/superset-api';
import Place from './place';
import { UserPayload } from './user-payload';

export class UploadSuperset {
  private readonly supersetApi: SupersetApi;

  constructor(supersetApi: SupersetApi) {
    this.supersetApi = supersetApi;
  }

  // Fetch role template, create role, and copy its permissions
  private async createRoleAndCopyPermissions(place: Place): Promise<string> {
    const supersetConfig = Config.getSupersetConfig(place.type)!;
    
    // 1. Create a new role based on the template
    const newRoleId = await this.supersetApi.createRole(
      supersetConfig.prefix, place.name
    );

    // 2. Get permissions of the template role
    const templatePermissions = await this.supersetApi.getPermissionsByRoleID(supersetConfig.role_template);

    // 3. Assign the template permissions to the newly created role
    await this.supersetApi.assignPermissionsToRole(newRoleId, templatePermissions);

    return newRoleId;
  }

  // Fetch RLS template, create RLS for the role, and copy its datasets
  private async createRowLevelSecurityForRole(place: Place, roleId: string): Promise<void> {
    const supersetConfig = Config.getSupersetConfig(place.type)!;

    // 1. Fetch datasets associated with the RLS template
    const templateTables = await this.supersetApi.getTablesByRlsID(supersetConfig.rls_template);

    // 2. Extract the table IDs (array of strings) from the objects
    const tableIds = templateTables.map(table => table.id);

    // 3. Create row-level security for the new role
    await this.supersetApi.createRowLevelSecurityFromTemplate(
      roleId, place.name, supersetConfig.rls_group_key, supersetConfig.prefix, tableIds
    );
  }

  // Create a user in Superset and assign the new role
  private async createUserAndAssignRole(place: Place, roleId: string): Promise<{ username: string;  password: string}> {
    const userPayload = new UserPayload(place, 'place_id', 'contact_id');
    const supersetUserPayload = userPayload.toSupersetUserPayload([roleId]);

    // Create the user with the new role
    await this.supersetApi.createUser(supersetUserPayload);
    return { username: userPayload.username, password: userPayload.password };
  }

  // Handle the full Superset upload process
  async handlePlace(place: Place): Promise<{ username: string; password: string}> {
    try {
      if (!Config.getSupersetConfig(place.type)) {
        throw new Error(`Superset integration is not enabled for place: ${place.properties.name}`);
      }

      if (!place.contact.properties.email) {
        throw new Error(`Email is required for Superset integration, but is missing for place: ${place.properties.name}`);
      }

      // Step 1: Create the role and assign permissions
      const roleId = await this.createRoleAndCopyPermissions(place);

      // Step 2: Create row-level security for the new role
      await this.createRowLevelSecurityForRole(place, roleId);

      // Step 3: Create the user and assign the role
      const response = await this.createUserAndAssignRole(place, roleId);

      return response;
    } catch (error) {
      console.error(`Error uploading to Superset for place: ${place.properties.name}`, error);
      throw error;
    }
  }
}
