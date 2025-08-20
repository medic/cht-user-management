import Redis from 'ioredis';
import Place, { UserCreationDetails } from './place';
import ChtSession from '../lib/cht-session';
import crypto from 'crypto';

export type UploadLogRecord = {
  id: string;
  place: string;
  person: string;
  phone: string;
  contactType: string;
  credentials: UserCreationDetails;
  hierarchy: { [key: string]: string };
};

export class UploadLog {

  private readonly redis;
  constructor(redis: Redis) {
    this.redis = redis;
  }

  private encrypt = (text: string, secretKey: string) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(
      'aes-256-gcm',
      Buffer.from(secretKey, 'hex'),
      iv
    );
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return iv.toString('hex') + ':' + authTag + ':' + encrypted;
  }

  private decrypt = (text: string, secretKey: string): string => {
    const [ivHex, authTagHex, encryptedText] = text.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      Buffer.from(secretKey, 'hex'),
      iv
    );
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  log = async (session: ChtSession, batch: number, places: Place[]) => {
    const pipeline = this.redis.pipeline();
    places.forEach(place => {
      const record: UploadLogRecord = {
        id: crypto.randomUUID(),
        place: place.name,
        person: place.contact.properties.name?.formatted,
        phone: place.contact.properties.phone?.formatted,
        credentials: place.creationDetails,
        contactType: place.type.name,
        hierarchy: {}
      };
      Object.keys(place.hierarchyProperties)
        .filter(k => !k.includes('replacement'))
        .forEach(prop => (record.hierarchy[prop] = place.hierarchyProperties[prop].formatted));
      const encryptedRecord = this.encrypt(JSON.stringify(record), process.env.SECRET_KEY);
      const key = `${session.username}:creation-log`;
      pipeline.zadd(key, batch, encryptedRecord);
      pipeline.expire(key, 3600 * 120); // 5 days, running target
    });
    await pipeline.exec();
  }

  get = async (session: ChtSession): Promise<UploadLogRecord[]> => {
    const logs = await this.redis.zrevrange(`${session.username}:creation-log`, 0, -1);
    return logs.map(log => JSON.parse(this.decrypt(log, process.env.SECRET_KEY)));
  }
}
