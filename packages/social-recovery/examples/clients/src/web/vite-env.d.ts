/// <reference types="vite/client" />

/** The `VITE_` variables the page reads from the package's `.env` to prefill the deployment form. */
interface ImportMetaEnv {
  readonly VITE_MANAGER_ADDRESS?: string;
  readonly VITE_METHOD_ECDSA_ADDRESS?: string;
  readonly VITE_METHOD_PASSKEY_ADDRESS?: string;
  readonly VITE_METHOD_AADHAAR_ADDRESS?: string;
  readonly VITE_METHOD_ZKPASSPORT_ADDRESS?: string;
  readonly VITE_ACTION_ADDRESS?: string;
  readonly VITE_AMBIRE_IMPLEMENTATION_ADDRESS?: string;
  readonly VITE_DEPLOY_BLOCK?: string;
  readonly VITE_AMBIRE_FACTORY?: string;
  readonly VITE_AMBIRE_FACTORY_DEPLOY_FUNCTION?: string;
  readonly VITE_MANAGER_VERSION?: string;
  readonly VITE_ACCOUNT_ADDRESS?: string;
}
