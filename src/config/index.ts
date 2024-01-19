import _ from "lodash";
import { ChtApi, PlacePayload } from "../lib/cht-api";
import getConfigByKey from "./config-factory";
import {env} from "process";

export type ConfigSystem = {
  domains: AuthenticationInfo[];
  contact_types: ContactType[];
  logoBase64: string,
};

export type PartnerConfig = {
  config: ConfigSystem;
  mutate?: (payload: PlacePayload, chtApi: ChtApi, isReplacement: boolean) => Promise<PlacePayload>;
};

export type ContactType = {
  name: string;
  friendly: string;
  contact_type: string;
  user_role: string;
  username_from_place: boolean;
  hierarchy: HierarchyConstraint[];
  replacement_property: ContactProperty;
  place_properties: ContactProperty[];
  contact_properties: ContactProperty[];
};

export type HierarchyConstraint = {
  friendly_name: string;
  property_name: string;
  type: string;
  required: boolean;
  parameter? : string | string[];
  errorDescription? : string;
  
  contact_type: string;
  level: number;
};

export type ContactProperty = {
  friendly_name: string;
  property_name: string;
  type: string;
  required: boolean;
  parameter? : string | string[];
  errorDescription? : string;
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
      throw Error(`unable to find place_property with property_name:"${name}"`);
    }

    return property;
  }

  public static getRequiredColumns(contactType: ContactType, isReplacement: boolean): ContactProperty[] {
    const requiredContactProps = contactType.contact_properties.filter(p => p.required);
    const requiredPlaceProps = isReplacement ? [] : contactType.place_properties.filter(p => p.required);
    const requiredHierarchy = contactType.hierarchy.filter(h => h.required);

    return [
      ...requiredHierarchy,
      ...requiredContactProps,
      ...requiredPlaceProps
    ];
  }

  public static getDomains() : AuthenticationInfo[] {
    const domains = [...config.domains];

    // because all .env vars imported as strings, let's get the AuthenticationInfo object a boolean
    let TMP_USE_HTTP = true;
    if (CHT_DEV_HTTP === 'false') {
      TMP_USE_HTTP = false
    }

    if (NODE_ENV !== 'production') {
      domains.push({
        friendly: '$localhost',
        domain: CHT_DEV_URL_PORT as string,
        useHttp: TMP_USE_HTTP,
      });
    }

    return _.sortBy(domains, 'friendly');
  }
}
