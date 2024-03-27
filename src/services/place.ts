import _ from 'lodash';
import Contact from './contact';
import { v4 as uuidv4 } from 'uuid';

import { Config, ContactProperty, ContactType } from '../config';
import { PlacePayload, RemotePlace } from '../lib/cht-api';
import { Validation } from '../lib/validation';
// can't use package.json because of rootDir in ts
import { version as appVersion } from '../package.json';
import RemotePlaceResolver from '../lib/remote-place-resolver';
import { DateTime } from 'luxon';
import { ValidatorDateOfBirth } from '../lib/validator-dob';

export type UserCreationDetails = {
  username?: string;
  password?: string;
  placeId?: string;
  contactId?: string;
};

export enum PlaceUploadState {
  SUCCESS = 'success',
  FAILURE = 'failure',
  STAGED = 'staged',
  SCHEDULED = 'scheduled',
  IN_PROGRESS = 'in_progress',
}

const PLACE_PREFIX = 'place_';
const CONTACT_PREFIX = 'contact_';
const USER_PREFIX = 'user_';


export default class Place {
  public readonly id: string;
  public readonly type: ContactType;
  public readonly contact : Contact;
  public readonly creationDetails : UserCreationDetails = {};
  public readonly resolvedHierarchy: (RemotePlace | undefined)[];

  public properties: {
    name?: string;
    [key: string]: any;
  };

  public hierarchyProperties: {
    PARENT?: string;
    replacement?: string;
    [key: string]: any;
  };

  public userRoleProperties: {
    [key: string]: any;
  };

  public state : PlaceUploadState;

  public validationErrors?: { [key: string]: string };
  public uploadError? : string;

  private optionalInputs: {
    [key: string]: any;
  }

  constructor(type: ContactType) {
    this.id = uuidv4();
    this.type = type;
    this.contact = new Contact(type);
    this.properties = {};
    this.hierarchyProperties = {};
    this.state = PlaceUploadState.STAGED;
    this.resolvedHierarchy = [];
    this.userRoleProperties = {};
    this.optionalInputs = {};
  }

  /*
  Map form data onto a place's properties
  FormData for a place has the expected format `place_${property_name}`.
  */
  public setPropertiesFromFormData(formData: any, hierarchyPrefix: string): void {
    const getPropertySetWithPrefix = (expectedProperties: ContactProperty[], prefix: string): any => {
      const propertiesInDataFormat = expectedProperties.map(p => prefix + p.property_name);
      const relevantData = _.pick(formData, propertiesInDataFormat);
      return Object.keys(relevantData).reduce((agg, key) => {
        const keyWithoutPrefix = key.substring(prefix.length);
        return { ...agg, [keyWithoutPrefix]: relevantData[key] };
      }, {});
    };

    this.properties = {
      ...this.properties,
      ...getPropertySetWithPrefix(this.type.place_properties, PLACE_PREFIX),
    };
    this.contact.properties = {
      ...this.contact.properties,
      ...getPropertySetWithPrefix(this.type.contact_properties, CONTACT_PREFIX),
    };    
    Object.keys(formData).filter(k => k.startsWith('option_')).forEach(k => {
      this.optionalInputs[k] = formData[k];
    });

    for (const hierarchyLevel of Config.getHierarchyWithReplacement(this.type)) {
      const propertyName = hierarchyLevel.property_name;
      this.hierarchyProperties[propertyName] = formData[`${hierarchyPrefix}${propertyName}`] ?? '';
    }

    if (Config.hasMultipleRoles(this.type)) {
      const userRoleConfig = Config.getUserRoleConfig(this.type);
      const propertyName = userRoleConfig.property_name;
      const roleFormData = formData[`${USER_PREFIX}${propertyName}`];
      
      // When multiple are selected, the form data is an array
      if (Array.isArray(roleFormData)) {
        this.userRoleProperties[propertyName] = roleFormData.join(' ');
      } else {
        this.userRoleProperties[propertyName] = roleFormData;
      }
    }
  }

  /**
   * When form submissions fail, the failing form data is posted to a route
   * That data is fed back into the view so the user inputs are not lost.
   * To keep views simple and provide default values when editing, we can express a form in its form data
   */
  public asFormData(hierarchyPrefix: string): any {
    const addPrefixToPropertySet = (properties: any, prefix: string): any => {
      const result: any = {};
      for (const key of Object.keys(properties)) {
        const keyWithPrefix: string = prefix + key;
        result[keyWithPrefix] = properties[key];
      }

      return result;
    };

    return {
      ...addPrefixToPropertySet(this.hierarchyProperties, hierarchyPrefix),
      ...addPrefixToPropertySet(this.properties, PLACE_PREFIX),
      ...addPrefixToPropertySet(this.contact.properties, CONTACT_PREFIX),
      ...addPrefixToPropertySet(this.userRoleProperties, USER_PREFIX),
      ...this.optionalInputs
    };
  }

