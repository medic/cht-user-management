import _ from 'lodash';
import axios from 'axios';
import { UserPayload } from '../services/user-payload';
import { Config, ContactType } from '../config';
import ChtSession from './cht-session';

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

export class ChtApi {
  private session: ChtSession;
  private protocolAndHost: string;

  constructor(session: ChtSession) {
    this.session = session;
    this.protocolAndHost = `http${session.authInfo.useHttp ? '' : 's'}://${session.authInfo.domain}`;
  }

  public get chtSession(): ChtSession {
    return this.session.clone();
  }

  // workaround https://github.com/medic/cht-core/issues/8674
  updateContactParent = async (parentId: string): Promise<string> => {
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

    const putUrl = `${this.protocolAndHost}/medic/${contactId}`;
    console.log('axios.put', putUrl);
    const putResp = await axios.put(putUrl, contactDoc, this.authorizationOptions());
    if (putResp.status !== 201) {
      throw new Error(putResp.data);
    }

    return contactDoc._id;
  };

  createPlace = async (payload: PlacePayload): Promise<string> => {
    const url = `${this.protocolAndHost}/api/v1/places`;
    console.log('axios.post', url);
    const resp = await axios.post(url, payload, this.authorizationOptions());
    return resp.data.id;
  };

  // because there is no PUT for /api/v1/places
  createContact = async (payload: PlacePayload): Promise<string> => {
    const url = `${this.protocolAndHost}/api/v1/people`;
    console.log('axios.post', url);
    const resp = await axios.post(url, payload.contact, this.authorizationOptions());
    return resp.data.id;
  };

  updatePlace = async (payload: PlacePayload, contactId: string): Promise<any> => {
    const doc: any = await this.getDoc(payload._id);

    const payloadClone:any = _.cloneDeep(payload);
    delete payloadClone.contact;
    delete payloadClone.parent;

    const previousPrimaryContact = doc.contact._id;
    Object.assign(doc, payloadClone, { contact: { _id: contactId }});
    doc.user_attribution ||= {};
    doc.user_attribution.previousPrimaryContacts ||= [];
    doc.user_attribution.previousPrimaryContacts.push(previousPrimaryContact);

    const putUrl = `${this.protocolAndHost}/medic/${payload._id}`;
    console.log('axios.put', putUrl);
    const resp = await axios.put(putUrl, doc, this.authorizationOptions());
    if (!resp.data.ok) {
      throw Error('response from chtApi.updatePlace was not OK');
    }

    return doc;
  };

  deleteDoc = async (docId: string): Promise<void> => {
    const doc: any = await this.getDoc(docId);

    const deleteContactUrl = `${this.protocolAndHost}/medic/${doc._id}?rev=${doc._rev}`;
    console.log('axios.delete', deleteContactUrl);
    const resp = await axios.delete(deleteContactUrl, this.authorizationOptions());
    if (!resp.data.ok) {
      throw Error('response from chtApi.deleteDoc was not OK');
    }
  };

  disableUsersWithPlace = async (placeId: string): Promise<string[]> => {
    const usersToDisable: string[] = await this.getUsersAtPlace(placeId);
    for (const userDocId of usersToDisable) {
      await this.disableUser(userDocId);
    }
    return usersToDisable;
  };

  disableUser = async (docId: string): Promise<void> => {
    const username = docId.substring('org.couchdb.user:'.length);
    const url = `${this.protocolAndHost}/api/v1/users/${username}`;
    console.log('axios.delete', url);
    return axios.delete(url, this.authorizationOptions());
  };

  deactivateUsersWithPlace = async (placeId: string): Promise<string[]> => {
    const usersToDeactivate: string[] = await this.getUsersAtPlace(placeId);
    for (const userDocId of usersToDeactivate) {
      await this.deactivateUser(userDocId);
    }
    return usersToDeactivate;
  };

  deactivateUser = async (docId: string): Promise<void> => {
    const username = docId.substring('org.couchdb.user:'.length);
    const url = `${this.protocolAndHost}/api/v1/users/${username}`;
    console.log('axios.post', url);
    const deactivationPayload = { roles: ['deactivated' ]};
    return axios.post(url, deactivationPayload, this.authorizationOptions());
  };

  createUser = async (user: UserPayload): Promise<void> => {
    const url = `${this.protocolAndHost}/api/v1/users`;
    console.log('axios.post', url);
    const axiosRequestionConfig = {
      ...this.authorizationOptions(),
      'axios-retry': { retries: 0 }, // upload-manager handles retries for this
    };
    await axios.post(url, user, axiosRequestionConfig);
  };

  getParentAndSibling = async (parentId: string, contactType: ContactType): Promise<{ parent: any; sibling: any }> => {
    const url = `${this.protocolAndHost}/medic/_design/medic/_view/contacts_by_depth`;
    console.log('axios.get', url);
    const resp = await axios.get(url, {
      ...this.authorizationOptions(),
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
  };

  getPlacesWithType = async (placeType: string)
    : Promise<RemotePlace[]> => {
    const url = `${this.protocolAndHost}/medic/_design/medic-client/_view/contacts_by_type_freetext`;
    const params = {
      startkey: JSON.stringify([ placeType, 'name:']),
      endkey: JSON.stringify([ placeType, 'name:\ufff0']),
      include_docs: true,
    };
    console.log('axios.get', url, params);
    const resp = await axios.get(url, {
      params,
      ...this.authorizationOptions(),
    });

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
  };

  getDoc = async (id: string): Promise<any> => {
    const url = `${this.protocolAndHost}/medic/${id}`;
    console.log('axios.get', url);
    const resp = await axios.get(url, this.authorizationOptions());
    return resp.data;
  };

  private async getUsersAtPlace(placeId: string): Promise<string[]> {
    // #76 mm-online users cant query _users db after core4.4
    const url = `${this.protocolAndHost}/medic/_find`;
    const payload = {
      selector: {
        type: 'user-settings',
        facility_id: placeId,
        $or: [
          { inactive: false },
          { inactive: { $exists: false } }
        ]
      },
    };

    console.log('axios.post', url);
    const resp = await axios.post(url, payload, this.authorizationOptions());
    return resp.data?.docs?.map((d: any) => d._id);
  }

  private authorizationOptions(): any {
    return {
      headers: { Cookie: this.session.sessionToken },
    };
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
