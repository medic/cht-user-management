import _ from 'lodash';
import { ChtApi, PlacePayload } from '../lib/cht-api';
import getConfigByKey from './config-factory';
import Validation from '../validation';

export type ConfigSystem = {
  domains: AuthenticationInfo[];
  contact_types: ContactType[];
  logoBase64: string;
};

export type PartnerConfig = {
  config: ConfigSystem;
  mutate?: (payload: PlacePayload, chtApi: ChtApi, isReplacement: boolean) => Promise<PlacePayload>;
};

export type ContactType = {
  name: string;
  friendly: string;
  contact_type: string;
  contact_friendly?: string;
  user_role: string[];
  username_from_place: boolean;
  hierarchy: HierarchyConstraint[];
  replacement_property: ContactProperty;
  place_properties: ContactProperty[];
  contact_properties: ContactProperty[];
  deactivate_users_on_replace: boolean;
  can_assign_multiple?: boolean;
  hint?: string;
  superset?: SupersetConfig;
};

const KnownContactPropertyTypes = [...Validation.getKnownContactPropertyTypes()] as const;
export type ContactPropertyType = typeof KnownContactPropertyTypes[number]; 

export type HierarchyConstraint = {
  friendly_name: string;
  property_name: string;
  type: ContactPropertyType;
  required: boolean;
  parameter? : string | string[] | object;
  errorDescription? : string;
  unique?: string;
  
  contact_type: string;
  level: number;
};

export type ContactProperty = {
  friendly_name: string;
  property_name: string;
  type: ContactPropertyType;
  required: boolean;
  parameter? : string | string[] | object;
  errorDescription? : string;
  unique?: string;
};

export type AuthenticationInfo = {
  friendly: string;
  domain: string;
  useHttp?: boolean;
};

export enum SupersetMode {
  ENABLE = 'enable',
  DISABLE = 'disable',
}

export type SupersetModeParameter = {
  [K in SupersetMode]: string;
};

export type SupersetConfig = {
  friendly_name: string;
  property_name: string;
  type: ContactPropertyType;
  required: boolean;
  parameter?: SupersetModeParameter;

  prefix: string;
  role_template: number;
  rls_template: number;
  rls_group_key: string;
};

const {
  CONFIG_NAME,
  NODE_ENV,
  CHT_DEV_URL_PORT,
  CHT_DEV_HTTP
} = process.env;

const partnerConfig = getConfigByKey(CONFIG_NAME);
const { config } = partnerConfig;

export class Config {
  private constructor() {}

  public static contactTypes(): ContactType[] {
    return config.contact_types;
  }

  public static getContactType(name: string) : ContactType {
    const contactMatch = config.contact_types.find(c => c.name === name);
    if (!contactMatch) {
      throw new Error(`unrecognized contact type: "${name}"`);
    }
    return contactMatch;
  }

  public static getParentProperty(contactType: ContactType): HierarchyConstraint {
    const parentMatch = contactType.hierarchy.find(c => c.level === 1);
    if (!parentMatch) {
      throw new Error(`hierarchy at level 1 is required: "${contactType.name}"`);
    }

    return parentMatch;
  }

  public static getHierarchyWithReplacement(contactType: ContactType, sortBy: 'asc'|'desc' = 'asc'): HierarchyConstraint[] {
    const replacementAsHierarchy: HierarchyConstraint = {
      ...contactType.replacement_property,
      
      property_name: 'replacement',
      contact_type: contactType.name,
      level: 0,
    };

    return _.orderBy([
      ...contactType.hierarchy,
      replacementAsHierarchy,
    ], 'level', sortBy);
  }

  public static getUserRoleConfig(contactType: ContactType): ContactProperty {
    const parameter = contactType.user_role.reduce(
      (acc: { [key: string]: string }, curr: string) => {
        acc[curr] = curr;
        return acc;
      }, {}
    );

    return {
      friendly_name: 'Roles',
      property_name: 'role',
      type: 'select_multiple',
      required: true,
      parameter,
    };
  }

  public static getSupersetConfig(contactType: ContactType): SupersetConfig | undefined {
    return contactType.superset;
  }

  public static hasMultipleRoles(contactType: ContactType): boolean {
    if (!contactType.user_role.length || contactType.user_role.some(role => !role.trim())) {
      throw Error(`unvalidatable config: 'user_role' property is empty or contains empty strings`);
    }
    return contactType.user_role.length > 1;
  }

  public static async mutate(payload: PlacePayload, chtApi: ChtApi, isReplacement: boolean): Promise<PlacePayload | undefined> {
    return partnerConfig.mutate && partnerConfig.mutate(payload, chtApi, isReplacement);
  }

  public static getAuthenticationInfo(domain: string) : AuthenticationInfo {
    const domainMatch = Config.getDomains().find(c => c.domain === domain);
    if (!domainMatch) {
      throw new Error(`unrecognized domain: "${domain}"`);
    }
    return domainMatch;
  }

  public static getLogoBase64() : string {
    return config.logoBase64;
  }

  public static getPropertyWithName(properties: ContactProperty[], name: string) : ContactProperty {
    const property = properties.find(prop => prop.property_name === name);
    if (!property) {
      throw Error(`unable to find property_name:"${name}"`);
    }

    return property;
  }

