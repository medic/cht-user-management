import _ from "lodash";
import config from "../echis-ke/config.json";
import eCHISMutate from "../echis-ke/gross";
import { ChtApi, PlacePayload } from "./cht-api";

export type ContactType = {
  name: string;
  friendly: string;
  parent_type: string;
  contact_type: string;
  contact_role: string;
  place_properties: ContactProperty[];
  contact_properties: ContactProperty[];
};

export type ContactProperty = {
  csv_name: string;
  doc_name: string;
  type: string;
  validator? : string | string[];
  required: boolean;
};

export type AuthenticationInfo = {
  friendly: string;
  domain: string;
  useHttp?: boolean;
};

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

  public static eCHISMutate(payload: PlacePayload, chtApi: ChtApi, isReplacement: boolean): Promise<PlacePayload> {
    return eCHISMutate(payload, chtApi, isReplacement);
  }

  public static getAuthenticationInfo(domain: string) : AuthenticationInfo {
    const domainMatch = config.domains.find(c => c.domain === domain);
    if (!domainMatch) {
      throw new Error(`unrecognized domain: "${domain}"`);
    }
    return domainMatch;
  }

  public static domains() : AuthenticationInfo[] {
    return _.sortBy(config.domains, 'friendly');
  }
}
