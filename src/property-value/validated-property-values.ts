import { Config, ContactProperty, HierarchyConstraint, SupersetConfig } from '../config';
import { IPropertyValue } from '.';
import Place from '../services/place';
import Validation from '../validation';

abstract class AbstractPropertyValue implements IPropertyValue {
  public readonly original: string;
  protected readonly place: Place;
  protected readonly property: ContactProperty;
  private readonly propertyPrefix: string;
  
  protected formattedValue: string;
  private validationErrorValue?: string;

  constructor(place: Place, property: ContactProperty, prefix: string, value: string) {
    this.original = value;
    this.place = place;
    this.property = property;
    this.propertyPrefix = prefix;
    this.formattedValue = Validation.format(this.property, value);
  }

  public validate(): void {
    this.validationErrorValue = this.doValidation();
  }

  public get propertyNameWithPrefix(): string {
    return this.propertyPrefix + this.property.property_name;
  }

  public get formatted(): string {
    return this.formattedValue;
  }

  public get validationError(): string | undefined {
    return this.validationErrorValue;
  }

  public toString(): string {
    return this.formatted;
  }

  protected abstract doValidation(): string | undefined;
}

export class ContactPropertyValue extends AbstractPropertyValue {
  constructor(place: Place, property: ContactProperty, prefix: string, value: string) {
    super(place, property, prefix, value);
  }
  
  protected override doValidation(): string | undefined {
    const requiredProperties = Config.getRequiredColumns(this.place.type, this.place.isReplacement);
    const hasGeneratedProperty = this.property.type === 'generated';

    let valueToValidate = this.original;
    if (hasGeneratedProperty) {
      this.formattedValue = Validation.generateAfterInitialization(this.place, this.property) || '';
      valueToValidate = this.formattedValue;
    }
    
    return Validation.validateProperty(valueToValidate, this.property, requiredProperties);
  }
}

export class HierarchyPropertyValue extends AbstractPropertyValue {
  constructor(place: Place, property: HierarchyConstraint, prefix: string, value: string) {
    super(place, property, prefix, value);
  }

  protected override doValidation(): string | undefined {
    return Validation.validateHierarchyLevel(this.place, this.property as HierarchyConstraint);
  }
}

export class SupersetPropertyValue extends AbstractPropertyValue {
  constructor(place: Place, property: SupersetConfig, prefix: string, value: string) {
    super(place, property, prefix, value);
  }

  protected override doValidation(): string | undefined {
    return Validation.validateSupersetConfig(this.place, this.property as SupersetConfig);
  }
}
