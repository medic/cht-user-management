import { expect } from 'chai';
import sinon from 'sinon';
import { createSupersetIntegration, SupersetIntegration } from '../../src/services/superset-integration';
import { UploadSuperset } from '../../src/services/upload-superset';
import { SupersetApi } from '../../src/lib/superset-api';
import { Config } from '../../src/config';
import Place from '../../src/services/place';
import SupersetSession from '../../src/lib/superset-session';
import { mockSupersetSession, mockSupersetContactType } from '../mocks';

describe('services/superset-integration.ts', () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('createSupersetIntegration', () => {
    it('returns SupersetIntegration if config is present', async () => {
      const contactType = mockSupersetContactType();
      sinon.stub(Config, 'getSupersetConfig').returns(contactType.superset);
      sinon.stub(SupersetSession, 'create').resolves(mockSupersetSession() as any);
      const integration = await createSupersetIntegration();
      expect(integration).to.be.instanceOf(SupersetIntegration);
    });
    it('throws if Superset session creation fails', async () => {
      sinon.stub(SupersetSession, 'create').rejects(new Error('Session failed'));
      await expect(createSupersetIntegration()).to.be.rejectedWith('Session failed');
    });
  });

  describe('SupersetIntegration', () => {
    it('delegates to UploadSuperset', async () => {
      const fakeApi = {} as SupersetApi;
      const uploadSuperset = new UploadSuperset(fakeApi);
      const place = {} as Place;
      const handlePlaceStub = sinon.stub(uploadSuperset, 'handlePlace').resolves({
        username: 'test',
        password: 'test',
        supersetUserId: 1
      });
      const handleGroupStub = sinon.stub(uploadSuperset, 'handleGroup').resolves();
      const integration = new SupersetIntegration(uploadSuperset);
      await integration.handlePlace(place);
      await integration.handleGroup([place]);
      expect(handlePlaceStub.calledOnceWith(place)).to.be.true;
      expect(handleGroupStub.calledOnceWith([place])).to.be.true;
    });
  });
}); 
