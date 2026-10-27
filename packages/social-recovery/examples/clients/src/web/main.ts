import { afterActions, connectAction, guarded, wire, withConnection } from './actions';
import { applyDeployment, createAccount, newSalt, selectAccount, standIn } from './account';
import { prefillDeployment } from './config';
import { fileReply, startGathering, submitAttempt } from './attempt';
import { executeHandover, refreshAttempt } from './execute';
import { holder, refreshState } from './kit';
import { button, traceBox } from './page';
import { runSetup } from './setup';

wire({
  'connect': connectAction,
  'apply': withConnection('apply', applyDeployment),
  'new-salt': guarded('new-salt', newSalt),
  'create': withConnection('create', createAccount),
  'select': withConnection('select', selectAccount),
  'stand-in': withConnection('stand-in', standIn),
  'refresh-state': withConnection('refresh-state', refreshState),
  'run-setup': withConnection('run-setup', runSetup),
  'gather': withConnection('gather', startGathering),
  'file-reply': withConnection('file-reply', fileReply),
  'submit-attempt': withConnection('submit-attempt', submitAttempt),
  'refresh-attempt': withConnection('refresh-attempt', refreshAttempt),
  'execute': withConnection('execute', executeHandover),
  'clear-trace': guarded('clear-trace', () => {
    traceBox.replaceChildren();
  }),
});

afterActions(() => {
  button('execute').disabled = !holder.ripe;
});

prefillDeployment();
