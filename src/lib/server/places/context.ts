import type { Session } from '../auth/session';
import type { Cht } from '../cht/client';
import type { UploadLog } from '../upload-log';
import type { Warning } from './unique';

export type OperationContext = {
  cht: Cht;
  session: Session;
  uploadLog: UploadLog;
  // warnings found by comparing items of the same batch; treated like per-request warnings
  extraWarnings?: Warning[];
};

export type OperationResult<T> = { status: 200 | 201; body: T };
