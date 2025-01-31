import _ from 'lodash';
import { ChtApi, UserInfo } from './cht-api';

const DEACTIVATION_ROLE = 'deactivated';

type UserApiPayload = {
  username: string;
  place?: string[];
};

export type PlaceReassignment = {
  placeId: string;
  toUsername: string;
  deactivate: boolean;
};

type UserUpdate = {
  userDoc: UserApiPayload;
  placesToAdd: string[];
  placesToRemove: string[];
  deactivate: boolean;
};

export class MultiplaceUsers {
  public static async disableUsersAt(placeId: string, chtApi: ChtApi): Promise<string[]> {
    return this.processPlaceRemoval(placeId, chtApi, false);
  }

  public static async deactivateUsersAt(placeId: string, chtApi: ChtApi): Promise<string[]> {
    return this.processPlaceRemoval(placeId, chtApi, true);
  }

  public static async reassignPlaces(reassignments: PlaceReassignment[], chtApi: ChtApi): Promise<string[]> {
    type UserUpdateDict = {
      [key: string]: UserUpdate;
    };

    const userUpdates: UserUpdateDict  = {};
    function getUpdateFor(userDoc: UserApiPayload, deactivate: boolean) {
      const { username } = userDoc;
      if (!userUpdates[username]) {
        userUpdates[username] = {
          userDoc,
          placesToAdd: [],
          placesToRemove: [],
          deactivate,
        };
      }

      return userUpdates[username];
    }

    for (const reassignment of reassignments) {
      const loserUsersInfo = await this.getAffectedUsers(reassignment.placeId, chtApi);
      for (const affectedUser of loserUsersInfo) {
        const update = getUpdateFor(affectedUser, reassignment.deactivate);
        update.placesToRemove.push(reassignment.placeId);
      }

      const gainerUserInfo = await chtApi.getUser(reassignment.toUsername);
      if (!gainerUserInfo) {
        throw Error(`Could not get user info for: "${reassignment.toUsername}"`);
      }

      const gainerUserPayload = this.toPostApiPayload(gainerUserInfo);
      const update = getUpdateFor(gainerUserPayload, reassignment.deactivate);
      update.placesToAdd.push(reassignment.placeId);
    }
    
    const updates = Object.values(userUpdates);
    await this.processPlaceUpdates(updates, chtApi);
    return Object.keys(userUpdates);
  }

  private static async processPlaceRemoval(placeId: string, chtApi: ChtApi, deactivate: boolean): Promise<string[]> {
    const affectedUsers = await this.getAffectedUsers(placeId, chtApi);
    const placeUpdates = affectedUsers.map(userDoc => ({
      userDoc,
      placesToAdd: [],
      placesToRemove: [placeId],
      deactivate,
    }));

    await this.processPlaceUpdates(placeUpdates, chtApi);
    return placeUpdates.map(update => update.userDoc.username);
  }

  private static async getAffectedUsers(facilityId: string, chtApi: ChtApi): Promise<UserApiPayload[]> {
    const userInfos = await chtApi.getUsersAtPlace(facilityId);
    return userInfos.map(userInfo => this.toPostApiPayload(userInfo));
  }

  private static toPostApiPayload(apiResponse: UserInfo): UserApiPayload {
    const places = Array.isArray(apiResponse.place) ? apiResponse.place : [apiResponse.place];
    const placeIds: string[] = places.map(place => {
      if (typeof place === 'string') {
        return place;
      }

      return place?._id;
    }).filter(Boolean) as string[];

    return {
      username: apiResponse.username,
      place: placeIds,
    };
  }

  private static async processPlaceUpdates(userUpdates: UserUpdate[], chtApi: ChtApi) {
    for (const userUpdate of userUpdates) {
      const userDoc = this.getUpdatedPayload(userUpdate);
      if (userDoc.place?.length) {
        await chtApi.updateUser(userDoc);
      } else {
        await this.disableUser(userDoc.username, userUpdate.deactivate, chtApi);
      }
    }
  }

  private static async disableUser(username: string, deactivate: boolean, chtApi: ChtApi) {
    if (deactivate) {
      const userInfo: UserInfo = {
        username,
        roles: [DEACTIVATION_ROLE],
      };

      return chtApi.updateUser(userInfo);
    }

    return chtApi.disableUser(username);
  }

  private static getUpdatedPayload(userUpdate: UserUpdate): UserApiPayload {
    const alreadyAssigned = Array.isArray(userUpdate.userDoc.place) ? userUpdate.userDoc.place : [userUpdate.userDoc.place];
    const updatedPlaces = new Set([...alreadyAssigned, ...userUpdate.placesToAdd]);

    // dont remove if adding and removing at the same time
    const placesToRemove = _.difference(userUpdate.placesToRemove, userUpdate.placesToAdd);
    for (const remove of placesToRemove) {
      if (!userUpdate.placesToAdd.includes(remove)) {
        updatedPlaces.delete(remove);
      }
    }
    
    const result = _.cloneDeep(userUpdate.userDoc);
    if (updatedPlaces.size) {
      result.place = Array.from(updatedPlaces).filter(Boolean) as string[];
    } else {
      delete result.place;
    }

    return result;
  }
}
