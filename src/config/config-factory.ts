import { PartnerConfig } from '.';
import ugandaConfig from './chis-ug';
import kenyaConfig from './chis-ke';
import togoConfig from './chis-tg';

const CONFIG_MAP: { [key: string]: PartnerConfig } = {
  'CHIS-KE': kenyaConfig,
  'CHIS-UG': ugandaConfig,
  'CHIS-TG': togoConfig
};

export default function getConfigByKey(key: string = 'CHIS-KE'): PartnerConfig {
  const usingKey = key.toUpperCase();
  console.log(`Using configuration: ${key}`);
  const result = CONFIG_MAP[usingKey];
  if (!result) {
    const available = JSON.stringify(Object.keys(CONFIG_MAP));
    throw Error(`Failed to start: Cannot find configuration "${usingKey}". Configurations available are ${available}`);
  }

  return result;
}
