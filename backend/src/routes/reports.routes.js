const router = require('express').Router();
const auth = require('../middleware/auth');
const { requirePermission } = require('../middleware/permission');
const c = require('../controllers/reports.controller');

// Reports: seeing them is reports.view; credit terms and exception days are
// reports.settings. Admin and Owner hold both.
const view = requirePermission('reports.view');
const settings = requirePermission('reports.settings');

router.get('/invoices', auth, view, c.invoices);
router.get('/notes', auth, view, c.notes);
router.get('/transfers', auth, view, c.transfers);
router.get('/receivables', auth, view, c.receivables);
router.get('/exceptions', auth, view, c.exceptions);
router.get('/settings', auth, view, c.getSettings);
router.put('/settings', auth, settings, c.updateSettings);
router.put('/terms/:vendor', auth, settings, c.updateTerms);

module.exports = router;
