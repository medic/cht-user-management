import _ from 'lodash';
import { Config } from '../../src/config';
import { ChtApi, UserInfo } from '../../src/lib/cht-api';
import RemotePlaceCache from '../../src/lib/remote-place-cache';
import Place from '../../src/services/place';

// DirectoryData['subcounty']['cha'] = 'facility_id'
type DirectoryData = {
  [key: string]: {
    [key: string]: string;
  };
};

export default class PrimaryContactDirectory {
  private readonly data: DirectoryData;
  private readonly chtApi: ChtApi;

  private constructor(chtApi: ChtApi, usernameDictionaryData: DirectoryData) {
    this.data = usernameDictionaryData;
    this.chtApi = chtApi;
  }

  public static async construct(chtApi: ChtApi): Promise<PrimaryContactDirectory> {
    const chuType = Config.getContactType('c_community_health_unit');
    const chus = await RemotePlaceCache.getRemotePlaces(chtApi, chuType, chuType.hierarchy[1]);
    const chaIds = _.uniq(chus.map(chu => chu.contactId));
    const chaDocs = await chtApi.getDocs(chaIds);

    const data: DirectoryData = {};
    for (const chaDoc of chaDocs) {
      const chuId = chaDoc.parent?._id;
      const subcountyId = chaDoc.parent?.parent?._id;
      if (!data[subcountyId]) {
        data[subcountyId] = {};
      }

      data[subcountyId][chaDoc.name] = chuId;
    }
    
    return new PrimaryContactDirectory(chtApi, data);
  }

  public primaryContactExists(place: Place): boolean {
    const subcountyId = place.resolvedHierarchy[1]?.id;
    if (!subcountyId) {
      return true;
    }

    const chaName = place.contact.name;
    return !!this.data[subcountyId]?.[chaName];
  }

  public async getUsersAtPlaceWithPC(place: Place): Promise<UserInfo[] | undefined> {
    const subcountyId = place.resolvedHierarchy[1]?.id;
    if (!subcountyId) {
      throw Error('Place has no subcounty id');
    }

    const chaName = place.contact.name;
    const chuId = this.data[subcountyId]?.[chaName];
    if (!chuId) {
      const subcountyName = place.resolvedHierarchy[1]?.name.formatted;
      throw Error(`Place contact is not known within ${subcountyName}`);
    }

    return this.chtApi.getUsersAtPlace(chuId);
  }

  public print(): void {
    console.log(JSON.stringify(this.data, null, 2));
  }
}
