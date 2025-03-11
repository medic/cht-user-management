import { Config } from '../config';
import { SupersetApi } from '../lib/superset-api';
import Place from './place';
import { UserPayload } from './user-payload';

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

  /**
   * Creates a role and copies permissions from template
   */
  private async createRoleWithPermissions(place: Place): Promise<string> {
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
  private async setupRowLevelSecurity(place: Place, roleId: string): Promise<void> {
    const supersetConfig = Config.getSupersetConfig(place.type)!;

    // Get template tables
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
    roleId: string
  ): Promise<{ username: string; password: string }> {
    const userPayload = new UserPayload(place, 'place_id', 'contact_id');
    const supersetUserPayload = userPayload.toSupersetUserPayload([roleId]);

    await this.supersetApi.createUser(supersetUserPayload);
    return {
      username: userPayload.username,
      password: userPayload.password,
    };
  }

  /**
   * Validates that a place meets all requirements for Superset integration
   * @throws Error if validation fails
   */
  private validatePlaceForSuperset(place: Place): void {
    if (!Config.getSupersetConfig(place.type)) {
      throw new Error(
        `Superset integration is not enabled for contact type: ${place.type.name}`
      );
    }

    if (!place.contact.properties.email?.formatted) {
      throw new Error(
        `Email is required for Superset integration but is missing for place: ${place.name}`
      );
    }

    if (!place.name) {
      throw new Error('Place name is required for Superset integration');
    }
  }
}
