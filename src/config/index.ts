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
}

