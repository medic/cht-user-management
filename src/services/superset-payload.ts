import Place from './place';


/**
 * Payload for creating a user in Superset
 */
export interface SupersetUserPayload {
  active: boolean;
  first_name: string;
  last_name: string;
  email: string;
  username: string;
  password: string;
  roles: string[];
}

/**
 * Superset role definition
 * Format: PREFIX_NAME (e.g., "CHA_ROLE_NAME")
 */
export interface SupersetRole {
  name: string;
}

/**
 * Superset row-level security rule
 */
export interface SupersetRls {
  clause: string;
  filter_type: 'Regular' | 'Base';
  group_key: string;
  name: string;
  roles: string[];
  tables: string[];
}

/**
 * Table information from Superset API
 */
export interface SupersetTable {
  id: string;
  name: string;
  schema: string;
}

export class SupersetUserPayloadBuilder {
  public static fromPlace(
    place: Place,
    roleIds: string[],
  ): SupersetUserPayload {
    // Get username/password from place's creation details
    const { username, password } = place.creationDetails;
    if (!username || !password) {
      throw new Error('Cannot create Superset user without CHT credentials');
    }

    // Get email from contact properties
    const email = place.contact.properties.email?.formatted;
    if (!email) {
      throw new Error('Email is required for Superset user creation');
    }

    // Split name into first/last name
    const [firstName = '', ...lastNameParts] = place.contact.name.split(' ');
    const lastName = lastNameParts.join(' ') || firstName;

    return {
      active: true,
      first_name: firstName,
      last_name: lastName,
      email,
      username,
      password,
      roles: roleIds
    };
  }
}
