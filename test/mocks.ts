import { ContactType } from "../src/lib/config";
import Place from "../src/services/place";

export const mockPlace = (type: ContactType, prop: any) : Place => {
  const result = new Place(type);
  result.properties = {
    name: 'place',
    prop
  };
  result.contact.properties = {
    name: 'contact',
  };
  result.parentDetails = {
    id: 'known',
    type: type.parent_type,
    name: 'parent',
  };
  return result;
};

export const mockSimpleContactType = (propertyType = 'string', propertyValidator: string | string[] | undefined) : ContactType => ({
  name: 'contacttype-name',
  friendly: 'friendly',
  parent_type: 'parent',
  contact_type: 'contact-type',
  contact_role: 'role',
  place_properties: [
    mockProperty(propertyType, propertyValidator)
  ],
  contact_properties: [],
});

export const mockValidContactType = (propertyType = 'string', propertyValidator: string | string[] | undefined) : ContactType => ({
  name: 'contacttype-name',
  friendly: 'friendly',
  parent_type: 'parent',
  contact_type: 'contact-type',
  contact_role: 'role',
  place_properties: [
    mockProperty('string', undefined, 'PARENT'),
    mockProperty('string', undefined, 'name'),
    mockProperty(propertyType, propertyValidator)
  ],
  contact_properties: [
    mockProperty('string', undefined, 'name'),
  ],
});

export const mockProperty = (type = 'string', validator: string | string[] | undefined, doc_name: string = 'prop') => ({
  csv_name: 'csv',
  doc_name,
  type,
  validator,
  required: true
});