  public static getRequiredColumns(contactType: ContactType, isReplacement: boolean): ContactProperty[] {
    const requiredContactProps = contactType.contact_properties.filter(p => p.required);
    const requiredPlaceProps = isReplacement ? [] : contactType.place_properties.filter(p => p.required);
    const requiredHierarchy = contactType.hierarchy.filter(h => h.required);
    const requiredUserRole = Config.hasMultipleRoles(contactType) ? [Config.getUserRoleConfig(contactType)] : [];

    // Early detect email contact property presence if the contact type has superset enabled
    if (contactType.superset) {
      const emailProperty = contactType.contact_properties.find(p => p.property_name === 'email');
      if (!emailProperty) {
        throw new Error(
          `It looks like the contact type "${contactType.name}" has Superset integration enabled ` +
          `but missing the required "email" contact property. Please ensure 'email' is included ` +
          `to avoid issues with Superset integration later on.`
        );
      }

      // Add 'email' to the list of required contact properties if it's not already required
      if (!emailProperty.required) {
        requiredContactProps.push({ ...emailProperty, required: true });
      }
    }

    return [
      ...requiredHierarchy,
      ...requiredContactProps,
      ...requiredPlaceProps,
      ...requiredUserRole
    ];
  }

  public static getDomains() : AuthenticationInfo[] {
    const domains = [...config.domains];

    // because all .env vars imported as strings, let's get the AuthenticationInfo object a boolean
    let TMP_USE_HTTP = true;
    if (CHT_DEV_HTTP === 'false') {
      TMP_USE_HTTP = false;
    }

    if (NODE_ENV !== 'production') {
      domains.push({
        friendly: '$Development Instance (' + CHT_DEV_URL_PORT + ')',
        domain: CHT_DEV_URL_PORT as string,
        useHttp: TMP_USE_HTTP,
      });
    }

    return _.sortBy(domains, 'friendly');
  }

  public static getUniqueProperties(contactTypeName: string): ContactProperty[] {
    const contactMatch = config.contact_types.find(c => c.name === contactTypeName);
    const uniqueProperties = contactMatch?.place_properties.filter(prop => prop.unique);
    return uniqueProperties || [];
  }

  // TODO: Joi? Chai?
  public static assertValid({ config }: PartnerConfig = partnerConfig) {
    for (const contactType of config.contact_types) {
      const allHierarchyProperties = [...contactType.hierarchy, contactType.replacement_property];
      const allProperties = [
        ...contactType.place_properties,
        ...contactType.contact_properties,
        ...allHierarchyProperties,
        Config.getUserRoleConfig(contactType),
      ];
      
      Config.getPropertyWithName(contactType.place_properties, 'name');
      Config.getPropertyWithName(contactType.contact_properties, 'name');

      const parentLevel = contactType.hierarchy.find(hierarchy => hierarchy.level === 1);
      if (!parentLevel) {
        throw Error(`Must have a hierarchy with parent level (level: 1)`);
      }

      const invalidPropsWithUnique = allHierarchyProperties.filter(prop => prop.unique);
      if (invalidPropsWithUnique.length) {
        throw Error(`Only place_properties and contact_properties can have properties with "unique" values`);
      }

      allProperties.forEach(property => {
        if (!KnownContactPropertyTypes.includes(property.type)) {
          throw Error(`Unknown property type "${property.type}"`);
        }
      });

      const generatedHierarchyProperties = allHierarchyProperties.filter(hierarchy => hierarchy.type === 'generated');
      if (generatedHierarchyProperties.length) {
        throw Error('Hierarchy properties cannot be of type "generated"');
      }
    }
  }

  public static getSupersetBaseUrl(): string {
    const configKey = CONFIG_NAME?.replace('-', '_').toUpperCase() || '';
    const baseUrl = Config.getSupersetEnvVar(`${configKey}_SUPERSET_BASE_URL`);
    if (!baseUrl) {
      throw new Error(`${configKey}_SUPERSET_BASE_URL is not configured`);
    }
    return baseUrl;
  }

  public static getSupersetCredentials(): { username: string; password: string } {
    const configKey = CONFIG_NAME?.replace('-', '_').toUpperCase() || '';
    const username = Config.getSupersetEnvVar(`${configKey}_SUPERSET_ADMIN_USERNAME`);
    const password = Config.getSupersetEnvVar(`${configKey}_SUPERSET_ADMIN_PASSWORD`);
    
    if (!username || !password) {
      throw new Error(`Superset credentials (${configKey}_SUPERSET_ADMIN_*) are not properly configured`);
    }
    
    return { username, password };
  }

  private static getSupersetEnvVar(envVar: string): string {
    if (!this.hasSupersetConfig()) {
      return '';
    }

    const envValue = process.env[envVar];
    if (!envValue) {
      throw new Error(`Required Superset environment variable ${envVar} is not set`);
    }

    return envValue;
  }

  // Helper function to check if any contact type has Superset configuration
  private static hasSupersetConfig(): boolean {
    const anyContactTypeWithSuperset = config.contact_types.find(
      (contactType) => contactType.superset !== undefined
    );
    return !!anyContactTypeWithSuperset;
  }
}

