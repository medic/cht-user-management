import { ContactProperty } from "../config";
import { IValidator } from './validation';

import ValidatorString from './validator-string';

export default class ValidatorRegex implements IValidator {
  isValid(input: string, property : ContactProperty) : boolean | string {
    if (!property.parameter) {
      throw Error(`property of type regex - ${property.friendly_name} is missing parameter`);
    }

    if (Array.isArray(property.parameter)) {
      throw Error(`property of type regex - 'parameter' should not be an array`);
    }

    const regex = new RegExp(property.parameter);
    const validatorStr = new ValidatorString();
    const altered = validatorStr.format(input);
    const match = altered.match(regex);
    return !!match && match.length > 0;
  }

  format(input : string) : string {
    const validatorStr = new ValidatorString();
    return validatorStr.format(input);
  }

  get defaultError(): string {
    throw Error(`property of type regex - 'errorDescription' is required`);
  }
};
