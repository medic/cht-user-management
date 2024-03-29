import _ from 'lodash';
import { Config, ContactProperty } from '../config';
import Place from '../services/place';
import RemotePlaceResolver from './remote-place-resolver';
import { RemotePlace } from './cht-api';

import ValidatorDateOfBirth from './validator-dob';
import ValidatorGenerated from './validator-generated';
import ValidatorName from './validator-name';
import ValidatorPhone from './validator-phone';
import ValidatorRegex from './validator-regex';
import ValidatorSelectMultiple from './validator-select-multiple';
import ValidatorSelectOne from './validator-select-one';
import ValidatorSkip from './validator-skip';
import ValidatorString from './validator-string';

export type ValidationError = {
  property_name: string;
  description: string;
};

export interface IValidator {
  isValid(input: string, property? : ContactProperty) : boolean | string;
  format(input : string, property? : ContactProperty) : string;
  get defaultError(): string;
}

type ValidatorMap = {
  [key: string]: IValidator;
};

const TypeValidatorMap: ValidatorMap = {
  dob: new ValidatorDateOfBirth(),
  generated: new ValidatorGenerated(),
  name: new ValidatorName(),
  none: new ValidatorSkip(),
  phone: new ValidatorPhone(),
  regex: new ValidatorRegex(),
  string: new ValidatorString(),
  select_one: new ValidatorSelectOne(),
  select_multiple: new ValidatorSelectMultiple(),
};

export class Validation {
  public static getValidationErrors(place: Place) : ValidationError[] {
    const requiredColumns = Config.getRequiredColumns(place.type, place.isReplacement);
    const result = [
      ...Validation.validateHierarchy(place),
      ...Validation.validateProperties(place.properties, place.type.place_properties, requiredColumns, 'place_'),
      ...Validation.validateProperties(place.contact.properties, place.type.contact_properties, requiredColumns, 'contact_'),
      ...Validation.validateProperties(place.userRoleProperties, [Config.getUserRoleConfig(place.type)], requiredColumns, 'user_')
    ];

    return result;
  }

  public static format(place: Place): void {
    const doFormatting = (withGenerators: boolean) => {
      const isGenerator = (property: ContactProperty) => property.type === 'generated';
      const alterAllProperties = (propertiesToAlter: ContactProperty[], objectToAlter: any) => {
        for (const property of propertiesToAlter) {
          if (isGenerator(property) === withGenerators) {
            this.alterProperty(place, property, objectToAlter);
          }
        }
      };

      alterAllProperties(place.type.contact_properties, place.contact.properties);
      alterAllProperties(place.type.place_properties, place.properties);
      for (const hierarchy of Config.getHierarchyWithReplacement(place.type)) {
        this.alterProperty(place, hierarchy, place.hierarchyProperties);
      }
    };

    doFormatting(false);
    doFormatting(true);
  }

  public static formatSingle(place: Place, propertyMatch: ContactProperty, val: string): string {
    const object = { [propertyMatch.property_name]: val };
    Validation.alterProperty(place, propertyMatch, object);
    return object[propertyMatch.property_name];
  }

  private static validateHierarchy(place: Place): ValidationError[] {
    const result: ValidationError[] = [];

    const hierarchy = Config.getHierarchyWithReplacement(place.type);
    hierarchy.forEach((hierarchyLevel, index) => {
      const data = place.hierarchyProperties[hierarchyLevel.property_name];

      if (hierarchyLevel.level !== 0 || data) {
        const isExpected = hierarchyLevel.required;
        const resolution = place.resolvedHierarchy[hierarchyLevel.level];
        const isValid = resolution?.type !== 'invalid' && (
          !isExpected || 
          resolution?.type === 'remote' || 
          resolution?.type === 'local'
        );
        if (!isValid) {
          const levelUp = hierarchy[index + 1]?.property_name;
          result.push({
            property_name: `hierarchy_${hierarchyLevel.property_name}`,
            description: this.describeInvalidRemotePlace(
              resolution,
              hierarchyLevel.contact_type,
              data,
              place.hierarchyProperties[levelUp]
            ),
          });
        }
      }
    });
    
    return result;
  }

  private static validateProperties(
    obj : any,
    properties : ContactProperty[],
    requiredProperties: ContactProperty[],
    prefix: string
  ) : ValidationError[] {
    const invalid: ValidationError[] = [];

    for (const property of properties) {
      const value = obj[property.property_name];

      const isRequired = requiredProperties.some((prop) => _.isEqual(prop, property));
      if (value || isRequired) {
        const isValid = Validation.isValid(property, value);
        if (isValid === false || typeof isValid === 'string') {
          invalid.push({
            property_name: `${prefix}${property.property_name}`,
            description: isValid === false ? 'Value is invalid' : isValid as string,
          });
        }
      }
    }

    return invalid;
  }

  private static isValid(property : ContactProperty, value: string) : boolean | string {
    const validator = this.getValidator(property);
    try {
      const isValid = validator.isValid(value, property);
      return isValid === false ? property.errorDescription || validator.defaultError : isValid;
    } catch (e) {
      const error = `Error in isValid for '${property.type}': ${e}`;
      console.log(error);
      return error;
    }
  }

  private static alterProperty(place: Place, property : ContactProperty, obj: any) {
    const value = obj[property.property_name];
    const validator = this.getValidator(property);
    if (validator instanceof ValidatorGenerated) {
      const altered = validator.format(place, property);
      obj[property.property_name] = altered;
    } else if (value) {
      const altered = validator.format(value, property);
      obj[property.property_name] = altered;
    }
  }

  private static getValidator(property: ContactProperty) : IValidator {
    const validator = TypeValidatorMap[property.type];
    if (!validator) {
      throw Error(`unvalidatable type: '${property.friendly_name}' has type '${property.type}'`);
    }

    return validator;
  }

  private static describeInvalidRemotePlace(
    remotePlace: RemotePlace | undefined,
    friendlyType: string,
    searchStr?: string,
    requiredParent?: string
  ): string {
    if (!searchStr) {
      return `Cannot find ${friendlyType} because the search string is empty`;
    }

    const requiredParentSuffix = requiredParent ? ` under '${requiredParent}'` : '';
    if (RemotePlaceResolver.Multiple.id === remotePlace?.id) {
      const ambiguityDetails = JSON.stringify(remotePlace.ambiguities?.map(a => a.id));
      return `Found multiple ${friendlyType}s matching '${searchStr}'${requiredParentSuffix} ${ambiguityDetails}`;
    }

    return `Cannot find '${friendlyType}' matching '${searchStr}'${requiredParentSuffix}`;
  }
}
