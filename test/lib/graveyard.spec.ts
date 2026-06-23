import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';

import { ChtApi } from '../../src/lib/cht-api';
import { Graveyard, GRAVEYARD_PLACE_ID } from '../../src/lib/graveyard';

chai.use(chaiAsPromised);

type FakeChtApi = ChtApi & { getDoc: sinon.SinonStub; setDoc: sinon.SinonStub };

function fakeChtApi(getDoc: sinon.SinonStub): FakeChtApi {
  return { getDoc, setDoc: sinon.stub().resolves() } as unknown as FakeChtApi;
}

function notFound(): any {
  const err: any = new Error('missing');
  err.response = { status: 404 };
  return err;
}

describe('Graveyard', () => {
  afterEach(() => sinon.restore());

  describe('isBuried', () => {
    it('is true when the graveyard id is among the place ids', () => {
      expect(Graveyard.isBuried(['x', GRAVEYARD_PLACE_ID])).to.be.true;
    });

    it('is false otherwise', () => {
      expect(Graveyard.isBuried(['x', 'y'])).to.be.false;
      expect(Graveyard.isBuried([])).to.be.false;
    });
  });

  describe('ensureExists', () => {
    it('does nothing when the graveyard place already exists', async () => {
      const chtApi = fakeChtApi(sinon.stub().resolves({ _id: GRAVEYARD_PLACE_ID }));

      await Graveyard.ensureExists(chtApi);

      expect(chtApi.setDoc.called).to.be.false;
    });

    it('creates a top-level graveyard place (no parent) when missing', async () => {
      const chtApi = fakeChtApi(sinon.stub().rejects(notFound()));

      await Graveyard.ensureExists(chtApi);

      expect(chtApi.setDoc.calledOnce).to.be.true;
      const [id, doc] = chtApi.setDoc.firstCall.args;
      expect(id).to.equal(GRAVEYARD_PLACE_ID);
      expect(doc).to.deep.equal({
        _id: GRAVEYARD_PLACE_ID,
        type: GRAVEYARD_PLACE_ID,
        name: 'Facility Graveyard',
      });
      expect(doc).to.not.have.property('parent');
    });

    it('propagates unexpected (non-404) errors without creating anything', async () => {
      const boom: any = new Error('server');
      boom.response = { status: 500 };
      const chtApi = fakeChtApi(sinon.stub().rejects(boom));

      await expect(Graveyard.ensureExists(chtApi)).to.be.rejectedWith('server');
      expect(chtApi.setDoc.called).to.be.false;
    });
  });
});
