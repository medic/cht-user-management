import _ from 'lodash';
import { AxiosInstance } from 'axios';
import * as semver from 'semver';

import ChtSession from './cht-session';
import { Config, ContactType } from '../config';
import { UserPayload } from '../services/user-payload';

export type PlacePayload = {
  name: string;
  type: string;
  contact_type: string;
  contact: {
    name: string;
    type: string;
    contact_type: string;
    [key: string]: any;
  };
  parent?: string;
  [key: string]: any;
};

export type RemotePlace = {
  id: string;
  name: string;
  lineage: string[];
  ambiguities?: RemotePlace[];

  // sadly, sometimes invalid or uncreated objects "pretend" to be remote
  // should reconsider this naming
  type: 'remote' | 'local' | 'invalid';
};

export type CreatedPlaceResult = {
  placeId: string;
  contactId?: string;
};

export class ChtApi {
  protected axiosInstance: AxiosInstance;
  private session: ChtSession;
  private version: string;

  protected constructor(session: ChtSession) {
    this.session = session;
    this.axiosInstance = session.axiosInstance;
    this.version = 'base';
  }

  public static create(chtSession: ChtSession): ChtApi {
    let result;
    const coercedVersion = semver.valid(semver.coerce(chtSession.chtCoreVersion));
    if (!coercedVersion) {
      throw Error(`invalid cht core version "${chtSession.chtCoreVersion}"`);
    }

    if (semver.gte(coercedVersion, '4.7.0') || chtSession.chtCoreVersion === '4.6.0-local-development') {
      result = new ChtApi_4_7(chtSession);
      result.version = '4.7';
    } else if (semver.gte(coercedVersion, '4.6.0')) {
      result = new ChtApi_4_6(chtSession);
      result.version = '4.6';
    } else {
      result = new ChtApi(chtSession);
    }
  
    return result;
  }

  // workaround https://github.com/medic/cht-core/issues/8674
  async updateContactParent(parentId: string): Promise<string> {
    const parentDoc = await this.getDoc(parentId);
    const contactId = parentDoc?.contact?._id;
    if (!contactId) {
      throw Error('cannot find id of contact');
    }

    const contactDoc = await this.getDoc(contactId);
    if (!contactDoc || !parentDoc) {
      throw Error('cannot find parent or contact docs');
    }

    contactDoc.parent = minify(parentDoc);

    const putUrl = `medic/${contactId}`;
    console.log('axios.put', putUrl);
    const putResp = await this.axiosInstance.put(putUrl, contactDoc);
    if (putResp.status !== 201) {
      throw new Error(putResp.data);
    }

    return contactDoc._id;
  }

  async createPlace(payload: PlacePayload): Promise<CreatedPlaceResult> {
    const url = `api/v1/places`;
    console.log('axios.post', url);
    const resp = await this.axiosInstance.post(url, payload);
    return {
      placeId: resp.data.id,
      contactId: resp.data.contact?.id,
    };
  }

  // because there is no PUT for /api/v1/places
  async createContact(payload: PlacePayload): Promise<string> {
    const payloadWithPlace = {
      ...payload.contact,
      place: payload._id,
    };

    const url = `api/v1/people`;
    console.log('axios.post', url);
    const resp = await this.axiosInstance.post(url, payloadWithPlace);
    return resp.data.id;
  }

  async updatePlace(payload: PlacePayload, contactId: string): Promise<any> {
    const doc: any = await this.getDoc(payload._id);

    const payloadClone:any = _.cloneDeep(payload);
    delete payloadClone.contact;
    delete payloadClone.parent;

    const previousPrimaryContact = doc.contact._id;
    Object.assign(doc, payloadClone, { contact: { _id: contactId }});
    doc.user_attribution ||= {};
    doc.user_attribution.previousPrimaryContacts ||= [];
    doc.user_attribution.previousPrimaryContacts.push(previousPrimaryContact);

    const putUrl = `medic/${payload._id}`;
    console.log('axios.put', putUrl);
    const resp = await this.axiosInstance.put(putUrl, doc);
    if (!resp.data.ok) {
      throw Error('response from chtApi.updatePlace was not OK');
    }

    return doc;
  }

  async deleteDoc(docId: string): Promise<void> {
    const doc: any = await this.getDoc(docId);

    const deleteContactUrl = `medic/${doc._id}?rev=${doc._rev}`;
    console.log('axios.delete', deleteContactUrl);
    const resp = await this.axiosInstance.delete(deleteContactUrl);
    if (!resp.data.ok) {
      throw Error('response from chtApi.deleteDoc was not OK');
    }
  }

