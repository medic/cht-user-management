import {ContactProperty} from '../config';
import { IValidator } from '.';
import ValidatorString from './validator-string';

export default class ValidatorSelectOne implements IValidator {
  isValid(input: string, property: ContactProperty): boolean|string {
    const stringValidator = new ValidatorString();
    const trimmedInput = stringValidator.format(input); 

    if (trimmedInput.length === 0 && property.required) {
      return `Value is required`;
    }
    // Verify property.parameter is an object
    if (!property?.parameter || typeof property.parameter !== 'object') {
      throw new TypeError(`Expected attribute "parameter" on property ${property.property_name} to be an object.`);
    }

    if (ValidatorSelectOne.findOption(input, property)) {
      return true;
    }

    return property.errorDescription || `Must be one of: ${Object.values(property.parameter).join(', ')}`;
  }

  format(input: string, property: ContactProperty): string {
    return ValidatorSelectOne.findOption(input, property) ?? input;
  }

  get defaultError(): string {
    return 'Invalid value selected';
  }

  // Matches the option's value or label, ignoring case and surrounding whitespace (eg. "Male" -> "male")
  public static findOption(input: string, property: ContactProperty): string | undefined {
    if (!property?.parameter || typeof property.parameter !== 'object') {
      return;
    }

    const normalized = new ValidatorString().format(input).toLowerCase();
    if (!normalized) {
      return;
    }

    const isMatch = ([value, label]: [string, unknown]) => value.toLowerCase() === normalized
      || String(label).toLowerCase() === normalized;
    return Object.entries(property.parameter).find(isMatch)?.[0];
  }
}
