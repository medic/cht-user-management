import { Liquid } from 'liquidjs';
import { IValidator } from './validation';
import { ContactProperty } from '../config';

const engine = new Liquid({
  strictVariables: true,
});

export default class ValidatorGenerated implements IValidator {
  isValid(input: string, property : ContactProperty) : boolean | string {
    const parameter = this.getParameter(property);
    return engine.parse(parameter)?.length > 0;
  }

  format(scope : any, property : ContactProperty) : string {
    const parameter = this.getParameter(property);
    return engine.parseAndRenderSync(parameter, scope);
  }

  get defaultError(): string {
    return `Template cannot be genereated`;
  }

  private getParameter(property: ContactProperty) {
    const parameter = property.parameter;
    if (typeof parameter !== 'string') {
      throw Error(`Attribute "parameter" on '${property.property_name}' has type 'generated'. Expects string (eg. "{{ contact.name }} Area").`);
    }
    return parameter;
  }
}
