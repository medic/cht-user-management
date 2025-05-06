import { Config } from '../config';
import { SupersetApi } from '../lib/superset-api';
import Place from './place';
import { SupersetUserPayloadBuilder } from './superset-payload';

export class UploadSuperset {
  constructor(private readonly supersetApi: SupersetApi) {}

  /**
   * Handles the complete Superset integration process for a place
   * @param place The place to create in Superset
   * @returns Object containing the created user's credentials and ID
   * @throws Error if any step of the integration fails
   */
  async handlePlace(place: Place): Promise<{ username: string; password: string; supersetUserId: number }> {
    this.validatePlaceForSuperset(place);

    try {
      // Step 1: Create role and assign permissions
      const roleId = await this.createRoleWithPermissions(place);

      // Step 2: Set up row-level security
      await this.setupRowLevelSecurity(place, roleId);

      // Step 3: Create user with the configured role
      const supersetUserPayload = SupersetUserPayloadBuilder.fromPlace(place, [roleId]);
      const response = await this.supersetApi.createUser(supersetUserPayload);
      
      return {
        username: supersetUserPayload.username,
        password: supersetUserPayload.password,
        supersetUserId: response.id
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(
        `Failed to set up Superset for place '${place.name}': ${errorMessage}`
      );
    }
  }

  /**
   * Handles the complete Superset integration process for multiple places sharing the same user
   * @param places Array of places to create in Superset
   * @throws Error if any step of the integration fails
   */
  async handleGroup(places: Place[]): Promise<void> {
    if (!places.length) {
      throw new Error('No places provided for group creation');
    }

    // Get shared credentials and Superset user ID from the first place
    const { username, password, supersetUserId } = places[0].creationDetails;
    if (!username || !password || !supersetUserId) {
      throw new Error('Cannot update Superset user without CHT credentials and Superset user ID');
    }

    try {
      // Skip first place as it's already handled in uploadSinglePlace
      const remainingPlaces = places.slice(1);
      
      // Step 1: Create roles and set up RLS for remaining places
      const roleIds = await Promise.all(
        remainingPlaces.map(async place => {
          this.validatePlaceForSuperset(place);
          const roleId = await this.createRoleWithPermissions(place);
          await this.setupRowLevelSecurity(place, roleId);
          return roleId;
        })
      );

      // Step 2: Update existing user with new roles
      await this.supersetApi.updateUser(supersetUserId, {
        roles: [...places[0].creationDetails.supersetRoles || [], ...roleIds]
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(
        `Failed to set up Superset for group of places: ${errorMessage}`
      );
    }
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
}
