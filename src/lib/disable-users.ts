import { ChtApi, UserInfo } from './cht-api';

const DEACTIVATION_ROLE = 'deactivated';

type UserApiPayload = {
  username: string;
  place?: string[];
};

export class DisableUsers {
  public static async disableUsersAt(placeId: string, chtApi: ChtApi): Promise<string[]> {
    return this.processUsersAt(placeId, chtApi, false);
  }

  public static async deactivateUsersAt(placeId: string, chtApi: ChtApi): Promise<string[]> {
    return this.processUsersAt(placeId, chtApi, true);
  }

  private static async processUsersAt(placeId: string, chtApi: ChtApi, deactivate: boolean): Promise<string[]> {
    const affectedUsers = await this.getAffectedUsers(placeId, chtApi);
    if (affectedUsers.length === 0) {
      return [];
    }

    await this.updateAffectedUsers(affectedUsers, deactivate, chtApi);
    return affectedUsers.map(user => user.username);
  }

  private static async getAffectedUsers(facilityId: string, chtApi: ChtApi): Promise<UserApiPayload[]> {
    const result: UserApiPayload[] = [];
    const userInfos = await chtApi.getUsersAtPlace(facilityId);
    for (const userInfo of userInfos) {
      const userPayload = this.toPostApiPayload(userInfo);
      this.removeUserFromPlace(userPayload, facilityId);
      result.push(userPayload);
    } 

    return result;
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

  private static async updateAffectedUsers(userDocs: UserApiPayload[], deactivate: boolean, chtApi: ChtApi) {
    for (const userDoc of userDocs) {
      const places = userDoc.place && !Array.isArray(userDoc.place) ? [userDoc.place] : userDoc.place;
      const noPlacesRemaining = !userDoc.place || places?.length === 0;
      if (!noPlacesRemaining) {
        await chtApi.updateUser(userDoc);
      } else {
        await this.disableUser(userDoc.username, deactivate, chtApi);
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

  private static removeUserFromPlace(userDoc: UserApiPayload, placeId: string) {
    if (Array.isArray(userDoc.place)) {
      userDoc.place = userDoc.place.filter(place => place !== placeId);
    } else {
      delete userDoc.place;
    }
  }
}
