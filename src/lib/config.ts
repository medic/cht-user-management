import config from "../config.json";

export type ContactTypes = {
  name: string,
  friendly: string,
  parent_type: string,
  contact_type: string,
  roles: string[],
  properties: ContactProperty[],
};

export type ContactProperty = {
  csv_name: string,
  doc_name: string,
  type: string,
  required: boolean,
};

export class Config {
  private constructor() {}

  public static contactTypes() : ContactTypes[] {
    return config.contact_types;
  }
}
