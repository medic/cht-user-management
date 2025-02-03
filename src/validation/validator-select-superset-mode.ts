import { ContactProperty } from '../config';
import { IValidator } from '.';
import ValidatorString from './validator-string';
import { SupersetMode } from '../config';
import _ from 'lodash';

export default class ValidatorSelectSupersetMode implements IValidator {
  isValid(input: string, property: ContactProperty): boolean | string {
    const allowedValues = Object.values(SupersetMode) as string[];

    // Validate that 'parameter' exists and is an object
    if (!property?.parameter || typeof property.parameter !== 'object') {
      throw new TypeError(`Expected attribute "parameter" on property ${property.property_name} to be an object.`);
    }

    const validParameterValues = Object.keys(property.parameter);

    // Ensure the allowedValues from the enum match the validParameterValues
    // This ensures the config parameters (setup in the contact properties) aligns with the allowed values of SupersetMode
    if (!_.isEqual(allowedValues, validParameterValues)) {
      return `Invalid integration mode configuration. Allowed values and parameter values must match exactly: ${allowedValues.join(', ')}`;
    }

    // Format and clean input using string validator
    const stringValidator = new ValidatorString();
    const trimmedInput = stringValidator.format(input);

    // If the field is required and the input is empty, return an error
    if (trimmedInput.length === 0 && property.required) {
      return `Value is required`;
    }

    // Check if input matches one of the valid parameter values
    if (!validParameterValues.includes(trimmedInput)) {
      return `Invalid integration mode. Must be one of the valid parameter values: ${validParameterValues.join(', ')}`;
    }

    return true;
  }

  format(input: string): string {
    return input.trim();
  }

  get defaultError(): string {
    return 'Invalid integration mode selected';
  }
}
