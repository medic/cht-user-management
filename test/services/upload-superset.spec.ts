import { expect } from 'chai';
import sinon from 'sinon';
import { UploadSuperset } from '../../src/services/upload-superset';
import { SupersetApi } from '../../src/lib/superset-api';
import Place from '../../src/services/place';
import { mockSupersetContactType, mockValidContactType } from '../mocks';
import { UnvalidatedPropertyValue } from '../../src/property-value';
import chaiAsPromised from 'chai-as-promised';
import Chai from 'chai';

Chai.use(chaiAsPromised);

describe('services/upload-superset.ts', () => {
  let supersetApi: SupersetApi;
  let uploadSuperset: UploadSuperset;
  let mockPlace: Place;

  beforeEach(() => {
    supersetApi = {
      createRole: sinon.stub().resolves(123) as unknown as SupersetApi['createRole'],
      getPermissionsByRoleID: sinon.stub().resolves([1, 2]) as unknown as SupersetApi['getPermissionsByRoleID'],
      assignPermissionsToRole: sinon.stub().resolves() as unknown as SupersetApi['assignPermissionsToRole'],
      getTablesByRlsID: sinon.stub().resolves([{ id: 456 }]) as unknown as SupersetApi['getTablesByRlsID'],
      createRowLevelSecurityFromTemplate: sinon.stub().resolves() as unknown as SupersetApi['createRowLevelSecurityFromTemplate'],
      createUser: sinon.stub().resolves({ id: 99 }) as unknown as SupersetApi['createUser'],
      updateUser: sinon.stub().resolves() as unknown as SupersetApi['updateUser']
    } as SupersetApi;

    uploadSuperset = new UploadSuperset(supersetApi);
    const contactType = mockSupersetContactType();
    mockPlace = new Place(contactType);
    mockPlace.properties.name = new UnvalidatedPropertyValue('Test Place');
    mockPlace.contact.properties.name = new UnvalidatedPropertyValue('test contact');
    mockPlace.contact.properties.email = new UnvalidatedPropertyValue('test@example.com');
    mockPlace.supersetProperties.superset_mode = new UnvalidatedPropertyValue('enable');
    mockPlace.creationDetails.username = 'test_contact';
    mockPlace.creationDetails.password = 'password';
  });

  it('should create role and assign permissions', async () => {
    await uploadSuperset.handlePlace(mockPlace);

    sinon.assert.calledWith(supersetApi.createRole as sinon.SinonStub, 'CHU', 'Test Place');
    sinon.assert.calledWith(supersetApi.getPermissionsByRoleID as sinon.SinonStub, 16); // role_template is "16" from the mockSupersetContactType
    sinon.assert.calledWith(
      supersetApi.assignPermissionsToRole as sinon.SinonStub,
      123,
      [1, 2]
    );
  });

  it('should set up row-level security', async () => {
    await uploadSuperset.handlePlace(mockPlace);

    sinon.assert.calledWith(supersetApi.getTablesByRlsID as sinon.SinonStub, 6); // rls_template is "6" from the mockSupersetContactType
    sinon.assert.calledWith(
      supersetApi.createRowLevelSecurityFromTemplate as sinon.SinonStub,
      123,
      'Test Place',
      'chu_name',
      'CHU',
      [456]
    );
  });

  it('should create user with role', async () => {
    await uploadSuperset.handlePlace(mockPlace);

    sinon.assert.called(supersetApi.createUser as sinon.SinonStub);
    const userPayload = (supersetApi.createUser as sinon.SinonStub).args[0][0];
    expect(userPayload).to.deep.include({
      username: 'test_contact',
      password: 'password',
      email: 'test@example.com',
      roles: [123]
    });
  });

  it('should throw error if Superset is not configured', async () => {
    const placeWithoutSuperset = new Place(mockValidContactType('string', undefined));
    placeWithoutSuperset.creationDetails.username = 'test_contact';
    placeWithoutSuperset.creationDetails.password = 'password';
    placeWithoutSuperset.contact.properties.email = new UnvalidatedPropertyValue('test@example.com');
    placeWithoutSuperset.properties.name = new UnvalidatedPropertyValue('NoSuperset Place');
    await expect(uploadSuperset.handlePlace(placeWithoutSuperset))
      .to.eventually.be.rejectedWith('Superset integration is not enabled for place: NoSuperset Place');
  });

  it('should throw error if email is missing', async () => {
    delete mockPlace.contact.properties.email;
    await expect(uploadSuperset.handlePlace(mockPlace))
      .to.eventually.be.rejectedWith('Email is required for Superset integration, but is missing for place: Test Place');
  });

  it('should throw error if username or password is missing', async () => {
    mockPlace.creationDetails.username = '';
    await expect(uploadSuperset.handlePlace(mockPlace))
      .to.eventually.be.rejectedWith('Cannot create Superset user without CHT credentials for place: Test Place');
    mockPlace.creationDetails.username = 'test_contact';
    mockPlace.creationDetails.password = '';
    await expect(uploadSuperset.handlePlace(mockPlace))
      .to.eventually.be.rejectedWith('Cannot create Superset user without CHT credentials for place: Test Place');
  });

  it('should throw error if place name is missing', async () => {
    mockPlace.properties.name = new UnvalidatedPropertyValue('');
    // Place.name getter will be undefined
    Object.defineProperty(mockPlace, 'name', { get: () => undefined });
    await expect(uploadSuperset.handlePlace(mockPlace))
      .to.eventually.be.rejectedWith('Place name is required for Superset integration');
  });

  describe('handleGroup', () => {
    let mockPlaces: Place[];

    beforeEach(() => {
      mockPlaces = [
        new Place(mockSupersetContactType()),
        new Place(mockSupersetContactType()),
        new Place(mockSupersetContactType())
      ];

      // Set up all places with CHT credentials and required properties
      mockPlaces.forEach((p, i) => {
        p.creationDetails.username = 'test_contact';
        p.creationDetails.password = 'password';
        p.properties.name = new UnvalidatedPropertyValue(`Test Place ${i + 1}`);
        p.contact.properties.name = new UnvalidatedPropertyValue(`Test Contact ${i + 1}`);
        p.contact.properties.email = new UnvalidatedPropertyValue('test@example.com');
      });
    });

    it('should create roles and RLS for all places and create ONE Superset user with all roles', async () => {
      // Mock createRole to return different IDs for each call
      (supersetApi.createRole as sinon.SinonStub)
        .onCall(0).resolves(2)
        .onCall(1).resolves(3)
        .onCall(2).resolves(4);

      await uploadSuperset.handleGroup(mockPlaces);

      // Verify createRole was called for each place
      sinon.assert.callCount(supersetApi.createRole as sinon.SinonStub, mockPlaces.length);

      // Verify createUser was called once with all role IDs
      sinon.assert.calledOnce(supersetApi.createUser as sinon.SinonStub);
      const userPayload = (supersetApi.createUser as sinon.SinonStub).args[0][0];
      expect(userPayload.roles).to.deep.equal([2, 3, 4]);

      // All places should have supersetUserId set
      mockPlaces.forEach(p => {
        expect(p.creationDetails.supersetUserId).to.equal(99);
      });
    });

    it('should throw error if any place is missing CHT credentials', async () => {
      delete mockPlaces[1].creationDetails.username;
      await expect(uploadSuperset.handleGroup(mockPlaces)).to.be.rejectedWith('Cannot create Superset user without CHT credentials');
    });

    it('should handle API failures gracefully', async () => {
      (supersetApi.createRole as sinon.SinonStub).rejects(new Error('API Error'));
      await expect(uploadSuperset.handleGroup(mockPlaces)).to.be.rejectedWith('Failed to set up Superset for group of places: API Error');
      mockPlaces.forEach(p => {
        expect(p.creationDetails.supersetUserId).to.be.undefined;
      });
    });

    it('should throw error if no places provided', async () => {
      await expect(uploadSuperset.handleGroup([])).to.be.rejectedWith('No places provided for group creation');
    });
  });
});
