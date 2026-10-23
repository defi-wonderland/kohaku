import { element } from '../shared/dom';

/** The approver page's own elements, beside the connection elements the wallet session clears. */
export const ui = {
  chainLine: element<HTMLParagraphElement>('#chain'),
  methodPicker: element<HTMLSelectElement>('#method'),
  testing: element<HTMLInputElement>('#testing'),
  testingLabel: element<HTMLSpanElement>('#testing-label'),
  realLabel: element<HTMLParagraphElement>('#real-label'),
  enrolButton: element<HTMLButtonElement>('#enrol'),
  describeButton: element<HTMLButtonElement>('#describe'),
  abortButton: element<HTMLButtonElement>('#abort'),
  credentialBox: element<HTMLDivElement>('#credential-line'),
  requestText: element<HTMLTextAreaElement>('#request'),
  descriptionBox: element<HTMLPreElement>('#description'),
  replyBox: element<HTMLDivElement>('#reply-line'),
  progressLine: element<HTMLParagraphElement>('#progress'),
  appLink: element<HTMLDivElement>('#app-link'),
  passkeyUser: element<HTMLInputElement>('#passkey-user'),
  zkDomain: element<HTMLInputElement>('#zk-domain'),
  zkScope: element<HTMLInputElement>('#zk-scope'),
  aadhaarSeed: element<HTMLInputElement>('#aadhaar-seed'),
  aadhaarQr: element<HTMLTextAreaElement>('#aadhaar-qr'),
  aadhaarCertificate: element<HTMLTextAreaElement>('#aadhaar-certificate'),
  aadhaarOrigin: element<HTMLSelectElement>('#aadhaar-origin'),
  fieldsets: {
    wallet: element<HTMLFieldSetElement>('#fields-wallet'),
    passkey: element<HTMLFieldSetElement>('#fields-passkey'),
    zkpassport: element<HTMLFieldSetElement>('#fields-zkpassport'),
    aadhaar: element<HTMLFieldSetElement>('#fields-aadhaar'),
  },
};
