const router = require('express').Router();
const agentAuth = require('../middleware/agentAuth');
const c = require('../controllers/agent.controller');

// The Connector API: Connector token only, never a user's sign-in.
router.use(agentAuth);

router.post('/heartbeat', c.heartbeat);
router.post('/runs', c.startRun);
router.post('/runs/:id/masters', c.masters);
router.post('/runs/:id/vouchers', c.vouchers);
router.post('/runs/:id/reconcile', c.reconcile);
router.post('/runs/:id/finish', c.finish);
router.post('/match', c.match);
router.post('/autofill', c.autofill);

module.exports = router;
