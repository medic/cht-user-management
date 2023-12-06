import { v4 as uuidv4 } from "uuid";
import { ContactType } from "../lib/config";

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
    const nameProperty = this.type.contact_properties.find(p => p.doc_name === 'name');
    if (!nameProperty) {
      throw Error(`Place ${this.type.name} has no name property on contact`);
    }

    return this.properties[nameProperty.doc_name];
  }
};
