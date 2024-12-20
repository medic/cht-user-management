import { IPropertyValue } from '.';

export default class UnvalidatedPropertyValue implements IPropertyValue {
  public original: string;
  public formatted: string;
  public propertyNameWithPrefix: string;
  public validationError?: string;

  constructor(value: string, propertyNameWithPrefix: string = value) {
    this.original = value;
    this.formatted = value;
    this.propertyNameWithPrefix = propertyNameWithPrefix;
  }

  public validate(): void {}

  public toString(): string {
    return this.formatted;
  }
}
