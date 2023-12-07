import _ from 'lodash';

import { ContactProperty, ContactType } from './config';

import ValidatorString from './validator-string';
import ValidatorPhone from './validator-phone';
import ValidatorRegex from './validator-regex';
import ValidatorName from './validator-name';
import ValidatorGender from './validator-gender';
import Place from '../services/place';
import ValidatorSkip from './validator-skip';
import PlaceResolver from './place-resolver';


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
  regex: new ValidatorRegex(),
  phone: new ValidatorPhone(),
  none: new ValidatorSkip(),
  gender: new ValidatorGender(),
};

export class Validation {
  public static getInvalidProperties(place: Place) : string[] {
    const result = [
      ...Validation.validatePlaceLinks(place),
      ...Validation.validateProperties(place.properties, place.type.place_properties, 'place_'),
      ...Validation.validateProperties(place.contact.properties, place.type.contact_properties, 'contact_')
    ];

    return result;
  }

  public static format(place: Place): Place
  {
    const alterAllProperties = (propertiesToAlter: ContactProperty[], objectToAlter: any) => {
      for (const property of propertiesToAlter) {
        this.alterProperty(property, objectToAlter);
      }
    }

    alterAllProperties(place.type.contact_properties, place.contact.properties);
    alterAllProperties(place.type.place_properties, place.properties);

    const replacementProperty = _.cloneDeep(place.type.place_properties.find(p => p.doc_name === 'name'));
    if (!replacementProperty) {
      throw Error('Validation.format failed to find name property');
    }
    replacementProperty.doc_name = 'replacement';
    this.alterProperty(replacementProperty, place.properties);

    return place;
  }

  public static formatSingle(docName: string, val: string, contactType: ContactType): string {
    const propertyMatch = contactType.place_properties.find(p => p.doc_name === docName);
    if (!propertyMatch) {
      throw Error(`Cannot validate single property with name: "${docName}"`);
    }
    
    const object = { [docName]: val };
    Validation.alterProperty(propertyMatch, object);
    return object[docName];
  }

  private static validatePlaceLinks(place: Place): string[] {
    const result = [];
    if (place.replacementName) {
      const expectReplacement = !!place.replacementName;
      const hasLinkedReplacement = !!place.replacement?.id;
      const replacementLinkIsValid = !expectReplacement || PlaceResolver.isParentIdValid(place.replacement?.id);
      const isReplacementValid = expectReplacement === hasLinkedReplacement && replacementLinkIsValid;
      if (!isReplacementValid) {
        result.push('place_replacement');
      }
    }

    const expectParent = !!place.type.parent_type;
    const hasLinkedParent = !!place.parentDetails?.id;
    const parentLinkIsValid = !expectParent || PlaceResolver.isParentIdValid(place.parentDetails?.id);
    const isParentValid = expectParent === hasLinkedParent && parentLinkIsValid;
    if (!isParentValid) {
      result.push('place_PARENT');
    }

    return result;
  }

  private static validateProperties(obj : any, properties : ContactProperty[], prefix: string) : string[] {
    const invalid = [];

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

  private static alterProperty(property : ContactProperty, obj: any) {
    const value = obj[property.doc_name];
    if (value) {
      const altered = this.getValidator(property).format(value, property);
      obj[property.doc_name] = altered;
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
