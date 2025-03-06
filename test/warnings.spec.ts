import { expect } from 'chai';
import fs from 'fs';

import SessionCache from '../src/services/session-cache';
import { ChtDoc, createChu, expectInvalidProperties, mockChtApi } from './mocks';
import RemotePlaceCache from '../src/lib/remote-place-cache';
import { Config } from '../src/config';
import PlaceFactory from '../src/services/place-factory';
import { UploadManager } from '../src/services/upload-manager';
import Place from '../src/services/place';

const subcounty: ChtDoc = {
  _id: 'subcounty1-id',
  name: 'subcounty1',
};
const subcounty2: ChtDoc = {
  _id: 'subcounty2-id',
  name: 'subcounty2',
};
const chuDoc: ChtDoc = {
  _id: 'chu',
  name: 'Abc CHU',
  parent: { _id: subcounty._id },
};
const chpDoc: ChtDoc = {
  _id: 'chp',
  name: 'Able Johnson Area',
  parent: { _id: chuDoc._id, parent: { _id: subcounty._id } },
};

/*
Note: These tests have a dependency on Kenya eCHIS config.json and cannot rely on mocked contact types
This is because RemotePlaceCache makes a call to Config.getUniqueKeysFor() without passing through a ContactType

It is quite difficult to resolve. Not all fetched information has a corresponding ContactType.
*/
describe('warnings', () => {
  beforeEach(() => {
    RemotePlaceCache.clear({});
  });

  it('no warnings', async () => {
    const sessionCache = new SessionCache();
    const chtApi = mockChtApi([subcounty], []);
    const first = await createChu(subcounty, 'chu-1', sessionCache, chtApi);
    const second = await createChu(subcounty, 'chu-2', sessionCache, chtApi, { place_code: '121212' });

    expect(first.warnings).to.have.property('length', 0);
    expect(second.warnings).to.deep.eq(first.warnings);
  });

  describe('unique name warnings', () => {
    it('two local places share same name and same parent', async () => {
      const sessionCache = new SessionCache();
      const chtApi = mockChtApi([subcounty], []);
      const first = await createChu(subcounty, 'chu', sessionCache, chtApi);
      const second = await createChu(subcounty, 'chu', sessionCache, chtApi, { place_code: '121212' });
      
      expect(first.warnings).to.have.property('length', 1);
      expect(first.warnings[0]).to.include('same "CHU Name"');
      expect(second.warnings).to.deep.eq(first.warnings);
    });
    
    it('duplicate names but only after fuzzing', async () => {
      const sessionCache = new SessionCache();
      const chtApi = mockChtApi([subcounty], []);
      const first = await createChu(subcounty, 'ABC Community Health Unit', sessionCache, chtApi);
      const second = await createChu(subcounty, 'abc', sessionCache, chtApi, { place_code: '121212' });
      
      expect(first.warnings).to.have.property('length', 1);
      expect(first.warnings[0]).to.include('same "CHU Name"');
      expect(second.warnings).to.deep.eq(first.warnings);
    });
    
    it('name warning after fuzzing of generated name on remote property', async () => {
      const sessionCache = new SessionCache();
      const chtApi = mockChtApi([subcounty], [chuDoc], [chpDoc]);

      const chuType = Config.getContactType('d_community_health_volunteer_area');
      const chpData = {
        hierarchy_SUBCOUNTY: subcounty.name,
        hierarchy_CHU: chuDoc.name,
        contact_name: 'able . johnson',
        contact_phone: '0712345678',
      };
      const chp = await PlaceFactory.createOne(chpData, chuType, sessionCache, chtApi);
      expect(chp.validationErrors).to.be.empty;
      
      expect(chp.warnings).to.have.property('length', 1);
      expect(chp.warnings[0]).to.include('same "CHP Area Name"');
    });

    it('name warning for conflicting new and replacement CHP (replace first)', async () => {
      const sessionCache = new SessionCache();
      const chtApi = mockChtApi([subcounty], [chuDoc], [chpDoc]);

      const chuType = Config.getContactType('d_community_health_volunteer_area');
      const chpData: any = {
        hierarchy_SUBCOUNTY: subcounty.name,
        hierarchy_CHU: chuDoc.name,
        hierarchy_replacement: chpDoc.name,
        contact_name: 'new',
        contact_phone: '0712345678',
      };

      const replacementChp = await PlaceFactory.createOne(chpData, chuType, sessionCache, chtApi);
      expect(replacementChp.validationErrors).to.be.empty;
      
      chpData.contact_phone = '0787654321';
      delete chpData.hierarchy_replacement;
      const newChp = await PlaceFactory.createOne(chpData, chuType, sessionCache, chtApi);
      expect(newChp.validationErrors).to.be.empty;

      expect(newChp.warnings).to.have.property('length', 1);
      expect(newChp.warnings[0]).to.include('same "CHP Area Name"');
      expect(replacementChp.warnings).to.deep.eq(newChp.warnings);
    });

    it('name warning for conflicting new and replacement CHP (new first)', async () => {
      const sessionCache = new SessionCache();
      const chtApi = mockChtApi([subcounty], [chuDoc], [chpDoc]);

      const chuType = Config.getContactType('d_community_health_volunteer_area');
      const chpData: any = {
        hierarchy_SUBCOUNTY: subcounty.name,
        hierarchy_CHU: chuDoc.name,
        contact_name: 'new',
        contact_phone: '0712345678',
      };

      const newChp = await PlaceFactory.createOne(chpData, chuType, sessionCache, chtApi);
      expect(newChp.validationErrors).to.be.empty;
      
      chpData.contact_phone = '0787654321';
      chpData.hierarchy_replacement = chpDoc.name;
      const replacementChp = await PlaceFactory.createOne(chpData, chuType, sessionCache, chtApi);
      expect(replacementChp.validationErrors).to.be.empty;

      expect(replacementChp.warnings).to.have.property('length', 1);
      expect(replacementChp.warnings[0]).to.include('same "CHP Area Name"');
      expect(newChp.warnings).to.deep.eq(replacementChp.warnings);
    });

    it('no name warnings when there are multiple invalid replacements', async () => {
      const sessionCache = new SessionCache();
      const chtApi = mockChtApi([subcounty], [chuDoc], [chpDoc]);

      const chuType = Config.getContactType('d_community_health_volunteer_area');
      const chpData: any = {
        hierarchy_SUBCOUNTY: subcounty.name,
        hierarchy_CHU: chuDoc.name,
        hierarchy_replacement: 'dne1',
        contact_name: 'new',
        contact_phone: '0712345678',
      };

      const replacement1 = await PlaceFactory.createOne(chpData, chuType, sessionCache, chtApi);
      expectInvalidProperties(replacement1.validationErrors, ['hierarchy_replacement']);
      
      chpData.contact_name = 'other';
      chpData.contact_phone = '0787654321';
      chpData.hierarchy_replacement = 'dne2';
      const replacement2 = await PlaceFactory.createOne(chpData, chuType, sessionCache, chtApi);
      expectInvalidProperties(replacement2.validationErrors, ['hierarchy_replacement']);

      expect(replacement1.warnings).to.be.empty;
      expect(replacement2.warnings).to.be.empty;
    });

    it('name warning for CHU fuzzed remote place match', async () => {
      const remotePlace: ChtDoc = { _id: 'remote-chu', name: 'Abc Community Health Unit', parent: { _id: subcounty._id } };
  
      const sessionCache = new SessionCache();
      const chtApi = mockChtApi([subcounty], [remotePlace]);
      const first = await createChu(subcounty, 'abc', sessionCache, chtApi);
  
      expect(first.warnings).to.have.property('length', 1);
      expect(first.warnings[0]).to.include('same "CHU Name"');
      expect(first.warnings).to.deep.eq(first.warnings);
    });
    
    it('no warning when local place and remote place share same name but different parents', async () => {
      const sessionCache = new SessionCache();
      const chtApi = mockChtApi([subcounty, subcounty2], []);
      const first = await createChu(subcounty, 'chu', sessionCache, chtApi);
      const second = await createChu(subcounty2, 'chu', sessionCache, chtApi, { place_code: '121212' });
  
      expect(first.warnings).to.have.property('length', 0);
      expect(second.warnings).to.deep.eq(first.warnings);
    });

    it('no name warning for generated names', async () => {
      const sessionCache = new SessionCache();
      const chtApi = mockChtApi([subcounty], [chuDoc], [chpDoc]);
  
      const chuType = Config.getContactType('d_community_health_volunteer_area');
      const chuData = {
        hierarchy_SUBCOUNTY: subcounty.name,
        hierarchy_CHU: chuDoc.name,
        contact_name: 'different name',
        contact_phone: '0712345678',
      };
      const chp = await PlaceFactory.createOne(chuData, chuType, sessionCache, chtApi);
      expect(chp.validationErrors).to.be.empty;
      expect(chp.warnings).to.be.empty;
    });

    it('no name warning when local names match but parent is invalid', async () => {
      const sessionCache = new SessionCache();
      const chtApi = mockChtApi([subcounty], [chuDoc], [chpDoc]);

      const chuType = Config.getContactType('d_community_health_volunteer_area');
      const chpData: any = {
        hierarchy_SUBCOUNTY: subcounty.name,
        hierarchy_CHU: 'dne1',
        contact_name: 'new',
        contact_phone: '0712345678',
      };

      const replacement1 = await PlaceFactory.createOne(chpData, chuType, sessionCache, chtApi);
      expectInvalidProperties(replacement1.validationErrors, ['hierarchy_CHU']);
      
      chpData.hierarchy_CHU = 'dne2';
      chpData.contact_phone = '0787654321';
      const replacement2 = await PlaceFactory.createOne(chpData, chuType, sessionCache, chtApi);
      expectInvalidProperties(replacement2.validationErrors, ['hierarchy_CHU']);

      expect(replacement1.warnings).to.be.empty;
      expect(replacement2.warnings).to.be.empty;
    });
  });

  it('csv import of multiple.csv', async () => {
    const sessionCache = new SessionCache();
    const chtApi = mockChtApi([subcounty], [chuDoc], []);

    const singleCsvBuffer = fs.readFileSync('./test/multiple.csv');
    const chpType = Config.getContactType('d_community_health_volunteer_area');
    
    const places: Place[] = await PlaceFactory.createFromCsv(singleCsvBuffer, chpType, sessionCache, chtApi);
    expect(places).to.have.property('length', 2);

    expect(places[0].validationErrors).to.be.empty;
    expect(places[0].warnings).to.be.empty;
    expect(places[1].validationErrors).to.be.empty;
    expect(places[1].warnings).to.be.empty;
  });

  it('warn if two local try to replace the same remote', async () => {
    const sessionCache = new SessionCache();
    const chtApi = mockChtApi([subcounty], [chuDoc], [chpDoc]);

    const chuType = Config.getContactType('d_community_health_volunteer_area');
    const chpData = {
      hierarchy_SUBCOUNTY: subcounty.name,
      hierarchy_CHU: chuDoc.name,
      hierarchy_replacement: chpDoc.name,
      contact_name: 'new chp',
      contact_phone: '0712345678',
    };
    const first = await PlaceFactory.createOne(chpData, chuType, sessionCache, chtApi);
    expect(first.validationErrors).to.be.empty;

    chpData.contact_name = 'other chp';
    chpData.contact_phone = '0787654321';
    const second = await PlaceFactory.createOne(chpData, chuType, sessionCache, chtApi);
    expect(second.validationErrors).to.be.empty;

    expect(first.warnings).to.have.property('length', 1);
    expect(first.warnings[0]).to.include('Multiple entries are replacing the same "Community Health Promoter"');
    expect(second.warnings).to.deep.eq(first.warnings);
  });

  it('warn if two local places have the same phone number', async () => {
    const sessionCache = new SessionCache();
    const chtApi = mockChtApi([subcounty], [chuDoc], [chpDoc]);

    const chuType = Config.getContactType('d_community_health_volunteer_area');
    const chpData = {
      hierarchy_SUBCOUNTY: subcounty.name,
      hierarchy_CHU: chuDoc.name,
      contact_name: 'new chp',
      contact_phone: '0712345678',
    };
    const first = await PlaceFactory.createOne(chpData, chuType, sessionCache, chtApi);
    expect(first.validationErrors).to.be.empty;

    chpData.contact_name = 'other chp';
    const second = await PlaceFactory.createOne(chpData, chuType, sessionCache, chtApi);
    expect(second.validationErrors).to.be.empty;

    expect(first.warnings).to.have.property('length', 1);
    expect(first.warnings[0]).to.include('same "CHP Phone"');
    expect(second.warnings).to.deep.eq(first.warnings);
  });

  it('warn if a created place has same phone number as staged place', async () => {
    const sessionCache = new SessionCache();
    const chtApi = mockChtApi([subcounty], [chuDoc], []);
    const chuType = Config.getContactType('d_community_health_volunteer_area');
    const chpData = {
      hierarchy_SUBCOUNTY: subcounty.name,
      hierarchy_CHU: chuDoc.name,
      contact_name: 'new chp',
      contact_phone: '0712345678',
    };
    const first = await PlaceFactory.createOne(chpData, chuType, sessionCache, chtApi);
    expect(first.validationErrors).to.be.empty;
    expect(first.warnings).to.be.empty;

    const uploadManager = new UploadManager();
    await uploadManager.doUpload([first], chtApi);
    expect(first.isCreated).to.be.true;

    chpData.contact_name = 'other chp';
    const second = await PlaceFactory.createOne(chpData, chuType, sessionCache, chtApi);
    expect(second.validationErrors).to.be.empty;

    expect(first.warnings).to.have.property('length', 1);
    expect(first.warnings[0]).to.include('same "CHP Phone"');
    expect(second.warnings).to.deep.eq(first.warnings);
  });

  it('can replace multiple CHAs at the same time without warning', async () => {
    const sessionCache = new SessionCache();
    const secondChu: ChtDoc = {
      _id: 'chu-2',
      name: 'second',
      parent: chuDoc.parent,
    };
    const chtApi = mockChtApi([subcounty], [chuDoc, secondChu]);

    const chuType = Config.getContactType('c_community_health_unit');
    const chuData = {
      hierarchy_SUBCOUNTY: subcounty.name,
      hierarchy_replacement: chuDoc.name,
      place_name: '',
      place_code: '',
      place_link_facility_name: '',
      place_link_facility_code: '',
      contact_name: 'replacement CHA',
      contact_phone: '0712345678',
    };
    const first = await PlaceFactory.createOne(chuData, chuType, sessionCache, chtApi);
    expect(first.validationErrors).to.be.empty;

    const secondChuData = {
      hierarchy_SUBCOUNTY: subcounty.name,
      hierarchy_replacement: secondChu.name,
      place_name: '',
      place_code: '',
      place_link_facility_name: '',
      place_link_facility_code: '',
      contact_name: 'another replacement',
      contact_phone: '0787654321',
    };
    const second = await PlaceFactory.createOne(secondChuData, chuType, sessionCache, chtApi);
    expect(second.validationErrors).to.be.empty;

    expect(first.warnings).to.be.empty;
    expect(second.warnings).to.be.empty;
  });

  it('two local places with duplicate CHU Code', async () => {
    const sessionCache = new SessionCache();
    const chtApi = mockChtApi([subcounty, subcounty2], []);
    const first = await createChu(subcounty, 'chu-1', sessionCache, chtApi);
    const second = await createChu(subcounty2, 'chu-2', sessionCache, chtApi);

    expect(first.warnings).to.have.property('length', 1);
    expect(first.warnings[0]).to.include('same "CHU Code"');
    expect(first.warnings).to.deep.eq(second.warnings);
  });

  it('local and remote places with duplicate CHU Code', async () => {
    const chuCode = '111111';
    const remotePlace: ChtDoc = { _id: 'remote', name: 'remote', parent: { _id: subcounty._id }, code: chuCode };

    const sessionCache = new SessionCache();
    const chtApi = mockChtApi([subcounty], [remotePlace]);
    const first = await createChu(subcounty, 'abc', sessionCache, chtApi, { place_code: chuCode });

    expect(first.warnings).to.have.property('length', 1);
    expect(first.warnings[0]).to.include('same "CHU Code"');
  });

  it('no warning when input is invalid', async () => {
    const chuCode = 'invalid';
    const remotePlace: ChtDoc = { _id: 'remote', name: 'remote', parent: { _id: subcounty._id }, code: chuCode };

    const sessionCache = new SessionCache();
    const chtApi = mockChtApi([subcounty], [remotePlace]);
    const first = await createChu(subcounty, 'abc', sessionCache, chtApi, { place_code: chuCode });

    expect(first.warnings).to.be.empty;
  });

  it('redundant warnings are not repeated', async () => {
    const chuCode = '111111';
    const chuName = 'abc';
    const remotePlace: ChtDoc = { _id: 'remote', name: chuName, parent: { _id: subcounty._id }, code: chuCode };

    const sessionCache = new SessionCache();
    const chtApi = mockChtApi([subcounty], [remotePlace]);
    const createIdenticalChu = async () => createChu(subcounty, chuName, sessionCache, chtApi, { place_code: chuCode });

    const first = await createIdenticalChu();
    const second = await createIdenticalChu();
    const third = await createIdenticalChu();
    const fourth = await createIdenticalChu();

    expect(first.warnings.length).to.eq(2);
    expect(second.warnings).to.deep.eq(first.warnings);
    expect(third.warnings).to.deep.eq(first.warnings);
    expect(fourth.warnings).to.deep.eq(first.warnings);
  });
});
