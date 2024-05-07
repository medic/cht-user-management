import { ContactProperty } from '../config';
import { IPropertyValue } from '.';
import Validation from '../validation';

export class RemotePlacePropertyValue implements IPropertyValue {
  public original: string;
  public formatted: string;
  public propertyNameWithPrefix: string;
  public validationError?: string;
  public isGenerated: boolean;

  constructor(value: string, nameContactProperty: ContactProperty) {
    this.original = value;
    this.propertyNameWithPrefix = `place_${nameContactProperty.property_name}`;
    this.formatted = Validation.formatDuringInitialization(nameContactProperty, value);
    this.isGenerated = nameContactProperty.type === 'generated';
  }

  public validate(): void {}

  public toString(): string {
    return this.formatted;
  }
}
