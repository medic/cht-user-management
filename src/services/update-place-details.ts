import _ from 'lodash';

import { ChtApi } from '../lib/cht-api';
import { ContactProperty, ContactType } from '../config';
import Place, { CONTACT_PREFIX, FormattedPropertyCollection, PLACE_PREFIX, USER_PREFIX } from './place';
import RemotePlaceCache from '../lib/remote-place-cache';
import ExternalIdentity from './external-identity';
// can't use package.json because of rootDir in ts
import { version as appVersion } from '../package.json';

const HIERARCHY_PREFIX = 'hierarchy_';

// the value a property held on the doc, which is not guaranteed to be a string (eg. a numeric code)
export type PropertyValue = string | number | boolean | null;

// what happened to one property: the value it held before the edit and the value it was set to. A
// `current` of `null` removes the attribute from the doc, and a `previous` of `null` means it was
// not on the doc to begin with
export type PropertyChange = {
  previous: PropertyValue;
  current: string | boolean | null;
};

// the properties which were written, keyed by property name
export type PropertyChanges = {
  [property_name: string]: PropertyChange;
};

export type UpdatePlaceDetailsResult = {
  success: true;
  place_id: string;
  contact_id?: string;
  place: PropertyChanges;
  contact: PropertyChanges;
} | {
  success: false;
  errors: { [propertyNameWithPrefix: string]: string };
};

type EditableDoc = {
  doc: any;
  values: FormattedPropertyCollection;
  properties: ContactProperty[];
};

/**
 * Updates the place and contact property values of a place which already exists on the CHT instance
 */
export class UpdatePlaceDetails {
  public static async update(
    placeId: string,
    contactType: ContactType,
    formData: any,
    chtApi: ChtApi
  ): Promise<UpdatePlaceDetailsResult> {
    this.assertNoGeneratedLineage(contactType);
    
    const placeDoc = await this.fetchPlaceDoc(placeId, chtApi);
    this.assertContactType(placeDoc, contactType);

    const contactId = placeDoc.contact?._id ?? placeDoc.contact;
    if (!contactId) {
      throw new Error(`place "${placeId}" has no primary contact to update`);
    }

    const contactDoc = await chtApi.getDoc(contactId);
    const place = this.buildPlace(contactType, placeDoc, contactDoc, formData);

    const errors = this.validate(place);
    if (errors) {
      return { success: false, errors };
    }
    
    const editables: EditableDoc[] = [
      { doc: contactDoc, values: place.contact.properties, properties: contactType.contact_properties },
      { doc: placeDoc, values: place.properties, properties: contactType.place_properties },
    ];
    const [contactChanges, placeChanges] = editables.map(editable => this.diff(editable));
    Object.assign(placeChanges, this.externalIdentityChange(placeDoc, place));

    let contactWritten = false;
    try {
      if (Object.keys(contactChanges).length) {
        await this.writeDocWithAttribution(contactDoc, contactChanges, chtApi);
        contactWritten = true;
      }

      if (Object.keys(placeChanges).length) {
        await this.writeDocWithAttribution(placeDoc, placeChanges, chtApi);
        RemotePlaceCache.updateFromDoc(chtApi, contactType, placeDoc);
      }
    } catch (e: any) {
      const reason = e.response?.data?.error?.message ?? e.message ?? String(e);
      const partial = contactWritten ? ` (the contact "${contactId}" was already updated)` : '';
      throw new Error(`failed to update place "${placeId}": ${reason}${partial}`);
    }

    return {
      success: true,
      place_id: placeId,
      contact_id: contactId,
      place: placeChanges,
      contact: contactChanges,
    };
  }

  private static async fetchPlaceDoc(placeId: string, chtApi: ChtApi): Promise<any> {
    try {
      const doc = await chtApi.getDoc(placeId);
      if (!doc?._id) {
        throw new Error(`place "${placeId}" was not found on this instance`);
      }
      return doc;
    } catch (e: any) {
      if (e?.response?.status === 404) {
        throw new Error(`place "${placeId}" was not found on this instance`);
      }
      throw e;
    }
  }

  // The caller declares which type of place they are editing and the doc must agree
  private static assertContactType(placeDoc: any, contactType: ContactType): void {
    const typeName = placeDoc.contact_type ?? placeDoc.type;
    if (typeName !== contactType.name) {
      throw new Error(`place "${placeDoc._id}" is of type "${typeName}", not "${contactType.name}"`);
    }
  }

