import _ from 'lodash';
import ChtSession from './cht-session';
import { Config, ContactType } from '../config';
import { UserPayload } from '../services/user-payload';
import { AxiosInstance } from 'axios';

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
  private axiosInstance: AxiosInstance;

  constructor(session: ChtSession) {
    this.session = session;
    this.axiosInstance = session.axiosInstance;
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

    const putUrl = `medic/${contactId}`;
    console.log('axios.put', putUrl);
    const putResp = await this.axiosInstance.put(putUrl, contactDoc);
    if (putResp.status !== 201) {
      throw new Error(putResp.data);
    }

    return contactDoc._id;
  };

  createPlace = async (payload: PlacePayload): Promise<string> => {
    const url = `api/v1/places`;
    console.log('axios.post', url);
    const resp = await this.axiosInstance.post(url, payload);
    return resp.data.id;
  };

  // because there is no PUT for /api/v1/places
  createContact = async (payload: PlacePayload): Promise<string> => {
    const url = `api/v1/people`;
    console.log('axios.post', url);
    const resp = await this.axiosInstance.post(url, payload.contact);
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

    const putUrl = `medic/${payload._id}`;
    console.log('axios.put', putUrl);
    const resp = await this.axiosInstance.put(putUrl, doc);
    if (!resp.data.ok) {
      throw Error('response from chtApi.updatePlace was not OK');
    }

    return doc;
  };

  deleteDoc = async (docId: string): Promise<void> => {
    const doc: any = await this.getDoc(docId);

    const deleteContactUrl = `medic/${doc._id}?rev=${doc._rev}`;
    console.log('axios.delete', deleteContactUrl);
    const resp = await this.axiosInstance.delete(deleteContactUrl);
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
    const url = `api/v1/users/${username}`;
    console.log('axios.delete', url);
    return this.axiosInstance.delete(url);
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
    const url = `api/v1/users/${username}`;
    console.log('axios.post', url);
    const deactivationPayload = { roles: ['deactivated' ]};
    return this.axiosInstance.post(url, deactivationPayload);
  };

  createUser = async (user: UserPayload): Promise<void> => {
    const url = `api/v1/users`;
    console.log('axios.post', url);
    const axiosRequestionConfig = {
      'axios-retry': { retries: 0 }, // upload-manager handles retries for this
    };
    await this.axiosInstance.post(url, user, axiosRequestionConfig);
  };

  getParentAndSibling = async (parentId: string, contactType: ContactType): Promise<{ parent: any; sibling: any }> => {
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
  };

  getPlacesWithType = async (placeType: string)
    : Promise<RemotePlace[]> => {
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
  };

  getDoc = async (id: string): Promise<any> => {
    const url = `medic/${id}`;
    console.log('axios.get', url);
    const resp = await this.axiosInstance.get(url);
    return resp.data;
  };

  private async getUsersAtPlace(placeId: string): Promise<string[]> {
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
