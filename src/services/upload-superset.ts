import { Config } from '../config';
import { SupersetApi } from '../lib/superset-api';
import Place from './place';
import { SupersetUserPayloadBuilder } from './superset-payload';

export class UploadSuperset {
  constructor(private readonly supersetApi: SupersetApi) {}

  /**
   * Handles the complete Superset integration process for a place
   * @param place The place to create in Superset
   * @returns Object containing the created user's credentials
   * @throws Error if any step of the integration fails
   */
  async handlePlace(place: Place): Promise<{ username: string; password: string }> {
    this.validatePlaceForSuperset(place);

    try {
      // Step 1: Create role and assign permissions
      const roleId = await this.createRoleWithPermissions(place);

      // Step 2: Set up row-level security
      await this.setupRowLevelSecurity(place, roleId);

      // Step 3: Create user with the configured role
      return await this.createUserWithRole(place, roleId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(
        `Failed to set up Superset for place '${place.name}': ${errorMessage}`
      );
    }
  }

  async handleGroup(places: Place[], username: string, password: string) {
    // Create roles for each place
    const roles = await Promise.all(
      places.map(async place => {
        const role = await this.createRoleForPlace(place);
        await this.setRlsForPlace(place);
        return role;
      })
    );

    // Create user with all roles
    await this.createUser(username, password, roles);
  }

  private validatePlaceForSuperset(place: Place) {
    if (!Config.getSupersetConfig(place.type)) {
      throw new Error(`Superset integration is not enabled for place: ${place.name}`);
    }

    if (!place.contact.properties.email) {
      throw new Error(`Email is required for Superset integration, but is missing for place: ${place.name}`);
    }

    if (!place.creationDetails.username || !place.creationDetails.password) {
      throw new Error(`Cannot create Superset user without CHT credentials for place: ${place.name}`);
    }

    if (!place.name) {
      throw new Error('Place name is required for Superset integration');
    }
  }

  /**
   * Creates a role and copies permissions from template
   */
  private async createRoleWithPermissions(place: Place): Promise<number> {
    const supersetConfig = Config.getSupersetConfig(place.type)!;
    
    // Create new role
    const newRoleId = await this.supersetApi.createRole(
      supersetConfig.prefix,
      place.name
    );

    // Get and assign template permissions
    const templatePermissions = await this.supersetApi.getPermissionsByRoleID(
      supersetConfig.role_template
    );
    await this.supersetApi.assignPermissionsToRole(newRoleId, templatePermissions);

    return newRoleId;
  }

  /**
   * Sets up row-level security for the role
   */
  private async setupRowLevelSecurity(place: Place, roleId: number): Promise<void> {
    const supersetConfig = Config.getSupersetConfig(place.type)!;

    // Get tables from template
    const templateTables = await this.supersetApi.getTablesByRlsID(
      supersetConfig.rls_template
    );
    const tableIds = templateTables.map(table => table.id);

    // Create RLS rule
    await this.supersetApi.createRowLevelSecurityFromTemplate(
      roleId,
      place.name,
      supersetConfig.rls_group_key,
      supersetConfig.prefix,
      tableIds
    );
  }

  /**
   * Creates a Superset user and assigns the role
   */
  private async createUserWithRole(
    place: Place,
    roleId: number
  ): Promise<{ username: string; password: string }> {
    const supersetUserPayload = SupersetUserPayloadBuilder.fromPlace(place, [roleId]);
    await this.supersetApi.createUser(supersetUserPayload);
    
    return {
      username: supersetUserPayload.username,
      password: supersetUserPayload.password
    };
  }
}
