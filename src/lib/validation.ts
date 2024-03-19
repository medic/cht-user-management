import { Config, ContactProperty } from '../config';
import Place from '../services/place';
import RemotePlaceResolver from './remote-place-resolver';
import { RemotePlace } from './cht-api';

import ValidatorDateOfBirth from './validator-dob';
import ValidatorGender from './validator-gender';
import ValidatorGenerated from './validator-generated';
import ValidatorName from './validator-name';
import ValidatorPhone from './validator-phone';
import ValidatorRegex from './validator-regex';
import ValidatorSkip from './validator-skip';
import ValidatorString from './validator-string';

type GeneratorScope = {
  place: any;
  contact: any;
  lineage: any;
};

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
  gender: new ValidatorGender(),
  generated: new ValidatorGenerated(),
  name: new ValidatorName(),
  none: new ValidatorSkip(),
  phone: new ValidatorPhone(),
  regex: new ValidatorRegex(),
  string: new ValidatorString(),
};

export class Validation {
  public static getValidationErrors(place: Place) : ValidationError[] {
    const requiredColumns = Config.getRequiredColumns(place.type, place.isReplacement);
    const result = [
      ...Validation.validateHierarchy(place),
      ...Validation.validateProperties(place.properties, place.type.place_properties, requiredColumns, 'place_'),
      ...Validation.validateProperties(place.contact.properties, place.type.contact_properties, requiredColumns, 'contact_')
    ];

    return result;
  }

  public static format(place: Place): void {
    Validation.formattingPass(place, false);
    Validation.formattingPass(place, true);
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

      const isRequired = requiredProperties.includes(property);
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
      const generationScope = Validation.createGeneratorScope(place);
      const altered = validator.format(generationScope, property);
      obj[property.property_name] = altered;
    } else if (value) {
      const altered = validator.format(value, property);
      obj[property.property_name] = altered;
    }
  }

  private static formattingPass(place: Place, formatGenerators: boolean) {
    const isGenerator = (property: ContactProperty) => property.type === 'generated';
    const alterAllProperties = (propertiesToAlter: ContactProperty[], objectToAlter: any) => {
      for (const property of propertiesToAlter) {
        if (isGenerator(property) === formatGenerators) {
          this.alterProperty(place, property, objectToAlter);
        }
      }
    };

    alterAllProperties(place.type.contact_properties, place.contact.properties);
    alterAllProperties(place.type.place_properties, place.properties);
    for (const hierarchy of Config.getHierarchyWithReplacement(place.type)) {
      this.alterProperty(place, hierarchy, place.hierarchyProperties);
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

  private static createGeneratorScope(place: Place): GeneratorScope {
    return {
      place: place.properties,
      contact: place.contact.properties,
      lineage: place.hierarchyProperties,
    };
  }
}
