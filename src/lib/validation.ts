import _ from 'lodash';

import { ContactProperty } from './config';

import ValidatorString from './validator-string';
import ValidatorPhone from './validator-phone';
import ValidatorName from './validator-name';
import ValidatorGender from './validator-gender';
import Place from '../services/place';
import ValidatorSkip from './validator-skip';
import ParentComparator from './parent-comparator';


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
  none: new ValidatorSkip(),
  gender: new ValidatorGender(),
};

export class Validation {
  public static getInvalidProperties(place: Place) : string[] {
    return [
      ...Validation.validateParent(place),
      ...Validation.validateProperties(place.properties, place.type.place_properties, 'place_'),
      ...Validation.validateProperties(place.contact.properties, place.type.contact_properties, 'contact_')
    ]
  }

  public static cleanup(place: Place): Place
  {
    const formatAllProperties = (propertiesToFormat: ContactProperty[], objectToFormat: any) => {
      for (const property of propertiesToFormat) {
        this.formatProperty(property, objectToFormat);
      }
    }

    formatAllProperties(place.type.contact_properties, place.contact.properties);
    formatAllProperties(place.type.place_properties, place.properties);
    return place;
  }

  private static validateParent(place: Place): string[] {
    const expectParent = !!place.type.parent_type;
    const hasLinkedParent = !!place.parentDetails?.id;
    const parentLinkIsValid = !expectParent || ParentComparator.isParentIdValid(place.parentDetails?.id);
    const isValid = expectParent === hasLinkedParent && parentLinkIsValid;
    return isValid ? [] : ['place_PARENT'];
  }

  private static validateProperties(obj : any, properties : ContactProperty[], prefix: string) : string[] {
    const invalid = [];

    const expectedProperties = properties.filter(p => p.required).map(p => p.doc_name);
    const actualProperties = Object.keys(obj);
    const hasAll = expectedProperties.filter(p => !actualProperties.includes(p));
    if (!hasAll) {
      invalid.push('missing required properties');
    }

    for (const property of properties) {
      const value = obj[property.doc_name];

      if (value || property.required) {
        const valid = Validation.isValid(property, value);
        if (!valid) {
          invalid.push(`${prefix}${property.doc_name}`);
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
    if (value) {
      const formatted = this.getValidator(property).format(value, property);
      obj[property.doc_name] = formatted;
    }
  }

  private static getValidator(property: ContactProperty) : IValidator {
    const validator = TypeValidatorMap[property.type];
    if (!validator) {
      throw Error(`unvalidatable type: "${property.csv_name}" has type "${property.type}"`);
    }

    return validator;
  }
};