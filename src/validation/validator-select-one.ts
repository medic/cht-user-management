import {ContactProperty} from '../config';
import { InputSource, IValidator } from '.';
import ValidatorString from './validator-string';

export default class ValidatorSelectOne implements IValidator {
  isValid(input: string, property: ContactProperty, source: InputSource = 'form'): boolean|string {
    const stringValidator = new ValidatorString();
    const trimmedInput = stringValidator.format(input);

    if (trimmedInput.length === 0 && property.required) {
      return `Value is required`;
    }
    // Verify property.parameter is an object
    if (!property?.parameter || typeof property.parameter !== 'object') {
      throw new TypeError(`Expected attribute "parameter" on property ${property.property_name} to be an object.`);
    }
    return !!ValidatorSelectOne.findOption(input, property, source);
  }

  format(input: string, property: ContactProperty, source: InputSource = 'form'): string {
    return ValidatorSelectOne.findOption(input, property, source) ?? input;
  }

  get defaultError(): string {
    return 'Invalid value selected';
  }

  // Returns the option key matching the input,
  // Form/API inputs are matched on keys
  // CSV inputs are matched on labels.
  public static findOption(input: string, property: ContactProperty, source: InputSource = 'form'): string | undefined {
    if (!property?.parameter || typeof property.parameter !== 'object') {
      return;
    }

    const stringValidator = new ValidatorString();
    const normalize = (value: unknown) => stringValidator.format(String(value)).toLowerCase();

    const normalizedInput = normalize(input);
    if (!normalizedInput) {
      return;
    }

    const options = Object.entries(property.parameter);
    const byKey = () => options.find(([key]) => normalize(key) === normalizedInput);
    const byLabel = () => options.find(([, label]) => normalize(label) === normalizedInput);
    const match = source === 'csv' ? byLabel() : byKey();
    return match?.[0];
  }
}
