import { ContactProperty } from '../config';
import { IPropertyValue } from '.';
import Validation from '../validation';

export class NamePropertyValue implements IPropertyValue {
  public original: string;
  public formatted: string;
  public propertyNameWithPrefix: string;
  public validationError?: string;

  constructor(value: string, nameContactProperty: ContactProperty) {
    this.original = value;
    this.propertyNameWithPrefix = `place_name`;
    this.formatted = Validation.formatDuringInitialization(nameContactProperty, value);
  }

  public validate(): void {}

  public toString(): string {
    return this.formatted;
  }
}