  public asChtPayload(username: string): PlacePayload {
    const user_attribution = {
      tool: `cht-user-management-${appVersion}`,
      username,
      created_time: Date.now(),
      replacement: this.resolvedHierarchy[0],
    };

    const filteredProperties = (properties: any) => {
      if (!this.isReplacement) {
        return properties;
      }

      return Object.keys(properties).reduce((agg: any, key: string) => {
        const value = properties[key];
        if (value !== undefined && value !== '') {
          agg[key] = value;
        }
        return agg;
      }, {});
    };

    const buildContactProperties = (properties: any) => {
      const props = filteredProperties(properties);
      return Object.keys(props).reduce((acc: any, key: string) => {
        if (key === 'age') {
          const dobValidator = new ValidatorDateOfBirth();
          if (dobValidator.isValid(props[key])) {
            acc.date_of_birth = props[key];
          } else {
            const age: string[] = props[key].split(' ');
            acc.date_of_birth = DateTime.now()
              .minus({ years: parseInt(age[0]) })
              .toISODate();
          }
        } else {
          acc[key] = props[key];
        }
        return acc;
      }, {});
    };

    const contactAttributes = (contactType: string) => {
      const RESERVED_CONTACT_TYPES = ['district_hospital', 'health_center', 'clinic', 'person'];

      if (RESERVED_CONTACT_TYPES.includes(contactType)) {
        return { type: contactType };
      }

      return {
        type: 'contact',
        contact_type: contactType,
      };
    };
    return {
      ...filteredProperties(this.properties),
      ...contactAttributes(this.type.name),
      _id: this.isReplacement ? this.resolvedHierarchy[0]?.id : this.id,
      parent: this.resolvedHierarchy[1]?.id,
      user_attribution,
      contact: {
        ...buildContactProperties(this.contact.properties),
        ...contactAttributes(this.contact.type.contact_type),
        name: this.contact.name,
        user_attribution,
      }
    };
  }

  public asRemotePlace() : RemotePlace {
    const isHierarchyValid = !this.resolvedHierarchy.find(h => h?.type === 'invalid');
    if (!isHierarchyValid) {
      throw Error('Cannot call asRemotePlace on place with invalid hierarchy');
    }

    let lastKnownHierarchy = this.resolvedHierarchy.find(h => h) || RemotePlaceResolver.NoResult;
    let lastKnownIndex = 0;

    const lineage:string[] = [];
    for (let i = 1; i < this.resolvedHierarchy.length; i++) {
      const current = this.resolvedHierarchy[i];
      if (current) {
        lineage[i-1] = current.id;
        lastKnownHierarchy = current;
        lastKnownIndex = i;
      } else {
        lineage[i-1] = lastKnownHierarchy.lineage[i - lastKnownIndex - 1];
      }
    }

    return {
      id: this.id,
      name: this.name,
      type: this.isCreated ? 'remote' : 'local',
      lineage,
    };
  }

  public validate(): void {
    const errors = Validation.getValidationErrors(this);
    this.validationErrors = {};
    for (const error of errors) {
      this.validationErrors[error.property_name] = error.description;
    }
    
    Validation.format(this);
  }

  public generateUsername(): string {
    const propertySource = this.type.username_from_place ? this.properties : this.contact.properties;
    let username = propertySource.name || this.hierarchyProperties.replacement; // if name is not present, it must be a replacement
    username = username
      ?.replace(/[ ]/g, '_')
      ?.replace(/[^a-zA-Z0-9_]/g, '')
      ?.replace(/_+/g, '_')
      ?.toLowerCase();

    if (!username) {
      throw Error('username cannot be empty');
    }

    return username;
  }

  public get userRoles(): string[] {
    if (!Config.hasMultipleRoles(this.type)) {
      return this.type.user_role;
    }

    const userRoleConfig = Config.getUserRoleConfig(this.type);
    const roles = this.userRoleProperties[userRoleConfig.property_name];
    return roles.split(' ').map((role: string) => role.trim()).filter(Boolean);
  }

  public get hasValidationErrors() : boolean {
    return Object.keys(this.validationErrors as any).length > 0;
  }

  public get isDependant() : boolean {
    return !!this.resolvedHierarchy.find(hierarchy => hierarchy?.type === 'local');
  }

  public get name() : string {
    const nameProperty = Config.getPropertyWithName(this.type.place_properties, 'name');
    return this.properties[nameProperty.property_name];
  }

  public get isReplacement(): boolean {
    return !!this.hierarchyProperties.replacement;
  }

  public get isCreated(): boolean {
    return !!this.creationDetails.password;
  }
}
