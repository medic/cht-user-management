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

export type CreatedPlaceResult = {
  placeId: string;
  contactId?: string;
};

export type CouchDoc = {
  _id: string;
};

export type UserInfo = {
  username: string;
  place?: CouchDoc[] | CouchDoc | string[] | string;
  roles?: string[];
};

export class ChtApi {
  public readonly chtSession: ChtSession;
  private axiosInstance: AxiosInstance;

  constructor(session: ChtSession) {
    this.chtSession = session;
    this.axiosInstance = session.axiosInstance;
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

  async disableUser(username: string): Promise<void> {
    const url = `api/v1/users/${username}`;
    console.log('axios.delete', url);
    return this.axiosInstance.delete(url);
  }

  async updateUser(userInfo: UserInfo): Promise<void> {
    const url = `api/v1/users/${userInfo.username}`;
    console.log('axios.post', url);
    return this.axiosInstance.post(url, userInfo);
  }

  async countContactsUnderPlace(docId: string): Promise<number> {
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
  }

  async createUser(user: UserPayload): Promise<void> {
    const url = `api/v3/users`;
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

  async getPlacesWithType(placeType: string): Promise<any[]> {
    const url = `medic/_design/medic-client/_view/contacts_by_type`;
    const params = {
      key: JSON.stringify([placeType]),
      include_docs: true,
    };
    console.log('axios.get', url, params);
    const resp = await this.axiosInstance.get(url, { params });
    return resp.data.rows.map((row: any) => row.doc);
  }

  async getDoc(id: string): Promise<any> {
    const url = `medic/${id}`;
    console.log('axios.get', url);
    const resp = await this.axiosInstance.get(url);
    return resp.data;
  }

  async getDocs(ids: string[]): Promise<any[]> {
    const url = `medic/_all_docs`;
    console.log('axios.post', url);
    const payload = {
      keys: ids,
      include_docs: true,
    };

    const resp = await this.axiosInstance.post(url, payload);
    return resp.data?.rows.map((row: any) => row.doc).filter(Boolean);
  }
  
  async getUsersAtPlace(placeId: string): Promise<UserInfo[]> {
    const url = `api/v2/users?facility_id=${placeId}`;
    console.log('axios.get', url);
    const resp = await this.axiosInstance.get(url);
    return resp.data?.map((doc: any): UserInfo => ({
      username: doc.username,
      place: doc.place,
    }));
  }

  async getUser(username: string): Promise<UserInfo | undefined> {
    const url = `api/v2/users/${username}`;
    console.log('axios.get', url);
    const resp = await this.axiosInstance.get(url);
    const doc = resp.data;
    return doc ? {
      username: doc.username,
      place: doc.place,
    } : undefined;
  }

  async lastSyncAtPlace(placeId: string): Promise<DateTime> {
    const userIds = await this.getUsersAtPlace(placeId);
    const usernames = userIds.map(userId => userId.username);
    const result = await this.getLastSyncForUsers(usernames);
    return result || DateTime.invalid('unknown');
  }

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
}