  async disableUsersWithPlace(placeId: string): Promise<string[]> {
    const usersToDisable: string[] = await this.getUsersAtPlace(placeId);
    for (const userDocId of usersToDisable) {
      await this.disableUser(userDocId);
    }
    return usersToDisable;
  }

  async deactivateUsersWithPlace(placeId: string): Promise<string[]> {
    const usersToDeactivate: string[] = await this.getUsersAtPlace(placeId);
    for (const userDocId of usersToDeactivate) {
      await this.deactivateUser(userDocId);
    }
    return usersToDeactivate;
  }

  async createUser(user: UserPayload): Promise<void> {
    const url = `api/v1/users`;
    console.log('axios.post', url);
    const axiosRequestionConfig = {
      'axios-retry': { retries: 0 }, // upload-manager handles retries for this
    };
    await this.axiosInstance.post(url, user, axiosRequestionConfig);
  }

  async getParentAndSibling(parentId: string, contactType: ContactType): Promise<{ parent: any; sibling: any }> {
    const url = `medic/_design/medic/_view/contacts_by_depth`;
    console.log('axios.get', url);
    const resp = await this.axiosInstance.get(url, {
      params: {
        keys: JSON.stringify([
          [parentId, 0],
          [parentId, 1]
        ]),
        include_docs: true,
      },
    });
    const docs = resp.data?.rows?.map((row: any) => row.doc) || [];
    const parentType = Config.getParentProperty(contactType).contact_type;
    const parent = docs.find((d: any) => d.contact_type === parentType);
    const sibling = docs.find((d: any) => d.contact_type === contactType.name);
    return { parent, sibling };
  }

  public async getPlacesWithType(placeType: string)
    : Promise<RemotePlace[]> {
    const url = `medic/_design/medic-client/_view/contacts_by_type_freetext`;
    const params = {
      startkey: JSON.stringify([ placeType, 'name:']),
      endkey: JSON.stringify([ placeType, 'name:\ufff0']),
      include_docs: true,
    };
    console.log('axios.get', url, params);
    const resp = await this.axiosInstance.get(url, { params });

    return resp.data.rows
      .map((row: any): RemotePlace => {
        const nameData = row.key[1];
        return {
          id: row.id,
          name: nameData.substring('name:'.length),
          lineage: extractLineage(row.doc),
          type: 'remote',
        };
      });
  }

  public get chtSession(): ChtSession {
    return this.session.clone();
  }

  public get coreVersion(): string {
    return this.version;
  }

  protected async getUsersAtPlace(placeId: string): Promise<string[]> {
    const url = `_users/_find`;
    const payload = {
      selector: {
        facility_id: placeId,
      },
    };

    console.log('axios.post', url);
    const resp = await this.axiosInstance.post(url, payload);
    return resp.data?.docs?.map((d: any) => d._id);
  }

  private async getDoc(id: string): Promise<any> {
    const url = `medic/${id}`;
    console.log('axios.get', url);
    const resp = await this.axiosInstance.get(url);
    return resp.data;
  }

  private async deactivateUser(docId: string): Promise<void> {
    const username = docId.substring('org.couchdb.user:'.length);
    const url = `api/v1/users/${username}`;
    console.log('axios.post', url);
    const deactivationPayload = { roles: ['deactivated' ]};
    return this.axiosInstance.post(url, deactivationPayload);
  }

  private async disableUser(docId: string): Promise<void> {
    const username = docId.substring('org.couchdb.user:'.length);
    const url = `api/v1/users/${username}`;
    console.log('axios.delete', url);
    return this.axiosInstance.delete(url);
  }
}

class ChtApi_4_6 extends ChtApi {
  public constructor(session: ChtSession) {
    super(session);
  }

  // #8674: assign parent place to new contacts
  public override updateContactParent = async (): Promise<string> => {
    throw Error(`program should never update contact's parent after cht-core 4.6`);
  };
}

class ChtApi_4_7 extends ChtApi_4_6 {
  public constructor(session: ChtSession) {
    super(session);
  }

  // #8877: Look up users from their facility_id or contact_id
  protected override async getUsersAtPlace(placeId: string): Promise<string[]> {
    const url = `api/v2/users?facility_id=${placeId}`;
    console.log('axios.get', url);
    const resp = await this.axiosInstance.get(url);
    return resp.data?.map((d: any) => d.id);
  }
}

function minify(doc: any): any {
  if (!doc) {
    return;
  }

  return {
    _id: doc._id,
    parent: minify(doc.parent),
  };
}

function extractLineage(doc: any): string[] {
  if (doc?.parent?._id) {
    return [doc.parent._id, ...extractLineage(doc.parent)];
  }

  return [];
}
