import _ from 'lodash';
import { Config, ContactProperty, HierarchyConstraint } from '../config';
import { IValidator } from '.';
import Place from '../services/place';
import RemotePlaceResolver from '../lib/remote-place-resolver';

import ValidatorDateOfBirth from './validator-dob';
import ValidatorGenerated from './validator-generated';
import ValidatorName from './validator-name';
import ValidatorPhone from './validator-phone';
import ValidatorRegex from './validator-regex';
import ValidatorSelectMultiple from './validator-select-multiple';
import ValidatorSelectOne from './validator-select-one';
import ValidatorSkip from './validator-skip';
import ValidatorString from './validator-string';
import { RemotePlace } from '../lib/remote-place-cache';

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
  public static validateProperty(
    value: string,
    property : ContactProperty,
    requiredProperties: ContactProperty[]
  ) : string | undefined {
    const isRequired = requiredProperties.some((prop) => _.isEqual(prop, property));
    if (!value && isRequired) {
      return 'Is Required';
    }

    if (value || isRequired) {
      const isValid = Validation.isValid(property, value);
      if (isValid === false || typeof isValid === 'string') {
        return isValid === false ? 'Value is invalid' : isValid as string;
      }
    }
  }

  public static format(property: ContactProperty, value: string): string {
    const validator = this.getValidator(property);
    if (!(validator instanceof ValidatorGenerated) && value) {
      return validator.format(value, property);
    }

    return value;
  }

  public static generateAfterInitialization(place: Place, property: ContactProperty): string | undefined {
    const validator = this.getValidator(property);
    if (validator instanceof ValidatorGenerated) {
      return validator.format(place, property);
    }

    return;
  }

  public static validateHierarchyLevel(place: Place, hierarchyLevel: HierarchyConstraint): string | undefined {
    const hierarchy = Config.getHierarchyWithReplacement(place.type);
    const data = place.hierarchyProperties[hierarchyLevel.property_name];

    if (hierarchyLevel.level !== 0 || data?.formatted) {
      const isExpected = hierarchyLevel.required;
      const resolution = place.resolvedHierarchy[hierarchyLevel.level];
      const isValid = resolution?.type !== 'invalid' && (
        !isExpected || 
        resolution?.type === 'remote' || 
        resolution?.type === 'local'
      );
      if (!isValid) {
        const index = hierarchy.findIndex(h => h.level === hierarchyLevel.level);
        if (index < 0) {
          throw Error('Failed to find hierachy level');
        }

        const levelUp = hierarchy[index + 1]?.property_name;
        const error = this.describeInvalidRemotePlace(
          resolution,
          hierarchyLevel.contact_type,
          data?.original,
          place.hierarchyProperties[levelUp]?.original
        );

        return error;
      }
    }
  }

  public static getKnownContactPropertyTypes(): string[] {
    return Object.keys(TypeValidatorMap);
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

  private static getValidator(property: ContactProperty) : IValidator {
    const validator = this.getValidatorForType(property.type);
    if (!validator) {
      throw Error(`unvalidatable type: '${property.friendly_name}' has type '${property.type}'`);
    }

    return validator;
  }

  public static getValidatorForType(propertyType: string) : IValidator | undefined {
    return TypeValidatorMap[propertyType];
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
