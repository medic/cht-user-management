import { v4 as uuidv4 } from "uuid";
import { Config, ContactType } from "../config";

export default class Contact {
  public id: string;
  public type: ContactType;
  public properties: {
    [key: string]: any;
  };

  constructor(type: ContactType) {
    this.id = uuidv4();
    this.type = type;
    this.properties = {};
  }

  public get name() : string {
    const nameProperty = Config.getPropertyWithName(this.type.contact_properties, 'name');
    return this.properties[nameProperty.property_name];
  }
};
