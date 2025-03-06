import _ from 'lodash';
import { v4 as uuidv4 } from 'uuid';

import { Config, ContactProperty, ContactType } from '../config';
import Contact from './contact';
import { ContactPropertyValue, HierarchyPropertyValue, IPropertyValue, RemotePlacePropertyValue } from '../property-value';
import { PlacePayload } from '../lib/cht-api';
// can't use package.json because of rootDir in ts
import { RemotePlace } from '../lib/remote-place-cache';
import RemotePlaceResolver from '../lib/remote-place-resolver';
import { version as appVersion } from '../package.json';

export type FormattedPropertyCollection = {
  [key: string]: IPropertyValue;
};

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

  public properties: FormattedPropertyCollection;
  public hierarchyProperties: FormattedPropertyCollection;
  public userRoleProperties: FormattedPropertyCollection;
  public warnings: string[];

  public state : PlaceUploadState;

  public validationErrors?: { [key: string]: string };
  public uploadError? : string;

  constructor(type: ContactType) {
    this.id = uuidv4();
    this.type = type;
    this.contact = new Contact(type);
    this.properties = {};
    this.hierarchyProperties = {};
    this.state = PlaceUploadState.STAGED;
    this.resolvedHierarchy = [];
    this.warnings = [];
    this.userRoleProperties = {};
  }

  /*
  Map form data onto a place's properties
  FormData for a place has the expected format `place_${property_name}`.
  */
  public setPropertiesFromFormData(formData: any, hierarchyPrefix: string): void {
    const getPropertySetWithPrefix = (expectedProperties: ContactProperty[], prefix: string): FormattedPropertyCollection => {
      const result: FormattedPropertyCollection = {};
      for (const property of expectedProperties) {
        const dataFormat = prefix + property.property_name;
        result[property.property_name] = new ContactPropertyValue(this, property, prefix, formData[dataFormat]);
      }
      return result;
    };

    for (const hierarchyLevel of Config.getHierarchyWithReplacement(this.type)) {
      const propertyName = hierarchyLevel.property_name;
      const hierarchyValue = formData[`${hierarchyPrefix}${propertyName}`] ?? '';

      // validation of hierachies requires RemotePlaceResolver to do its thing
      // at this point; these may report errors but that's ok as long as hierarchy properties are revalidated later 
      this.hierarchyProperties[propertyName] = new HierarchyPropertyValue(this, hierarchyLevel, hierarchyPrefix, hierarchyValue);
    }

    // place properties must be set after hierarchy constraints since validation logic is dependent on isReplacement
    this.properties = {
      ...this.properties,
      ...getPropertySetWithPrefix(this.type.place_properties, PLACE_PREFIX),
    };

    this.contact.properties = {
      ...this.contact.properties,
      ...getPropertySetWithPrefix(this.type.contact_properties, CONTACT_PREFIX),
    };

    if (Config.hasMultipleRoles(this.type)) {
      const userRoleConfig = Config.getUserRoleConfig(this.type);
      const propertyName = userRoleConfig.property_name;
      const roleFormData = formData[`${USER_PREFIX}${propertyName}`];

      // When multiple are selected, the form data is an array
      const userRoleValue = Array.isArray(roleFormData) ? roleFormData.join(' ') : roleFormData;
      this.userRoleProperties[propertyName] = new ContactPropertyValue(this, userRoleConfig, USER_PREFIX, userRoleValue);
    }
  }

  /**
   * When form submissions fail, the failing form data is posted to a route
   * That data is fed back into the view so the user inputs are not lost.
   * To keep views simple and provide default values when editing, we can express a form in its form data
   */
  public asFormData(hierarchyPrefix: string): any {
    const addPrefixToPropertySet = (properties: FormattedPropertyCollection, prefix: string): any => {
      const result: any = {};
      for (const key of Object.keys(properties)) {
        const keyWithPrefix: string = prefix + key;
        result[keyWithPrefix] = properties[key].original;
      }

      return result;
    };

    return {
      ...addPrefixToPropertySet(this.hierarchyProperties, hierarchyPrefix),
      ...addPrefixToPropertySet(this.properties, PLACE_PREFIX),
      ...addPrefixToPropertySet(this.contact.properties, CONTACT_PREFIX),
      ...addPrefixToPropertySet(this.userRoleProperties, USER_PREFIX),
    };
  }

  public asChtPayload(creator: string): PlacePayload {
    const user_attribution = {
      tool: `cht-user-management-${appVersion}`,
      username: creator,
      created_time: Date.now(),
      replacement: this.resolvedHierarchy[0]?.name.formatted,
      warnings: this.warnings,
    };

    const filteredProperties = (properties: FormattedPropertyCollection) => {
      return Object.keys(properties).reduce((agg: any, key: string) => {
        const value = properties[key]?.formatted;
        if (value !== undefined && value !== '') {
          agg[key] = value;
        }
        return agg;
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
        ...filteredProperties(this.contact.properties),
        ...contactAttributes(this.contact.type.contact_type),
        name: this.contact.name,
        user_attribution,
      }
    };
  }

  public asRemotePlace() : RemotePlace {
    const nameProperty = Config.getPropertyWithName(this.type.place_properties, 'name');
    return {
      id: this.id,
      name: new RemotePlacePropertyValue(this.name, nameProperty),
      placeType: this.type.name,
      type: this.isCreated ? 'remote' : 'local',
      uniquePlaceValues: this.getUniqueKeys(this.properties, this.type.place_properties),
      uniqueContactValues: this.getUniqueKeys(this.contact.properties, this.type.contact_properties),
      contactId: this.contact.id,
      stagedPlace: this,
      lineage: this.buildLineage(),
    };
  }

  public validate(): void {
    const validateCollection = (collection: FormattedPropertyCollection) => Object.values(collection).forEach(prop => prop.validate());
    // hierarchy properties need to revalidation after resolution
    validateCollection(this.hierarchyProperties);
    // contact properties need to be revalidated after generation
    validateCollection(this.properties);
    validateCollection(this.contact.properties);
    validateCollection(this.userRoleProperties);

    const extractErrorsFromCollection = (properties: FormattedPropertyCollection) => Object.values(properties).filter(prop => prop.validationError);
    const propertiesWithErrors: IPropertyValue[] = [
      ...extractErrorsFromCollection(this.properties),
      ...extractErrorsFromCollection(this.contact.properties),
      ...extractErrorsFromCollection(this.userRoleProperties),
      ...extractErrorsFromCollection(this.hierarchyProperties),
    ];

    this.validationErrors = {};
    for (const property of propertiesWithErrors) {
      this.validationErrors[property.propertyNameWithPrefix] = property.validationError as string;
    }
  }

  public generateUsername(): string {
    const propertySource = this.type.username_from_place ? this.properties : this.contact.properties;
    // if name is not present, it must be a replacement
    let username = propertySource.name?.formatted || this.hierarchyProperties.replacement?.formatted;
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
    if (!roles) {
      throw Error(`Place role data is required when multiple roles are available.`);
    }

    return roles.formatted.split(' ').map((role: string) => role.trim()).filter(Boolean);
  }

  public get hasValidationErrors() : boolean {
    return Object.keys(this.validationErrors as any).length > 0;
  }

  public get isDependant() : boolean {
    return !!this.resolvedHierarchy.find(hierarchy => hierarchy?.type === 'local');
  }

  public get name() : string {
    const nameProperty = Config.getPropertyWithName(this.type.place_properties, 'name');
    return this.properties[nameProperty.property_name]?.formatted;
  }

  public get isReplacement(): boolean {
    return !!this.hierarchyProperties.replacement?.original;
  }

  public get isCreated(): boolean {
    return !!this.creationDetails.password;
  }

  private buildLineage() {
    let lastKnownHierarchy = this.resolvedHierarchy.find(h => h) || RemotePlaceResolver.NoResult;
    let lastKnownIndex = 0;

    const lineage: string[] = [];
    for (let i = 1; i < this.resolvedHierarchy.length; i++) {
      const current = this.resolvedHierarchy[i];
      if (current && current.type !== 'invalid') {
        lineage[i - 1] = current.id;
        lastKnownHierarchy = current;
        lastKnownIndex = i;
      } else {
        lineage[i - 1] = lastKnownHierarchy.lineage[i - lastKnownIndex - 1];
      }
    }

    return lineage;
  }

  private getUniqueKeys(properties: FormattedPropertyCollection, place_properties: ContactProperty[]): FormattedPropertyCollection {
    const uniquePropertyNames = place_properties
      .filter(prop => prop.unique)
      .map(prop => prop.property_name);

    return _.pick(properties, uniquePropertyNames);
  }
}
