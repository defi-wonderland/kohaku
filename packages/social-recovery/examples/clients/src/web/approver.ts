import { connectAction, guarded, wire } from './actions';
import { loadCertificateFile } from './aadhaar';
import { prefillDeployment } from './config';
import { describeRequest } from './describe-request';
import { abortDevice } from './devices';
import { enrolled, enrollGuardian } from './enroll';
import { guardian, signRequest } from './guardian';
import { button, copyText, line, traceBox } from './page';

wire({
  'connect': connectAction,
  'describe': guarded('describe', () => {
    describeRequest();
  }),
  'sign': guarded('sign', signRequest),
  'copy-reply': guarded('copy-reply', async () => {
    if (guardian.reply === undefined) throw new Error('answer a request first');

    await copyText(line(guardian.reply));
  }),
  'load-certificate': guarded('load-certificate', loadCertificateFile),
  'enroll': guarded('enroll', enrollGuardian),
  'copy-credential': guarded('copy-credential', async () => {
    if (enrolled.credential === undefined) throw new Error('enroll first');

    await copyText(line(enrolled.credential));
  }),
  'clear-trace': guarded('clear-trace', () => {
    traceBox.replaceChildren();
  }),
});

button('abort').addEventListener('click', abortDevice);

prefillDeployment();
