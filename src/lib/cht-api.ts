import _ from 'lodash';
import { AxiosInstance } from 'axios';
import ChtSession from './cht-session';
import { Config, ContactType } from '../config';
import { DateTime } from 'luxon';
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

export class ChtApi {
  public readonly chtSession: ChtSession;
  private axiosInstance: AxiosInstance;

  constructor(session: ChtSession) {
    this.chtSession = session;
    this.axiosInstance = session.axiosInstance;
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

    const previousPrimaryContact = doc.contact?._id;
    Object.assign(doc, payloadClone, { contact: { _id: contactId }});
    doc.user_attribution ||= {};
    doc.user_attribution.previousPrimaryContacts ||= [];
    if (previousPrimaryContact) {
      doc.user_attribution.previousPrimaryContacts.push(previousPrimaryContact);
    }

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

  countContactsUnderPlace = async (docId: string): Promise<number> => {
    const url = `medic/_design/medic/_view/contacts_by_depth`;
    console.log('axios.get', url);
    const resp = await this.axiosInstance.get(url, {
      params: {
        startkey: JSON.stringify([docId, 0]),
        endkey: JSON.stringify([docId, 20]),
        include_docs: false,
      },
    });

    return resp.data?.rows?.length || 0;
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
    : Promise<any[]> => {
    const url = `medic/_design/medic-client/_view/contacts_by_type`;
    const params = {
      key: JSON.stringify([placeType]),
      include_docs: true,
    };
    console.log('axios.get', url, params);
    const resp = await this.axiosInstance.get(url, { params });
    return resp.data.rows.map((row: any) => row.doc);
  };

  getDoc = async (id: string): Promise<any> => {
    const url = `medic/${id}`;
    console.log('axios.get', url);
    const resp = await this.axiosInstance.get(url);
    return resp.data;
  };

  lastSyncAtPlace = async (placeId: string): Promise<DateTime> => {
    const userIds = await this.getUsersAtPlace(placeId);
    const result = await this.getLastSyncForUsers(userIds); 
    return result || DateTime.invalid('unknown');
  };

  private getLastSyncForUsers = async (usernames: string[]): Promise<DateTime | undefined> => {
    if (!usernames?.length) {
      return undefined;
    }

    const url = '/medic-logs/_all_docs';
    const keys = usernames.map(username => `connected-user-${username}`);
    const payload = {
      keys,
      include_docs: true,
    };

    console.log('axios.post', url);
    const resp = await this.axiosInstance.post(url, payload);
    const timestamps = resp.data?.rows?.map((row: any) => row.doc?.timestamp);

    if (!timestamps?.length) {
      return undefined;
    }

    const maxTimestamp = Math.max(timestamps);
    return DateTime.fromMillis(maxTimestamp);
  };

  private async getUsersAtPlace(placeId: string): Promise<string[]> {
    const url = `_users/_find`;
    const payload = {
      selector: {
        $or: [
          { facility_id: placeId },
          {
            facility_id: {
              $elemMatch: { $eq: placeId }
            },
          },
        ]
      },
    };

    console.log('axios.post', url);
    const resp = await this.axiosInstance.post(url, payload);
    return resp.data?.docs?.map((d: any) => d.name);
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

