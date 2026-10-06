const router = require('express').Router();
const auth = require('../middleware/auth');
const { requirePermission } = require('../middleware/permission');
const c = require('../controllers/autofill.controller');

// Auto-fill into ROMS: who may do what is the autofill.* permissions, set by
// an Admin or Owner on Admin -> Roles & permissions (Admin and Owner hold
// them all).
const view = requirePermission('autofill.view');
const approve = requirePermission('autofill.approve');

router.get('/summary', auth, view, c.summary);
router.get('/items', auth, view, c.items);
router.get('/events', auth, view, c.events);
router.get('/settings', auth, view, c.getSettings);
router.put('/settings', auth, requirePermission('autofill.settings'), c.updateSettings);

router.post('/approve', auth, approve, c.approve);
router.post('/run', auth, approve, c.run);
router.post('/items/:kind/:id/retry', auth, approve, c.retry);
router.post('/items/:kind/:id/overwrite', auth, requirePermission('autofill.overwrite'), c.overwrite);

module.exports = router;
