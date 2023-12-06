import _ from 'lodash';

import { ContactProperty, ContactType } from './config';
import { person, place } from '../services/models';

import ValidatorString from './validator-string';
import ValidatorPhone from './validator-phone';
import ValidatorName from './validator-name';
import ValidatorGender from './validator-gender';


export interface IValidator {
  isValid(input: string, property? : ContactProperty) : boolean,
  format(input : string, property? : ContactProperty) : string,
}

type ValidatorMap = {
  [key: string]: IValidator,
};

const TypeValidatorMap: ValidatorMap = {
  string: new ValidatorString(),
  name: new ValidatorName(),
  phone: new ValidatorPhone(),
  gender: new ValidatorGender(),
};

export class Validation {
  public static getInvalidProperties(contactType: ContactType, place: place, contact: person) : string[] {
    return [
      ...Validation.validateObject(place.properties, contactType.place_properties),
      ...Validation.validateObject(contact.properties, contactType.contact_properties)
    ]
  }

  public static format(contactType: ContactType, place: place, contact: person) 
    : { place: place, contact: person }
  {
    const clonedPlace = _.cloneDeep(place);
    const clonedContact = _.cloneDeep(contact);

    const formatAllProperties = (propertiesToFormat: ContactProperty[], objectToFormat: any) => {
      for (const property of propertiesToFormat) {
        this.formatProperty(property, objectToFormat);
      }
    }

    formatAllProperties(contactType.contact_properties, clonedContact.properties);
    formatAllProperties(contactType.place_properties, clonedPlace.properties);
    return { place: clonedPlace, contact: clonedContact };
  }

  private static validateObject(obj : any, properties : ContactProperty[]) : string[] {
    const invalid = [];

    const expectedProperties = properties.filter(p => p.required).map(p => p.doc_name);
    const actualProperties = Object.keys(obj);
    const hasAll = expectedProperties.filter(p => !actualProperties.includes(p));
    if (!hasAll) {
      console.log('validation: missing properties');
      invalid.push('missing required properties');
    }

    for (const property of properties) {
      const value = obj[property.doc_name];

      if (value || property.required) {
        const valid = Validation.isValid(property, value);
        if (!valid) {
          console.log(`validation: ${property.csv_name} is invalid "${value}"`);
        }

        if (!valid) {
          invalid.push(property.csv_name);
        }
      }
    }

    return invalid;
  }

  private static isValid(property : ContactProperty, value: string) : boolean {
    const validator = this.getValidator(property);
    try {
      return validator.isValid(value, property);
    }
    catch (e) {
      console.log(`Error in isValid for "${property.type}": ${e}`);
      return false;
    }
  }

  private static formatProperty(property : ContactProperty, obj: any) {
    const value = obj[property.doc_name];
    const formatted = this.getValidator(property).format(value, property);
    obj[property.doc_name] = formatted;
  }

  private static getValidator(property: ContactProperty) : IValidator {
    const validator = TypeValidatorMap[property.type];
    if (!validator) {
      throw Error(`unvalidatable type: "${property.csv_name}" has type "${property.type}"`);
    }

    return validator;
  }
};
