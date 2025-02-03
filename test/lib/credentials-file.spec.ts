import SessionCache from '../../src/services/session-cache';
import getCredentialsFiles from '../../src/lib/credentials-file';
import PlaceFactory from '../../src/services/place-factory';
import { ChtDoc, mockChtApi, mockValidContactType } from '../mocks';
import { expect } from 'chai';

describe('lib/credentials-file.ts', () => {
  it('one csv file per contact type', async () => {
    const sessionCache = new SessionCache();
    const subcounty: ChtDoc = {
      _id: 'parent-id',
      name: 'parent-name',
    };
    const fakeFormData: any = {
      place_name: 'place',
      place_prop: 'foo',
      hierarchy_PARENT: subcounty.name,
      contact_name: 'contact',
      contact_phone: '0712344321',
    };
    const chtApi = mockChtApi([subcounty]);
    const contactType = mockValidContactType('string', undefined);
    contactType.contact_properties.push({
      friendly_name: 'CHP Phone',
      property_name: 'phone',
      parameter: 'KE',
      type: 'phone',
      required: true
    });

    const place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);

    sessionCache.savePlaces(place);
    const actual = getCredentialsFiles(sessionCache, [contactType]);
    expect(actual).to.deep.eq([{
      filename: 'contacttype-name.csv',
      content: `friendly replacement,friendly PARENT,friendly GRANDPARENT,friendly,name,phone,role,username,password
,Parent-name,,Place,contact,0712 344321,role,,
`
    }]);
  });

  it('contact without phone number', async () => {
    const sessionCache = new SessionCache();
    const subcounty: ChtDoc = {
      _id: 'parent-id',
      name: 'parent-name',
    };
    const fakeFormData: any = {
      place_name: 'place',
      place_prop: 'foo',
      hierarchy_PARENT: subcounty.name,
      contact_name: 'contact',
    };
    const chtApi = mockChtApi([subcounty]);
    const contactType = mockValidContactType('string', undefined);
    const place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);

    sessionCache.savePlaces(place);
    const actual = getCredentialsFiles(sessionCache, [contactType]);
    expect(actual).to.deep.eq([{
      filename: 'contacttype-name.csv',
      content: `friendly replacement,friendly PARENT,friendly GRANDPARENT,friendly,name,phone,role,username,password
,Parent-name,,Place,contact,,role,,
`
    }]);
  });
});
