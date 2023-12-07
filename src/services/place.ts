import _ from "lodash";
import { ContactProperty, ContactType } from "../lib/config";
import Contact from "./contact";
import { v4 as uuidv4 } from "uuid";
import { PlacePayload, ParentDetails } from "../lib/cht-api";
import { Validation } from "../lib/validation";

export type UserCreationDetails = {
  username?: string;
  password?: string;
  placeId?: string;
  contactId?: string;
  disabledUsers?: string[];
};

export enum PlaceUploadState {
  SUCCESS = "success",
  FAILURE = "failure",
  PENDING = "pending",
  SCHEDULED = "scheduled",
  IN_PROGESS = "in_progress",
};

const PLACE_PREFIX = 'place_';
const CONTACT_PREFIX = 'contact_';

export default class Place {
  public readonly id: string;
  public readonly type: ContactType;
  public readonly contact : Contact;
  public readonly creationDetails : UserCreationDetails = {};
  
  public properties: {
    name?: string;
    PARENT?: string;
    replacement?: string;
    [key: string]: any;
  };
  public parentDetails?: ParentDetails;
  public replacement?: ParentDetails;
  public invalidProperties?: string[];
  public state : PlaceUploadState;

  constructor(type: ContactType) {
    this.id = uuidv4();
    this.type = type;
    this.contact = new Contact(type);
    this.properties = {};
    this.state = PlaceUploadState.PENDING;
  }

  /*
  Map form data onto a place's properties
  FormData for a place has the expected format `place_${doc_name}`. 
  */
  public setPropertiesFromFormData(formData: any): void {
    const getPropertySetWithPrefix = (expectedProperties: ContactProperty[], prefix: string): any => {
      const propertiesInDataFormat = expectedProperties.map(p => prefix + p.doc_name);
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

    delete this.properties.replacement;
    if (formData.place_replacement) {
      this.properties.replacement = formData.place_replacement;
    }
  }

  /**
   * When form submissions fail, the failing form data is posted to a route
   * That data is fed back into the view so the user inputs are not lost. 
   * To keep views simple and provide default values when editing, we can express a form in its form data 
   */
  public asFormData(): any {
    const addPrefixToPropertySet = (properties: any, prefix: string): any => {
      const result: any = {};
      for (const key of Object.keys(properties)) {
        const keyWithPrefix: string = prefix + key;
        result[keyWithPrefix] = properties[key];
      }

      return result;
    };

    return {
      ...addPrefixToPropertySet(this.properties, PLACE_PREFIX),
      ...addPrefixToPropertySet(this.contact.properties, CONTACT_PREFIX),
    };
  }

  public asChtPayload(): PlacePayload {
    return {
      ...this.properties,
      _id: this.replacementName ? this.replacement?.id : this.id,
      name: this.name,
      type: "contact",
      contact_type: this.type.name,
      parent: this.parentDetails?.id,
      contact: {
        ...this.contact.properties,
        name: this.contact.name,
        type: "contact",
        contact_type: this.contact.type.contact_type,
      },
    };
  };

  public asParentDetails() : ParentDetails {
    return {
      id: this.id,
      name: this.name,
    };
  }

  public validate(): void {
    this.invalidProperties = Validation.getInvalidProperties(this);
    Validation.format(this);
  }

  public get name() : string {
    const nameProperty = this.type.place_properties.find(p => p.doc_name === 'name');
    if (!nameProperty) {
      throw Error(`Place ${this.type.name} has no name property`);
    }

    return this.properties[nameProperty.doc_name];
  }

  public get parentName(): string | undefined {
    const parentProperty = this.type.place_properties.find(p => p.doc_name === "PARENT");
    if (!parentProperty) {
      throw Error(`Place ${this.type.name} has no PARENT property`);
    }

    return this.properties[parentProperty.doc_name];
  }

  public get replacementName(): string | undefined {
    return this.properties.replacement;
  }

  public get isCreated(): boolean {
    return !!this.creationDetails.password;
  }
};
