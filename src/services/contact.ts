import { v4 as uuidv4 } from 'uuid';
import { Config, ContactType } from '../config';
import { FormattedPropertyCollection } from './place';

export default class Contact {
  public id: string;
  public type: ContactType;
  public properties: FormattedPropertyCollection;

  constructor(type: ContactType) {
    this.id = uuidv4();
    this.type = type;
    this.properties = {};
  }

  public get name() : string {
    const nameProperty = Config.getPropertyWithName(this.type.contact_properties, 'name');
    return this.properties[nameProperty.property_name]?.formatted;
  }
}
