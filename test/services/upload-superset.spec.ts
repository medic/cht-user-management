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
      createUser: sinon.stub().resolves() as unknown as SupersetApi['createUser']
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
    await expect(uploadSuperset.handlePlace(placeWithoutSuperset))
      .to.eventually.be.rejectedWith('Superset integration is not enabled');
  });

  it('should throw error if email is missing', async () => {
    delete mockPlace.contact.properties.email;
    await expect(uploadSuperset.handlePlace(mockPlace))
      .to.eventually.be.rejectedWith('Email is required for Superset integration');
  });
});