  /**
   * A `generated` property is recalculated from the values which may have just changed, but one
   * whose template reads from `lineage` cannot be: the hierarchy is empty here. Regenerating
   * chis-tg's `"{{ contact.last_name }} {{ contact.first_name }} ({{ lineage.followup_area }})"`
   * would rewrite the name with the lineage dropped
   */
  private static assertNoGeneratedLineage(contactType: ContactType): void {
    const allProperties = [...contactType.place_properties, ...contactType.contact_properties];
    const readsLineage = allProperties.find(property => (
      property.type === 'generated' && /\blineage\b/.test(String(property.parameter))
    ));

    if (readsLineage) {
      throw new Error(
        `cannot edit "${contactType.name}": the generated property "${readsLineage.property_name}" is built from ` +
        `the hierarchy, which is not resolved here`
      );
    }
  }

  /**
   * Seeds a Place with the values already on the instance and layers the requested edits on top
   */
  private static buildPlace(contactType: ContactType, placeDoc: any, contactDoc: any, formData: any): Place {
    const seed = (doc: any, properties: ContactProperty[], prefix: string) => properties.reduce((agg: any, property) => {
      const key = prefix + property.property_name;
      agg[key] = formData[key] ?? asString(doc?.[property.property_name]);
      return agg;
    }, {});

    const place = new Place(contactType);
    place.setPropertiesFromFormData({
      ...ExternalIdentity.pickFrom(formData),
      ...seed(placeDoc, contactType.place_properties, PLACE_PREFIX),
      ...seed(contactDoc, contactType.contact_properties, CONTACT_PREFIX),
    }, HIERARCHY_PREFIX);

    return place;
  }

  /**
   * `hierarchy_` and `user_` properties are dropped. This endpoint edits neither the hierarchy nor
   * the user, and neither is in the payload, so there is nothing there to report on.
   */
  private static validate(place: Place): { [key: string]: string } | undefined {
    place.validate();

    const isOutOfScope = (key: string) => key.startsWith(HIERARCHY_PREFIX) || key.startsWith(USER_PREFIX);
    const errors = _.omitBy(place.validationErrors ?? {}, (error, key) => isOutOfScope(key));
    return Object.keys(errors).length ? errors as { [key: string]: string } : undefined;
  }

  /**
   * The change to who owns the place, which unlike a create is also able to release it: `null`
   * removes the attribute. A place whose claim was never mentioned is left as it is, so an
   * unrelated edit never changes ownership.
   */
  private static externalIdentityChange(placeDoc: any, place: Place): PropertyChanges {
    const claim = place.externalIdentity;
    const attributeName = ExternalIdentity.attributeName();
    if (claim === undefined || !attributeName) {
      return {};
    }

    const previous = placeDoc[attributeName] ?? null;
    return claim === previous ? {} : { [attributeName]: { previous, current: claim } };
  }

  /**
   * The fields to write: every property whose validated value differs from what is on the doc
   */
  private static diff({ doc, values, properties }: EditableDoc): PropertyChanges {
    const changes: PropertyChanges = {};
    for (const property of properties) {
      const propertyName = property.property_name;
      const validated = values[propertyName]?.formatted ?? '';
      if (validated !== asString(doc[propertyName])) {
        changes[propertyName] = { previous: asPropertyValue(doc[propertyName]), current: validated };
      }
    }

    return changes;
  }

  private static async writeDocWithAttribution(doc: any, changes: PropertyChanges, chtApi: ChtApi): Promise<void> {
    for (const [propertyName, { current }] of Object.entries(changes)) {
      if (current === null) {
        delete doc[propertyName];
      } else {
        doc[propertyName] = current;
      }
    }

    doc.user_attribution ||= {};
    doc.user_attribution.edits ||= [];
    doc.user_attribution.edits.push({
      tool: `cht-user-management-${appVersion}`,
      username: chtApi.chtSession.username,
      edited_time: Date.now(),
      changes,
    });

    await chtApi.setDoc(doc._id, doc);
  }
}

// the value as it is on the doc, kept as it is so the audit trail reports what was really there
function asPropertyValue(value: unknown): PropertyValue {
  if (value === undefined || value === null) {
    return null;
  }

  return typeof value === 'object' ? asString(value) : value as PropertyValue;
}

// doc values are not guaranteed to be strings (eg. a numeric code) but property values are
function asString(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }

  return typeof value === 'object' ? '' : String(value);
}
